// TechShot marketplace — server-side admin user management.
//
// SERVER ONLY. This file is a server-actions module ("use server"):
// Owner-only role changes, user removal and the admin users list.
// The service-role client below must never be bundled into the
// browser.
//
// Split from lib/auth-server.ts: admin user management lives here,
// session helpers in ./session, profile creation in ./profile.
// lib/auth-server.ts re-exports all three.

"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient, createClient } from "../supabase/server";

import { canManageUsers } from "../roles";

import { getCurrentUser } from "./session";

/**
 * The Supabase Database generic resolves query results to `never`
 * with the installed supabase-js version (lib/supabase/catalog.ts
 * works around the same issue with `as unknown` casts), so this file
 * talks to the untyped client and casts rows to the local shapes
 * below. Runtime behaviour is unchanged.
 */
function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

/**
 * Audit row for a user-management change. There is no shared
 * audit_log write helper in the codebase — lib/orders/actions.ts and
 * lib/products/actions.ts each carry their own local one, and this
 * file follows the same pattern (best-effort insert, failure logged
 * server-side only, never failing the user change or reaching the
 * client). audit_log has no details column, so the old and new
 * values live in the action string.
 */
async function writeUserAudit(
  admin: SupabaseClient,
  actorId: string | null,
  action: string,
  entityId: string,
): Promise<void> {
  try {
    const { error } = await admin.from("audit_log").insert({
      actor_id: actorId,
      action,
      entity_type: "user",
      entity_id: entityId,
    });
    if (error) {
      console.error("TechShot audit_log insert failed:", error.message);
    }
  } catch (error) {
    console.error(
      "TechShot audit_log insert failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

export type ChangeUserRoleResult = { ok: true } | { ok: false; error: string };

/** Roles changeUserRole may assign. "admin" is the Owner role. */
const ASSIGNABLE_ROLES = ["customer", "co_admin", "manager", "admin"] as const;

function adminClientOrNull(): SupabaseClient | null {
  try {
    return untyped(createAdminClient());
  } catch {
    // Service role not configured: generic error, never say which
    // environment variable is missing.
    return null;
  }
}

/**
 * Change a user's role. Owner only: the caller must have role
 * "admin" in profiles. The Owner cannot change their own role (or
 * remove themselves — see removeUser), so the store can never be
 * left with no owner. Assigning "admin" makes the target a second
 * owner — the Owner is the only person who may do that, so it is
 * allowed here and nowhere else. Returns an error result instead of
 * throwing, so the admin page can show it; the role change is
 * audited best-effort in audit_log.
 */
export async function changeUserRole(
  userId: string,
  role: string,
): Promise<ChangeUserRoleResult> {
  const genericError = "Something went wrong. Please try again.";
  if (typeof userId !== "string" || userId.trim() === "") {
    return { ok: false, error: genericError };
  }
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
    return { ok: false, error: "Please choose a valid role." };
  }
  const caller = await getCurrentUser();
  if (!caller) return { ok: false, error: "You must be signed in to manage users." };
  if (!canManageUsers(caller.role)) {
    return { ok: false, error: "You do not have permission to manage users." };
  }
  if (caller.id === userId) {
    return { ok: false, error: "You cannot change your own role." };
  }
  const admin = adminClientOrNull();
  if (!admin) return { ok: false, error: genericError };

  const { data: target, error: loadError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (loadError || !target) return { ok: false, error: "User not found." };
  const oldRole = (target as { role: string }).role ?? "customer";
  if (oldRole === role) return { ok: true };

  const { data: updated, error } = await admin
    .from("profiles")
    .update({ role })
    .eq("id", userId)
    .select("id");
  if (error) return { ok: false, error: genericError };
  if (!Array.isArray(updated) || updated.length !== 1) {
    return { ok: false, error: "User not found." };
  }
  await writeUserAudit(admin, caller.id, `user.role:${oldRole}->${role}`, userId);
  return { ok: true };
}

export type RemoveUserResult = { ok: true } | { ok: false; error: string };

/**
 * Remove a user entirely. Owner only, and the Owner cannot remove
 * themselves. Deletes the auth user via the service-role admin
 * client (following the listUsers() client pattern in this file);
 * the profiles row is deleted too — profiles.id references
 * auth.users with ON DELETE CASCADE, so the auth delete normally
 * removes it already and the profiles delete below is a no-op
 * safety net. Audited best-effort before the delete (the audit row
 * survives: audit_log.actor_id is ON DELETE SET NULL).
 */
export async function removeUser(userId: string): Promise<RemoveUserResult> {
  const genericError = "Something went wrong. Please try again.";
  if (typeof userId !== "string" || userId.trim() === "") {
    return { ok: false, error: genericError };
  }
  const caller = await getCurrentUser();
  if (!caller) return { ok: false, error: "You must be signed in to manage users." };
  if (!canManageUsers(caller.role)) {
    return { ok: false, error: "You do not have permission to manage users." };
  }
  if (caller.id === userId) {
    return { ok: false, error: "You cannot remove your own account." };
  }
  const admin = adminClientOrNull();
  if (!admin) return { ok: false, error: genericError };

  const { data: target, error: loadError } = await admin
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (loadError || !target) return { ok: false, error: "User not found." };

  await writeUserAudit(admin, caller.id, "user.remove", userId);
  let deleteError: { message: string } | null = null;
  try {
    const { error } = await admin.auth.admin.deleteUser(userId);
    deleteError = error;
  } catch (error) {
    deleteError = { message: error instanceof Error ? error.message : "unknown error" };
  }
  if (deleteError) {
    console.error("TechShot remove user failed:", deleteError.message);
    return { ok: false, error: genericError };
  }
  try {
    // Normally already gone via the ON DELETE CASCADE above.
    await admin.from("profiles").delete().eq("id", userId);
  } catch {
    // The auth delete already succeeded; a leftover profiles row is
    // harmless and must not report the removal as failed.
  }
  return { ok: true };
}

export interface ListedUser {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  created_at: string;
}

/**
 * List registered users (admin dashboard). Admin only: the caller must
 * be signed in and have role `admin` in `profiles`. Returns an empty
 * list when Supabase is not configured or nobody is signed in; throws a
 * generic error when a signed-in non-admin calls it. Emails come from
 * Auth (profiles has no email column) and are merged by user id.
 *
 * NOTE: lib/products/queries.ts fetchAdminUsers() also lists profiles
 * for the admin page (without emails). This action is the auth
 * workstream's admin-only list, with real emails included.
 */
export async function listUsers(): Promise<ListedUser[]> {
  let supabase: SupabaseClient;
  try {
    supabase = untyped(createClient());
  } catch {
    return [];
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: profile } = (await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()) as { data: { role: unknown } | null };
  if (profile?.role !== "admin") {
    throw new Error("Not allowed.");
  }
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return [];
  }
  const { data: profiles } = (await admin
    .from("profiles")
    .select("id, display_name, role, created_at")
    .order("created_at", { ascending: false })) as {
    data:
      | Array<{ id: string; display_name: string | null; role: string; created_at: string }>
      | null;
  };
  if (!profiles) return [];
  let emailById = new Map<string, string>();
  try {
    const { data } = await admin.auth.admin.listUsers();
    emailById = new Map(
      (data?.users ?? []).map((u) => [u.id, u.email ?? ""] as [string, string]),
    );
  } catch {
    // Email lookup failed — profiles are still listed without emails.
  }
  return profiles.map((p) => ({
    id: p.id,
    email: emailById.get(p.id) ?? null,
    display_name: p.display_name,
    role: p.role,
    created_at: p.created_at,
  }));
}
