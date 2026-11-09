// Supabase Auth for TechShot.
//
// The demo localStorage auth store is gone: sign-up, sign-in and sign-out
// all go through Supabase Auth (lib/supabase/client, browser client), and
// the user's display name / role come from the `profiles` table. When
// Supabase is not configured (no NEXT_PUBLIC_SUPABASE_URL /
// NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment), auth calls fail with
// a generic message and nothing is stored locally — there is no demo
// account, no demo admin, and no local password hash anywhere.
//
// Single-seller store: sign-up only ever creates a `customer`. The
// `admin` role can never be assigned here (or by the profile server
// action in lib/auth-server.ts); admins are granted manually in the
// database. The owner is the only seller and manages products in
// /admin. A legacy "seller" role value (old metadata / old profile
// row) is treated as "customer" — it grants no selling rights.
//
// The useAuth() return shape and the AppUser type are unchanged from
// the demo version, so Header / account / admin / checkout pages
// keep working without changes.

"use client";

import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import { ensureCurrentUserProfile, ensureProfile } from "./auth-server";

export type UserRole = "customer" | "admin" | "co_admin" | "manager";

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface AuthSession {
  user: AppUser;
  createdAt: string;
}

const signUpSchema = z.object({
  displayName: z.string().trim().min(2, "Please enter your name (at least 2 characters)."),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  role: z.literal("customer"),
});

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  password: z.string().min(1, "Please enter your password."),
});

function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * The Supabase Database generic resolves query results to `never`
 * with the installed supabase-js version (see lib/auth-server.ts and
 * lib/products/queries.ts), so this file talks to the untyped client
 * and casts profile rows to the local shape below. Runtime behaviour
 * is unchanged.
 */
function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function notConfiguredError(): Error {
  return new Error("Sign-in is not available right now. Please try again later.");
}

function isValidRole(value: unknown): value is UserRole {
  // A legacy "seller" role is not a valid app role any more: it is
  // treated as "customer" (see toAppUser below). Staff roles
  // (co_admin, manager — migration 0006) are real roles now.
  return value === "customer" || value === "admin" || value === "co_admin" || value === "manager";
}

/** Build the AppUser the rest of the app sees: profile row first,
 *  user_metadata as a fallback when no profile row exists yet. */
async function toAppUser(
  supabase: SupabaseClient,
  authUser: User,
): Promise<AppUser> {
  let displayName = "";
  let role: UserRole = "customer";
  try {
    const { data } = (await supabase
      .from("profiles")
      .select("display_name, role")
      .eq("id", authUser.id)
      .maybeSingle()) as {
      data: { display_name: string | null; role: unknown } | null;
    };
    if (data) {
      if (typeof data.display_name === "string" && data.display_name) {
        displayName = data.display_name;
      }
      if (isValidRole(data.role)) role = data.role;
    }
  } catch {
    // Profile read failed — fall back to user_metadata below.
  }
  const metadata = (authUser.user_metadata ?? {}) as Record<string, unknown>;
  if (!displayName && typeof metadata.display_name === "string" && metadata.display_name) {
    displayName = metadata.display_name;
  }
  if (!displayName) displayName = authUser.email?.split("@")[0] ?? "TechShot customer";
  // Legacy metadata claiming role "seller" is ignored: sign-up only
  // ever creates customers now.
  return { id: authUser.id, email: authUser.email ?? "", displayName, role };
}

