// Module customization hooks for `node --test`.
//
// The app's TypeScript uses the `@/` path alias (tsconfig paths) and
// extensionless relative imports, which plain Node cannot resolve.
// This hook maps those to real files under the repo root so tests can
// import the REAL app modules (lib/orders.ts, lib/payments/*, ...)
// instead of re-implementing their rules as stubs. Node 24 strips the
// erasable TypeScript types in those files, so no build step is needed.
//
// Only `@/...` and relative specifiers are intercepted; bare package
// imports (zod, node:...) and node: builtins pass through untouched.
//
// Registered by tests/register-ts-loader.mjs (see package.json "test").
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_ROOT = path.resolve(import.meta.dirname, "..");

function probeFile(base) {
  if (base.endsWith(".css")) return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = probeFile(path.join(SOURCE_ROOT, specifier.slice(2)));
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const parentPath = fileURLToPath(context.parentURL);
    const resolved = probeFile(path.resolve(path.dirname(parentPath), specifier));
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
