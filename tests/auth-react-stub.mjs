// Test double for "react", used only by tests/signup-oracle.test.mjs
// and tests/change-password-revoke.test.mjs via tests/auth-hooks.mjs.
//
// Re-exports the real installed React (lib/auth.ts is a Client
// Component and uses its hooks and createElement) and adds the one
// export plain Node cannot see: cache(). The installed React 18.3.1
// exports no cache() under Node's default conditions (Next resolves
// the react-server condition for server components); the only react
// import in the server code under test is cache() in
// lib/auth-server/session.ts. The identity function is the correct
// emulation of React's per-request cache() here: every call in
// these tests is its own request, so no memoization across calls is
// the right semantics.
//
// The names are re-exported one by one (not `export *`): React's
// entry point re-exports its production bundle with require(), which
// Node's CJS named-export detection cannot follow, so `export *`
// would expose none of them. The import uses the file path, not the
// bare "react" specifier: the resolve hook maps "react" to this very
// file, so importing "react" here would import this stub itself.
import React from "../node_modules/react/index.js";

export default React;
export const createContext = React.createContext;
export const createElement = React.createElement;
export const useContext = React.useContext;
export const useEffect = React.useEffect;
export const useMemo = React.useMemo;
export const useState = React.useState;

export function cache(fn) {
  return fn;
}
