// Test double for "react", used only by tests/admin-stats.test.mjs
// via tests/admin-stats-hooks.mjs. The installed React 18.3.1
// exports no cache() under Node's default conditions (Next
// resolves the react-server condition for server components), and
// the only react import in the code under test is cache() in
// lib/auth-server/session.ts. The identity function is the correct
// emulation of React's per-request cache() here: every
// getAdminStats() call in the test is its own request, so no
// memoization across calls is the right semantics.
export function cache(fn) {
  return fn;
}
