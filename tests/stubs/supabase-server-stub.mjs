// Supabase client-factory stub for `node --test` (test-only).
//
// Replaces lib/supabase/server when the stub hook is registered, so
// the real server actions can run under `node --test` against a
// fake admin / public client built by the test (an in-memory stub
// object with .from() / .storage). Tests install their client with
// __setAdminClient() / __setPublicClient() before importing the
// module under test and clear it afterwards. createAdminClient()
// throws when no client is installed, mirroring the real factory
// throwing when the service-role key is missing — the actions
// translate that into their generic error.

let adminClient = null;
let publicClient = null;

/** The client createAdminClient() returns (null = not configured). */
export function __setAdminClient(client) {
  adminClient = client;
}

/** The client createPublicClient() / createClient() returns. */
export function __setPublicClient(client) {
  publicClient = client;
}

export function createAdminClient() {
  if (!adminClient) throw new Error("Supabase is not configured.");
  return adminClient;
}

export function createPublicClient() {
  if (!publicClient) throw new Error("Supabase is not configured.");
  return publicClient;
}

export function createClient() {
  return createPublicClient();
}
