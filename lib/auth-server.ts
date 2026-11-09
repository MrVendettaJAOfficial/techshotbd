// TechShot marketplace — server-side auth helpers + profile action.
//
// SERVER ONLY. This file is a server-actions module ("use server"):
 // - lib/auth.ts (client) imports ensureProfile from here to create
//   the profiles row after sign-up. A server action is the only safe
//   way for browser code to reach this file: the service-role client
//   below must never be bundled into the browser.
// - Server components and other server actions import getCurrentUser
//   directly. (There is no seller verification any more: TechShot is
//   single-seller, products are managed only in /admin.)
//
// When Supabase is not configured, or there is no signed-in user,
// getCurrentUser returns null instead of throwing — callers treat
// null as "not signed in".

"use server";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient, createClient } from "./supabase/server";

import {
  buildProfileRow,
  deriveProfileFromMetadata,
} from "./profile-rules";

import type { AppUser, UserRole } from "./auth";

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

function isValidRole(value: unknown): value is UserRole {
  return value === "customer" || value === "admin";
}

/**
 * The signed-in user, or null when nobody is signed in / Supabase is
 * not configured. Never throws.
 *
 * Per-request cached (React cache()): several server actions and
 * components ask for the current user during one request (the admin
 * page, account data, order actions), and each call was a separate
 * Auth round trip. The cache is per-request only — the next request
 * re-validates the session, so a sign-out or role change is never
 * hidden by a stale result.
 */
const fetchCurrentUser = cache(async (): Promise<AppUser | null> => {
  try {
    const supabase = untyped(createClient());
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const authUser = data.user;

    const { data: profile } = (await supabase
      .from("profiles")
      .select("id, role, display_name")
      .eq("id", authUser.id)
      .maybeSingle()) as {
      data: { id: string; role: unknown; display_name: string | null } | null;
    };

    const metadata = (authUser.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
      profile?.display_name ??
      (typeof metadata["display_name"] === "string" ? (metadata["display_name"] as string) : null) ??
      authUser.email?.split("@")[0] ??
      "TechShot user";

    return {
      id: authUser.id,
      email: authUser.email ?? "",
      displayName,
      role: profile && isValidRole(profile.role) ? profile.role : "customer",
    };
  } catch {
    // Missing env / no session / Supabase unreachable: the caller
    // treats this exactly like "not signed in" and shows a generic
    // error. Never leak which variable or service is missing.
    return null;
  }
});

export async function getCurrentUser(): Promise<AppUser | null> {
  return fetchCurrentUser();
}

/**
 * Exchange the email-confirmation / magic-link code for a session
 * (called from app/auth/callback/page.tsx). Runs on the server so
 * the session cookies can be set. Throws a generic error when the
 * code is missing or the exchange fails. Also ensures the profiles
 * row exists from the user's metadata, so a confirmed account can
 * use carts / orders (which reference profiles) right away.
 */
export async function exchangeAuthCode(code: string): Promise<{ ok: true }> {
  const genericError = new Error("Could not sign you in. Please try signing in again.");
  if (typeof code !== "string" || code.trim() === "") throw genericError;
  try {
    const supabase = untyped(createClient());
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) throw genericError;
    const row = deriveProfileFromMetadata(
      data.user.id,
      (data.user.user_metadata ?? {}) as Record<string, unknown>,
      data.user.email ?? null,
    );
    try {
      await ensureProfile(data.user.id, row.display_name, row.role);
    } catch {
      // The profile may already exist or creation failed; sign-in
      // still succeeded and the provider falls back to user_metadata.
    }
  } catch (error) {
    if (error === genericError) throw error;
    throw genericError;
  }
  return { ok: true };
}

/**
 * Create the profiles row for a newly signed-up user (called from
 * lib/auth.ts signUp and from exchangeAuthCode). The row is created
 * only when the signed-in session belongs to the same user id, and
 * only when no row exists yet — an existing row is never overwritten,
 * so an admin's role can never be downgraded here. The "admin" role
 * can never be assigned here: only "customer" is accepted
 * (see lib/profile-rules.ts).
 *
 * NOTE: with email confirmation on, signUp returns no session, so
 * this call throws at sign-up time and the row is created later —
 * by the database trigger in supabase/migrations/0002_profile_trigger.sql
 * when the auth.users row is inserted, and by
 * ensureCurrentUserProfile() on the first sign-in. Nothing is lost:
 * the row is derived from the user's id, metadata and email, all of
 * which survive sign-up without a session.
 */
export async function ensureProfile(
  userId: string,
  displayName: string,
  role: "customer",
): Promise<{ ok: true }> {
  const genericError = new Error("Could not create your profile. Please try again.");
  let row: { id: string; display_name: string; role: "customer" };
  try {
    row = buildProfileRow(userId, displayName, role);
  } catch {
    throw genericError;
  }

  let admin: SupabaseClient;
  try {
    const supabase = untyped(createClient());
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user || data.user.id !== userId) throw genericError;
    admin = untyped(createAdminClient());
  } catch (error) {
    if (error === genericError) throw error;
    throw genericError;
  }

  const { error } = await admin
    .from("profiles")
    .upsert(row, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw genericError;
  return { ok: true };
}

/**
 * Create a missing profiles row for the currently signed-in user,
 * derived from their own session metadata — no user id is accepted
 * from the caller, so one user can never create a profile for
 * another. Called after a successful password sign-in (lib/auth.ts
 * signIn) and on session load, so a user whose row was never created
 * at sign-up (email confirmation on: no session then) gets their row
 * the first time they sign in. Existing rows are never overwritten
 * (upsert with ignoreDuplicates), so an admin's role can never be
 * downgraded here, and "admin" can never be assigned here.
 * Returns { ok: false } instead of throwing when there is no signed-in
 * user or creation fails — callers treat that as "try again later"
 * and sign-in itself still succeeds.
 */
export async function ensureCurrentUserProfile(): Promise<{ ok: boolean }> {
  try {
    const supabase = untyped(createClient());
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { ok: false };
    const row = deriveProfileFromMetadata(
      data.user.id,
      (data.user.user_metadata ?? {}) as Record<string, unknown>,
      data.user.email ?? null,
    );
    const admin = untyped(createAdminClient());
    const { error: upsertError } = await admin
      .from("profiles")
      .upsert(row, { onConflict: "id", ignoreDuplicates: true });
    if (upsertError) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
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
