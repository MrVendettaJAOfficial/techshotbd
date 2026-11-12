// Module customization hook for tests/admin-stats.test.mjs.
//
// Registered by that test file with module.register() BEFORE it
// imports the app code. Two Next.js runtime imports cannot exist
// under plain Node, so this hook maps them to faithful test
// doubles (the app code under test stays real):
//
//   - "next/headers" -> tests/admin-stats-next-headers-stub.mjs.
//     The real cookies() returns the current request's cookies;
//     the stub returns the cookies the test sets on
//     globalThis.__techshotTestCookies, which is exactly the
//     request-scope behaviour. Outside a request scope the real
//     cookies() throws; the test never calls it with no cookies
//     set for a signed-in case, and an empty list is what an
//     anonymous request carries anyway.
//
//   - "react" -> tests/admin-stats-react-stub.mjs, which exports
//     only cache(). The installed React 18.3.1 has no cache export
//     under Node's default conditions (Next resolves the
//     react-server condition for server components); the stub's
//     identity function is the correct emulation of React's
//     per-request cache() here, because every getAdminStats()
//     call in the test is its own request, so no memoization
//     across calls is the right semantics.
//
// Every other specifier passes through to the next resolver (the
// repo's ts-hooks, registered via --import, still resolves the @/
// alias and extensionless relative imports).

const HEADERS_STUB = new URL("./admin-stats-next-headers-stub.mjs", import.meta.url).href;
const REACT_STUB = new URL("./admin-stats-react-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/headers") {
    return { url: HEADERS_STUB, shortCircuit: true };
  }
  if (specifier === "react") {
    return { url: REACT_STUB, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
