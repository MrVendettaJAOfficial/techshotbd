// Performance-fix tests — TechShot.
//
// Measured before (2026-11-09, local mock Supabase — see the timing
// notes in progress.md): production was already fast per page, but
// two things were slow in real use —
//   1. cold next/image optimisation of real photos with squoosh
//      (1.4–2.5s per photo, re-done every 60s because the default
//      minimumCacheTTL is 60s), and dev-mode first-hit compile
//      (6–10s per page);
//   2. serial Supabase round trips: a product page fetched the
//      catalogue three times per visit (up to 6 round trips), the
//      account page ran 6–7 serial queries, the admin page ~10,
//      and getUser() was re-validated on every call inside a request.
//
// What is proven here (source-level; node --test has no browser):
//   - the product page resolves product + related + metadata from a
//     single getCatalog() call, which is per-request cached;
//   - getAccountData() fetches addresses / wishlist / orders in
//     parallel instead of one after another;
//   - fetchAllProducts() / loadExtras() fetch categories + extras
//     and images + variants in parallel;
//   - getUser() is deduped per request with React cache() in all
//     three server modules that read the session;
//   - sharp is installed and the optimised-image cache is a day, so
//     a photo is optimised once, not every minute;
//   - nothing that makes the site safe or fresh was weakened to buy
//     speed: the middleware auth gate still runs on /admin,
//     force-dynamic is kept where freshness matters, and the cache
//     is per-request only (prices / stock re-fetch every visit).
//
// What is NOT proven here: the actual timings. Those are measured
// with the real servers (see progress.md for the before/after
// table) — a source test cannot time a network.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("product page: one catalogue fetch for product + related + metadata", () => {
  const src = root("app/product/[slug]/page.tsx");
  // Single source: getCatalog, not the old per-product / per-related
  // queries (each of which fetched the catalogue again).
  assert.match(src, /getCatalog/, "product page: uses getCatalog");
  assert.doesNotMatch(src, /getLiveProduct|getLiveRelated/, "product page: no per-product / per-related fetch");
  assert.match(src, /relatedProducts/, "product page: related products derived from the same catalogue");
  // Both resolvers read from the one fetch.
  assert.match(src, /resolveProduct[\s\S]*getCatalog\(\)/, "product page: product resolves from getCatalog");
  assert.match(src, /resolveRelated[\s\S]*getCatalog\(\)/, "product page: related resolves from getCatalog");
  // Freshness kept: the page is still force-dynamic, never stale.
  assert.match(src, /export const dynamic = "force-dynamic"/, "product page: still force-dynamic");
});

test("catalogue: getCatalog is per-request cached, old helpers removed", () => {
  const src = root("lib/supabase/catalog.ts");
  assert.match(src, /import \{ cache \} from "react"/, "catalog: imports React cache()");
  assert.match(src, /cache\(async/, "catalog: getCatalog is wrapped in cache()");
  assert.doesNotMatch(src, /getLiveProduct|getLiveRelated/, "catalog: removed helpers are gone");
  // Still one live fetch (categories + products in parallel) with
  // the local fallback when Supabase is down.
  assert.match(src, /getLiveCatalog/, "catalog: live fetch still exists");
  assert.match(src, /localCatalog\(\)/, "catalog: local fallback kept");
});

test("account: addresses, wishlist and orders fetched in parallel", () => {
  const src = root("lib/account-server.ts");
  const block = src.slice(src.indexOf("getAccountData"));
  assert.match(block, /Promise\.all\(\[/, "account: getAccountData parallelises");
  const parallel = block.slice(block.indexOf("Promise.all(["));
  assert.match(parallel, /from\("addresses"\)/, "account: addresses in the parallel block");
  assert.match(parallel, /from\("wishlists"\)/, "account: wishlist in the parallel block");
  assert.match(parallel, /listSupabaseOrders\(\)/, "account: orders in the parallel block");
});

test("admin: categories + extras and images + variants fetched in parallel", () => {
  const src = root("lib/products/queries.ts");
  // loadExtras: images and variants together.
  const extras = src.slice(src.indexOf("async function loadExtras"));
  assert.match(extras, /Promise\.all\(\[/, "admin: loadExtras parallelises");
  assert.match(extras, /from\("product_images"\)/, "admin: images in the parallel block");
  assert.match(extras, /from\("product_variants"\)/, "admin: variants in the parallel block");
  // fetchAllProducts: categories and extras together.
  const all = src.slice(src.indexOf("export async function fetchAllProducts"));
  assert.match(all, /Promise\.all\(\[/, "admin: fetchAllProducts parallelises");
  assert.match(all, /loadExtras\(admin, productIds\)/, "admin: extras in the parallel block");
  assert.match(all, /from\("categories"\)/, "admin: categories in the parallel block");
});

test("getUser() is deduped per request with React cache()", () => {
  // lib/auth-server.ts, lib/orders-server.ts and lib/cart-server.ts
  // are now re-export barrels: the cached session reads live in
  // lib/auth-server/session.ts, lib/orders/server/shared.ts and
  // lib/cart/server/shared.ts.
  for (const file of ["lib/auth-server/session.ts", "lib/orders/server/shared.ts", "lib/cart/server/shared.ts"]) {
    const src = root(file);
    assert.match(src, /import \{ cache \} from "react"/, `${file}: imports React cache()`);
    assert.match(src, /cache\(async/, `${file}: session read is wrapped in cache()`);
  }
  // The cached helpers are still reached through the same names.
  assert.match(root("lib/auth-server/session.ts"), /export async function getCurrentUser/, "auth: getCurrentUser still exported");
  assert.match(root("lib/orders/server/shared.ts"), /async function getSignedInUserId/, "orders: getSignedInUserId still present");
  assert.match(root("lib/orders/server/shared.ts"), /async function getSignedInUser/, "orders: getSignedInUser still present");
  assert.match(root("lib/cart/server/shared.ts"), /async function getSignedInUserId/, "cart: getSignedInUserId still present");
});

test("images: sharp installed and optimised-image cache is one day", () => {
  const pkg = JSON.parse(root("package.json"));
  assert.ok(pkg.dependencies?.sharp, "package.json: sharp is a dependency");
  const config = root("next.config.mjs");
  assert.match(config, /minimumCacheTTL: 86400/, "next.config: minimumCacheTTL is one day (86400s)");
});

test("nothing safe or fresh was weakened to buy speed", () => {
  // The middleware auth gate still guards /admin on every request.
  const middleware = root("middleware.ts");
  assert.match(middleware, /matcher:\s*\["\/admin\/:path\*"\]/, "middleware: still guards /admin");
  assert.match(middleware, /getUser/, "middleware: still validates the session");
  // Freshness kept on the storefront pages.
  for (const file of ["app/page.tsx", "app/shop/page.tsx", "app/product/[slug]/page.tsx"]) {
    assert.match(root(file), /export const dynamic = "force-dynamic"/, `${file}: still force-dynamic`);
  }
});
