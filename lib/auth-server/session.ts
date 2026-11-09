// TechShot marketplace — server-side session helpers.
//
// SERVER ONLY. This file is a server-actions module ("use server"):
// server components and other server actions import getCurrentUser
// directly. (There is no seller verification any more: TechShot is
// single-seller, products are managed only in /admin.)
//
// When Supabase is not configured, or there is no signed-in user,
// getCurrentUser returns null instead of throwing — callers treat
// null as "not signed in".
//
// Split from lib/auth-server.ts: session helpers live here, profile
// creation in ./profile, admin user management in ./admin-users.
// lib/auth-server.ts re-exports all three.

"use server";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "../supabase/server";

import { deriveProfileFromMetadata } from "../profile-rules";

import { ensureProfile } from "./profile";

import type { AppUser, UserRole } from "../auth";

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
  // A legacy "seller" role is not a valid app role any more: it is
  // treated as "customer". Staff roles (co_admin, manager —
  // migration 0006) are real roles now.
  return value === "customer" || value === "admin" || value === "co_admin" || value === "manager";
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
 * The signed-in caller's profiles.role, or null when signed out /
 * Supabase is not configured / the caller has no profiles row.
 * Never throws. This is the role the server actions enforce with
 * (see lib/roles.ts): it is read from the database on every call,
 * never taken from the browser. A legacy "seller" row reads back as
 * "customer" (see isValidRole above).
 */
export async function getCallerRole(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.role ?? null;
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
