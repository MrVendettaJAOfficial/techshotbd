// TechShot marketplace — Supabase server clients.
// SERVER ONLY. Never import this file from a Client Component: it reads
// the service-role key, which bypasses Row Level Security and must never
// reach the browser.
//
//   createClient()      — per-request client for Server Components, Route
//                         Handlers and Server Actions. Uses the anon key
//                         with the user's cookies, so RLS still applies.
//   createAdminClient() — service-role client for trusted server work
//                         only (order creation, stock updates, payment
//                         callbacks, admin actions). Bypasses RLS, so
//                         callers must enforce their own checks.
//   isSupabaseConfigured() — zero-round-trip "is Supabase configured"
//                         check: env vars only, no network. Pages
//                         that only need the configured flag (the
//                         admin Banners / Messages / Orders tabs) use
//                         this instead of a throwaway catalogue query.

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

/**
 * True when the Supabase env vars are all set. Zero round trips —
 * it reads process.env only, so it never waits on the database.
 * It answers "is the install configured", not "is the database
 * reachable": with the vars set and the database down it still
 * returns true, and the callers' own queries then fail with their
 * generic errors (the Banners / Messages / Orders sections already
 * handle that). Never log or return which variable is missing.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function createClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as never),
            );
          } catch {
            // setAll is called from a Server Component, where setting
            // cookies is not allowed. The Supabase middleware refreshes
            // the session in that case, so this is safe to ignore.
          }
        },
      },
    },
  );
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    // Generic message on purpose: never log or return the key, and never
    // reveal which of the two values is missing.
    throw new Error("Supabase service role is not configured.");
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
