// Module customization hook for tests/signup-oracle.test.mjs and
// tests/change-password-revoke.test.mjs.
//
// Registered by those test files with module.register() BEFORE they
// import the app code. Two imports cannot exist under plain Node as
// the app loads them, so this hook maps them to faithful test
// doubles (the app code under test stays real):
//
//   - "next/headers" -> tests/admin-stats-next-headers-stub.mjs
//     (shared with tests/admin-stats.test.mjs). lib/auth.ts reaches
//     it through lib/auth-server/* (server actions); the stub
//     returns the cookies the test sets on
//     globalThis.__techshotTestCookies.
//   - "react" -> tests/auth-react-stub.mjs. lib/auth.ts is a Client
//     Component and uses createContext / useState / useEffect /
//     useMemo / useContext / createElement from real React, which
//     plain Node CAN load - but lib/auth-server/session.ts also
//     imports cache() from "react", which the installed React
//     18.3.1 does not export under Node's default conditions (Next
//     resolves the react-server condition for server components).
//     The stub re-exports real React and adds cache() as the
//     identity function, which is the correct emulation here:
//     every call in these tests is its own request, so no
//     memoization across calls is the right semantics.
//
// Every other specifier passes through to the next resolver (the
// repo's ts-hooks, registered via --import, still resolves the @/
// alias and extensionless relative imports).

const HEADERS_STUB = new URL("./admin-stats-next-headers-stub.mjs", import.meta.url).href;
const REACT_STUB = new URL("./auth-react-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/headers") {
    return { url: HEADERS_STUB, shortCircuit: true };
  }
  if (specifier === "react") {
    return { url: REACT_STUB, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
