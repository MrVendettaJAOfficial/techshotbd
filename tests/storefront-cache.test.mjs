// Storefront data-cache tests — TechShot.
//
// The public catalogue + active banners used to be re-fetched from
// Supabase on EVERY storefront visit (force-dynamic everywhere, a
// per-request React cache() only), so a shop with 12 products paid
// 4–8 database round trips per page load — and the home page paid
// them on every visit. Now the catalogue and banners are cached
// across requests in the Next.js data cache (unstable_cache, tags
// "catalog" / "banners", see lib/storefront-cache.ts) and purged on
// demand by every write that changes catalogue-visible data, so a
// repeat visit issues zero catalogue queries while an admin edit
// still shows immediately.
//
// What is proven here (source-level; node --test has no browser):
//   - the cache contract lives in one place (lib/storefront-cache.ts):
//     both tag names and both revalidate helpers, with the helpers
//     calling revalidateTag with the matching tag;
//   - getCatalog() reads through unstable_cache under the catalog tag
//     and the local fallback is never cached (a failed fetch throws,
//     so a transient outage can never pin seed data);
//   - listActiveBanners() reads through unstable_cache under the
//     banners tag, and every banner write purges it;
//   - every write that changes catalogue-visible data purges the
//     catalog tag: product create / update / pause / delete, order
//     placement (stock) and order status changes (stock restore).
//     Review submission is the deliberate exception: it must NOT
//     purge, because a revalidating server action refreshes the
//     route and remounts the review form (wiping the thank-you
//     notice) — the aggregate refreshes on the next product /
//     order / banner write instead;
//   - the cached reads never touch cookies (the data cache forbids
//     dynamic APIs): they use the cookie-less public client;
//   - the home page is static (no force-dynamic) while shop +
//     product stay force-dynamic, and the client router cache for
//     static pages is capped at 30s so an edit shows to shoppers
//     already browsing within half a minute;
//   - middleware still guards /admin only — it never ran on public
//     shop pages (matcher is /admin/:path*), so there is nothing to
//     scope and the session refresh is untouched;
//   - per-user data is never cached: cart, checkout, account, orders,
//     inbox and admin reads do not go through the storefront tags.
//
// What is NOT proven here: the actual query counts. Those are
// measured against the mock log by tests/e2e/storefront-cache.mjs —
// a repeat visit to home / shop / a product page must issue zero
// catalogue queries, and an admin product edit must show on the
// storefront immediately.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// Slice of a file between two markers, so an assertion about one
// function cannot accidentally match a different function's body.
function slice(src, from, to) {
  const start = src.indexOf(from);
  assert.ok(start >= 0, `slice start not found: ${from}`);
  const end = to === undefined ? src.length : src.indexOf(to, start);
  assert.ok(end > start, `slice end not found: ${to}`);
  return src.slice(start, end);
}

