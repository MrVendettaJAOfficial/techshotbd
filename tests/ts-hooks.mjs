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
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_ROOT = path.resolve(import.meta.dirname, "..");

// A candidate only counts when it is a real file. Since the cleanup,
// several modules live next to a same-named directory (e.g. the
// `lib/orders/actions.ts` barrel beside `lib/orders/actions/`), and a
// bare `existsSync` would return the directory and make Node throw
// EISDIR on an extensionless import.
function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

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
    if (isFile(candidate)) return candidate;
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
