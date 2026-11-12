// Test double for "next/headers", used only by
// tests/admin-stats.test.mjs via tests/admin-stats-hooks.mjs.
//
// cookies() returns the cookies the test currently sets on
// globalThis.__techshotTestCookies (an array of { name, value }),
// which is what Next returns for the request in scope:
// lib/supabase/server.ts reads them with getAll() and set().
// headers() is never called by the code under test and throws,
// like the real one outside a request scope.
export function cookies() {
  return {
    getAll() {
      return globalThis.__techshotTestCookies ?? [];
    },
    get(name) {
      return (globalThis.__techshotTestCookies ?? []).find((c) => c.name === name);
    },
    has(name) {
      return (globalThis.__techshotTestCookies ?? []).some((c) => c.name === name);
    },
    set() {},
  };
}

export function headers() {
  throw new Error("headers() is not available outside a Next.js request");
}