test("the cache contract lives in one place: tags + helpers", () => {
  assert.ok(existsSync(new URL("../lib/storefront-cache.ts", import.meta.url)));
  const src = root("lib/storefront-cache.ts");
  assert.match(src, /export const CATALOG_CACHE_TAG = "catalog"/, "catalog tag is exactly \"catalog\"");
  assert.match(src, /export const BANNERS_CACHE_TAG = "banners"/, "banners tag is exactly \"banners\"");
  assert.match(
    slice(src, "export function revalidateCatalogCache", "export function revalidateBannersCache"),
    /revalidateTag\(CATALOG_CACHE_TAG\)/,
    "catalog helper purges the catalog tag",
  );
  assert.match(
    slice(src, "export function revalidateBannersCache"),
    /revalidateTag\(BANNERS_CACHE_TAG\)/,
    "banners helper purges the banners tag",
  );
  // No call site may hardcode its own tag string: the only places a
  // tag is used are the unstable_cache options and the revalidate
  // helpers, and both must reference the shared constant (comments
  // mentioning the tag name are fine — they document it).
  assert.doesNotMatch(root("lib/supabase/catalog.ts"), /tags:\s*\[\s*"catalog"|revalidateTag\("catalog"\)/, "catalog: no hardcoded tag at the use sites");
  assert.doesNotMatch(root("lib/banners-server.ts"), /tags:\s*\[\s*"banners"|revalidateTag\("banners"\)/, "banners: no hardcoded tag at the use sites");
});

test("catalogue: getCatalog reads through unstable_cache under the catalog tag", () => {
  const src = root("lib/supabase/catalog.ts");
  assert.match(src, /import \{ unstable_cache \} from "next\/cache"/, "catalog: imports unstable_cache");
  assert.match(src, /unstable_cache\(/, "catalog: a fetch is wrapped in unstable_cache");
  assert.match(src, /tags: \[CATALOG_CACHE_TAG\]/, "catalog: cached under the shared catalog tag");
  assert.match(src, /import \{ CATALOG_CACHE_TAG \} from "\.\.\/storefront-cache"/, "catalog: tag comes from the shared contract");
  // The cached fetch calls the live fetch with the public client.
  assert.match(
    slice(src, "const fetchCatalogCached", "export async function getCatalog"),
    /getLiveCatalog\(createPublicClient\(\)\)/,
    "catalog: cached fetch uses the cookie-less public client",
  );
  // The local fallback is never cached: it is not inside the
  // unstable_cache callback (the slice above must not mention it),
  // and getCatalog() falls back per visit on a failed fetch.
  assert.doesNotMatch(
    slice(src, "const fetchCatalogCached", "export async function getCatalog"),
    /localCatalog/,
    "catalog: fallback is outside the cached function",
  );
  const getCatalog = slice(src, "export async function getCatalog");
  assert.match(getCatalog, /return await fetchCatalogCached\(\)|const cached = await fetchCatalogCached\(\)/, "catalog: getCatalog reads the cache");
  assert.match(getCatalog, /catch \(error\)[\s\S]*return localCatalog\(\)/, "catalog: a failed fetch falls back per visit");
  // The data cache serializes to JSON, so the flashEndsAt Date comes
  // back as an ISO string: getCatalog() must revive it, or the home
  // page's flashEndsAt.getTime() throws on every cached read.
  assert.match(getCatalog, /flashEndsAt: new Date\(cached\.flashEndsAt\)/, "catalog: flashEndsAt Date is revived after the JSON cache round-trip");
});

test("catalogue: the cached read never touches cookies", () => {
  const src = root("lib/supabase/server.ts");
  assert.match(src, /export function createPublicClient/, "server: cookie-less public client exists");
  const fn = slice(src, "export function createPublicClient");
  assert.doesNotMatch(fn, /cookies\(\)/, "public client: never reads cookies (the data cache forbids it)");
  assert.match(fn, /createSupabaseClient<Database>\(url, anonKey/, "public client: anon key, RLS still applies");
  assert.match(fn, /persistSession: false/, "public client: no session is persisted");
});

test("banners: listActiveBanners reads through unstable_cache under the banners tag", () => {
  const src = root("lib/banners-server.ts");
  assert.match(src, /import \{ revalidatePath, unstable_cache \} from "next\/cache"/, "banners: imports unstable_cache");
  assert.match(src, /tags: \[BANNERS_CACHE_TAG\]/, "banners: cached under the shared banners tag");
  assert.match(
    slice(src, "const fetchActiveBannersCached", "export async function listActiveBanners"),
    /fetchActiveBanners\(untyped\(createPublicClient\(\)\)\)/,
    "banners: cached fetch uses the cookie-less public client",
  );
  // A failed read throws inside the cached function (never cached)
  // and listActiveBanners turns it into an empty list.
  assert.match(
    slice(src, "async function fetchActiveBanners"),
    /throw new Error\("Failed to load banners\."\)/,
    "banners: a failed read throws instead of caching an empty list",
  );
  assert.match(
    slice(src, "export async function listActiveBanners", "export async function listBanners"),
    /catch \{\s*return \[\];\s*\}/,
    "banners: a failed read returns an empty list to the home page",
  );
  // Every banner write purges the tag: create, update, hide/show,
  // delete — four call sites.
  const purgeCount = (src.match(/revalidateBannersCache\(\);/g) ?? []).length;
  assert.equal(purgeCount, 4, `banners: four writes purge the tag (found ${purgeCount})`);
});

test("product writes purge the catalog tag", () => {
  const src = root("lib/products/actions/shared.ts");
  const fn = slice(src, "export function revalidateProductPages");
  assert.match(fn, /revalidateCatalogCache\(\);/, "product writes: revalidateProductPages purges the catalog tag");
  // All four product writes funnel through it: create, update,
  // pause (status) and delete.
  for (const file of ["lib/products/actions/create-update.ts", "lib/products/actions/manage.ts"]) {
    assert.match(root(file), /revalidateProductPages\(/, `${file}: writes go through revalidateProductPages`);
  }
  assert.equal((root("lib/products/actions/create-update.ts").match(/revalidateProductPages\(/g) ?? []).length, 2, "create-update: create + update call it");
  assert.equal((root("lib/products/actions/manage.ts").match(/revalidateProductPages\(/g) ?? []).length, 2, "manage: pause + delete call it");
});

test("order writes purge the catalog tag (stock is catalogue-visible)", () => {
  // Placement decrements stock.
  const create = root("lib/orders/server/create.ts");
  assert.match(create, /revalidateCatalogCache\(\);/, "order placement: purges the catalog tag after stock is decremented");
  // Status changes restore stock on cancel / refund / returned.
  const shared = root("lib/orders/actions/shared.ts");
  assert.match(
    slice(shared, "export function revalidateOrderPages"),
    /revalidateCatalogCache\(\);/,
    "order status changes: revalidateOrderPages purges the catalog tag",
  );
});

test("review submission does NOT purge the catalog tag (deliberate)", () => {
  // The one write that must NOT revalidate: a server action that
  // revalidates makes the client refresh the current route, and
  // that refresh remounts the review form — wiping the thank-you
  // notice and the just-written review, and resetting the gallery
  // tab to Description (see the header comment in
  // components/product-gallery/review-form.tsx, and the comment
  // after the insert in submitReview). The rating aggregate
  // refreshes on the next product / order / banner write instead;
  // the reviews list itself is live per visit, and the form shows
  // the new review from local state immediately.
  const src = root("lib/reviews.ts");
  const fn = slice(src, "export async function submitReview");
  assert.doesNotMatch(fn, /revalidateCatalogCache/, "reviews: submitReview must not purge — the refresh would remount the form");
  assert.doesNotMatch(src, /from "\.\/storefront-cache"/, "reviews: no storefront-cache import at all");
});

test("home is static, shop + product stay force-dynamic", () => {
  // Anchored at line start: the home page's header comment mentions
  // the export by name, so an unanchored match would hit the comment.
  assert.doesNotMatch(root("app/page.tsx"), /^export const dynamic = "force-dynamic"/m, "home: no force-dynamic — prerenders at build time");
  assert.match(root("app/shop/page.tsx"), /export const dynamic = "force-dynamic"/, "shop: still force-dynamic (filters via searchParams)");
  assert.match(root("app/product/[slug]/page.tsx"), /export const dynamic = "force-dynamic"/, "product: still force-dynamic (live reviews + eligibility)");
  // The home page only reads public cached data — no per-user fetch.
  const home = root("app/page.tsx");
  assert.match(home, /getCatalog\(\)/, "home: reads the catalogue");
  assert.match(home, /listActiveBanners\(\)/, "home: reads the banners");
  assert.doesNotMatch(home, /getCurrentUser|listProductReviews/, "home: no per-user read");
});

test("client router cache for static pages is capped at 30s", () => {
  const config = root("next.config.mjs");
  assert.match(config, /staleTimes:\s*\{\s*static: 30,?\s*\}/, "next.config: static staleTime is 30s");
  assert.doesNotMatch(config, /dynamic:\s*\d+/, "next.config: dynamic staleTime untouched (default 0)");
});

test("middleware still guards /admin only — nothing to scope", () => {
  const src = root("middleware.ts");
  assert.match(src, /matcher:\s*\["\/admin\/:path\*"\]/, "middleware: matcher is /admin only — public shop pages never paid for getUser()");
  assert.match(src, /getUser/, "middleware: still validates the session on /admin");
});

test("per-user data never goes through the storefront tags", () => {
  // Cart, checkout, account, orders, inbox and admin reads must not
  // import the cache contract at all.
  for (const file of [
    "lib/cart/server/shared.ts",
    "lib/orders/server/shared.ts",
    "lib/orders/server/list.ts",
    "lib/account-server.ts",
    "lib/inbox-server.ts",
    "lib/products/queries.ts",
  ]) {
    assert.doesNotMatch(root(file), /storefront-cache|CATALOG_CACHE_TAG|BANNERS_CACHE_TAG/, `${file}: no storefront cache`);
  }
});
