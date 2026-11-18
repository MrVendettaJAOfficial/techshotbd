// Minimal "react" stand-in for `node --test` (test-only).
//
// Plain Node resolves "react" to the installed React 18 CJS
// build, which has no `cache` export — Next.js provides React's
// `cache` (per-request memoisation) at runtime. The server
// modules under test import ONLY `cache` from react
// (lib/orders/server/shared.ts, lib/auth-server/session.ts), so
// this stub provides exactly that, as the identity function: no
// cross-request reuse happens in a one-shot test process anyway.
// Only reachable through tests/react-cache-stub-hooks.mjs.
export function cache(fn) {
  return fn;
}
