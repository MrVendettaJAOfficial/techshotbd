// "next/headers" stub for `node --test` (test-only).
//
// The real module cannot be imported under plain Node. Nothing
// under test reads cookies or headers directly — the Supabase
// client factory and the auth session (both stubbed separately in
// tests/stubs/) are the only callers — so these throw if anything
// ever calls them in a test, instead of silently returning a fake
// request scope.

export function cookies() {
  throw new Error("cookies() is not available in unit tests");
}

export function headers() {
  throw new Error("headers() is not available in unit tests");
}
