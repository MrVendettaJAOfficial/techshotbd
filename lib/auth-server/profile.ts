// TechShot marketplace — server-side profile creation.
//
// SERVER ONLY. This file is a server-actions module ("use server"):
// lib/auth.ts (client) imports ensureProfile from here to create
// the profiles row after sign-up. A server action is the only safe
// way for browser code to reach this file: the service-role client
// below must never be bundled into the browser.
//
// Split from lib/auth-server.ts: profile creation lives here,
// session helpers in ./session, admin user management in
// ./admin-users. lib/auth-server.ts re-exports all three.

"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient, createClient } from "../supabase/server";

import {
  buildProfileRow,
  deriveProfileFromMetadata,
} from "../profile-rules";

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