async function loadSession(): Promise<AuthSession | null> {
  if (!isSupabaseConfigured()) return null;
  let supabase: SupabaseClient;
  try {
    supabase = untyped(createClient());
  } catch {
    return null;
  }
  try {
    const { data } = await supabase.auth.getSession();
    const authUser = data.session?.user;
    if (!authUser) return null;
    // A user whose profiles row was never created at sign-up (email
    // confirmation on: no session then) gets it now, on session load.
    // Existing rows are never overwritten; failures are ignored here
    // because the database trigger is the other safety net.
    try {
      await ensureCurrentUserProfile();
    } catch {
      // Profile creation is retried on the next sign-in.
    }
    const user = await toAppUser(supabase, authUser);
    return { user, createdAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

/** Current session, or null when nobody is signed in (or Supabase is not
 *  configured). Async: the session lives in Supabase cookies, not in
 *  localStorage, so it cannot be read synchronously. */
export async function getSession(): Promise<AuthSession | null> {
  return loadSession();
}

export async function signUp(input: {
  displayName: string;
  email: string;
  password: string;
  role: "customer";
}): Promise<AuthSession> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  }
  if (!isSupabaseConfigured()) throw notConfiguredError();
  const { displayName, email, password, role } = parsed.data;
  let supabase: SupabaseClient;
  try {
    supabase = untyped(createClient());
  } catch {
    throw notConfiguredError();
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName, role },
      emailRedirectTo:
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback`
          : undefined,
    },
  });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      throw new Error("An account with this email already exists. Please sign in instead.");
    }
    throw new Error("Could not create your account. Please try again.");
  }
  const authUser = data.user;
  if (!authUser) {
    throw new Error("Could not create your account. Please try again.");
  }
  // Create / ensure the profiles row (id = auth user id). The server
  // action validates the role and can never create an admin. With
  // email confirmation on, signUp returns no session, so this throws
  // here — that is expected, not a failure: the row is then created
  // by the database trigger (supabase/migrations/0002_profile_trigger.sql)
  // and again on the first sign-in (ensureCurrentUserProfile).
  try {
    await ensureProfile(authUser.id, displayName, role);
  } catch {
    // Profile creation is retried on the first sign-in (see signIn)
    // and by the database trigger; sign-up itself still succeeded.
  }
  if (!data.session) {
    // Email confirmation is on: there is no session yet. The account
    // exists, but the user must confirm first.
    throw new Error(
      "Please check your email to confirm your account, then sign in.",
    );
  }
  const user = await toAppUser(supabase, authUser);
  return { user, createdAt: new Date().toISOString() };
}

export async function signIn(input: { email: string; password: string }): Promise<AuthSession> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
  }
  if (!isSupabaseConfigured()) throw notConfiguredError();
  const { email, password } = parsed.data;
  let supabase: SupabaseClient;
  try {
    supabase = untyped(createClient());
  } catch {
    throw notConfiguredError();
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    const message = error?.message ?? "";
    if (/invalid login credentials/i.test(message)) {
      throw new Error("The email or password is incorrect. Please try again.");
    }
    if (/email not confirmed/i.test(message)) {
      throw new Error("Please confirm your email first, then sign in.");
    }
    throw new Error("Sign-in failed. Please try again.");
  }
  // The user now has a session: create their profiles row if it was
  // never created at sign-up (email confirmation on: no session then).
  // Existing rows are never overwritten and "admin" can never be
  // assigned here; a failure does not block sign-in because the
  // database trigger is the other safety net.
  try {
    await ensureCurrentUserProfile();
  } catch {
    // Profile creation is retried on the next session load.
  }
  const user = await toAppUser(supabase, data.user);
  return { user, createdAt: new Date().toISOString() };
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = untyped(createClient());
    await supabase.auth.signOut();
  } catch {
    // Already signed out / unconfigured — nothing to do.
  }
}

interface AuthContextValue {
  session: AuthSession | null;
  user: AppUser | null;
  loading: boolean;
  refresh: () => void;
  signOutUser: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  refresh: () => {},
  signOutUser: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    void loadSession().then(setSession);
  };

  useEffect(() => {
    let cancelled = false;
    void loadSession().then((next) => {
      if (!cancelled) {
        setSession(next);
        setLoading(false);
      }
    });
    let unsubscribe: (() => void) | undefined;
    try {
      if (isSupabaseConfigured()) {
        const supabase = untyped(createClient());
        const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          if (cancelled) return;
          if (!nextSession?.user) {
            setSession(null);
            return;
          }
          void toAppUser(supabase, nextSession.user).then((user) =>
            setSession({
              user,
              createdAt: new Date().toISOString(),
            }),
          );
        });
        unsubscribe = () => data.subscription.unsubscribe();
      }
    } catch {
      // Supabase not configured — stay signed out.
    }
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      refresh,
      signOutUser: () => {
        setSession(null);
        void signOut();
      },
    }),
    [session, loading],
  );

  // createElement (not JSX): this file is lib/auth.ts, and .ts files
  // cannot contain JSX. The provider renders exactly the same tree.
  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
