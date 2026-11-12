// Next.js runtime stubs for `node --test` (test-only).
//
// Plain Node cannot resolve "next/cache" or "next/headers", so any
// real server module that imports them (product actions,
// banners-server, the catalogue) cannot be imported under
// `node --test` at all. This hook maps those two specifiers —
// plus the auth + Supabase client factories, so tests can run the
// real server actions against a stub admin client and a stub staff
// user — to tiny local stubs. Only the listed specifiers are
// rerouted; everything else chains to the next hook (the `@/`
// alias + extensionless resolver in tests/ts-hooks.mjs).
//
// Registered from inside a test file with
//   module.register("./next-stub-hooks.mjs", import.meta.url)
// BEFORE the dynamic import of the module under test. Static
// imports in the test file are resolved before that call, so the
// modules under test MUST be imported dynamically afterwards.
// Each test file runs in its own process under `node --test`, so
// registering this hook affects only that file.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_ROOT = path.resolve(import.meta.dirname, "..");
const STUBS_DIR = import.meta.dirname;

// Specifier (as written in source) -> stub file in tests/stubs/.
const BY_SPECIFIER = new Map([
  ["next/cache", "next-cache.mjs"],
  ["next/headers", "next-headers.mjs"],
]);

// Absolute file (no extension) -> stub file. Covers both the `@/`
// alias and relative imports of the same module.
const BY_FILE = new Map([
  [path.join(SOURCE_ROOT, "lib", "auth-server"), "auth-server-stub.mjs"],
  [path.join(SOURCE_ROOT, "lib", "auth-server", "session"), "auth-server-stub.mjs"],
  [path.join(SOURCE_ROOT, "lib", "supabase", "server"), "supabase-server-stub.mjs"],
]);

function stubUrl(file) {
  return pathToFileURL(path.join(STUBS_DIR, "stubs", file)).href;
}

function fileCandidates(resolved) {
  return [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`, `${resolved}.mjs`];
}

export async function resolve(specifier, context, nextResolve) {
  if (BY_SPECIFIER.has(specifier)) {
    return { url: stubUrl(BY_SPECIFIER.get(specifier)), shortCircuit: true };
  }
  let resolved = null;
  if (specifier.startsWith("@/")) {
    resolved = path.join(SOURCE_ROOT, specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    resolved = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (resolved) {
    for (const candidate of fileCandidates(resolved)) {
      if (BY_FILE.has(candidate)) {
        return { url: stubUrl(BY_FILE.get(candidate)), shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
