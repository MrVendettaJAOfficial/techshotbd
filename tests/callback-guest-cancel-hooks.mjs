// Module customization hook for tests/callback-guest-cancel.test.mjs.
//
// Registered by that test file with module.register() AFTER
// tests/next-stub-hooks.mjs (so this hook resolves first and chains
// everything else to it). One mapping only:
//
//   - "react" -> tests/admin-stats-react-stub.mjs, which exports
//     only cache(). The installed React 18.3.1 has no cache export
//     under Node's default conditions (Next resolves the
//     react-server condition for server components); the stub's
//     identity function is the correct emulation here, because
//     every cancel / callback call in the test is its own request,
//     so no memoization across calls is the right semantics —
//     and the only react import in the code under test is cache()
//     in lib/orders/server/shared.ts.
//
// Every other specifier passes through to the next resolver (the
// next-stub-hooks and ts-hooks resolvers registered before this one).
const REACT_STUB = new URL("./admin-stats-react-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "react") {
    return { url: REACT_STUB, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
