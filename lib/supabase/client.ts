// TechShot marketplace — Supabase browser client.
// For Client Components only. Uses the public anon key, so every query is
// still subject to Row Level Security (see supabase/policies.sql).
// The URL and anon key are public by design; the service-role key must
// never appear here — it lives only in lib/supabase/server.ts.

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
