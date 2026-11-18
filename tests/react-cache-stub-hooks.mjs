// Module customization hook for `node --test` (test-only).
//
// Maps the bare specifier "react" to tests/stubs/react-stub.mjs
// (see that file for why: plain Node's React 18 has no `cache`
// export, and the server modules under test import only `cache`
// from react). Registered from inside a test file with
//   module.register("./react-cache-stub-hooks.mjs", import.meta.url)
// BEFORE the dynamic import of the module under test. Each test
// file runs in its own process under `node --test`, so the mapping
// affects only that file; every other specifier chains to the
// next hook.
import path from "node:path";
import { pathToFileURL } from "node:url";

const STUB = pathToFileURL(path.join(import.meta.dirname, "stubs", "react-stub.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "react") {
    return { url: STUB, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
