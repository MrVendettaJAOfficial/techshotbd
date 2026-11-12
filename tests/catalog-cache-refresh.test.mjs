// Catalogue-cache refresh tests — TechShot.
//
// Covers the 2026-11-12 fix for audit run-1 finding #14
// (techshot-cache-degraded-catalog-pinned): a degraded catalogue
// (zero ratings, lost flash-deal memberships after a transient
// read failure) was cached under the "catalog" tag with no expiry
// and no refresh trigger — banner writes purged only the banners
// tag, and review submission deliberately never purges, so the
// degraded copy was served until an unrelated product or order
// write happened to purge the tag.
//
// What is proven here:
//   - the cached catalogue self-heals: fetchCatalogCached sets
//     revalidate: 60, so a degraded fill expires within a minute;
//   - every banner write purges the catalog tag too — create,
//     update, hide/show and delete (four call sites, each right
//     after the banners-tag purge). The behavioural half of this
//     — the real actions recording both tag purges — is proven by
//     tests/banner-storage-quota.test.mjs, which runs the real
//     createBanner / updateBanner / setBannerActive /
//     deleteBanner against a fake client and reads the recorded
//     revalidateTag calls;
//   - submitReview still does NOT purge the catalog tag (the
//     deliberate exception: a revalidating server action would
//     refresh the route and remount the review form, wiping the
//     thank-you notice). Its behaviour is unchanged — only the
//     comment is corrected, and the 60-second revalidate is what
//     refreshes the aggregate after a review now;
//   - the stale comments are corrected: no comment still promises
//     a banner-write refresh that never happened, or lists review
//     submission as a catalogue purger;
//   - the real revalidateCatalogCache helper purges the "catalog"
//     tag (run through the next/cache stub, which records the call).
//
// What is NOT proven here: the degraded fill itself (a transient
// reviews / product_categories read failure resolving to zero
// ratings) — the tolerant helpers are unchanged by this fix, and
// their behaviour is covered by tests/catalog-ratings.test.mjs.
// The fix bounds how long a degraded fill can be served; it does
// not make the fill fail.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./next-stub-hooks.mjs", import.meta.url);

import { revalidateTagCalls } from "./stubs/next-cache.mjs";

const storefrontCache = await import("../lib/storefront-cache.ts");

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

test("the cached catalogue revalidates after 60 seconds", () => {
  const src = root("lib/supabase/catalog.ts");
  const cached = slice(src, "const fetchCatalogCached", "export async function getCatalog");
  assert.match(cached, /\{\s*tags: \[CATALOG_CACHE_TAG\], revalidate: 60\s*\}/, "catalog: unstable_cache sets revalidate: 60 alongside the catalog tag");
  assert.match(
    slice(src, "The live catalogue, cached across requests", "const fetchCatalogCached"),
    /revalidate: 60 bounds how long a fill can be served/,
    "catalog: the comment says why the interval exists (a degraded fill self-heals within a minute)",
  );
});

test("every banner write purges the catalog tag as well as the banners tag", () => {
  const src = root("lib/banners-server.ts");
  // Four banner writes, four catalog purges — one right after
  // each banners-tag purge.
  assert.equal((src.match(/revalidateCatalogCache\(\);/g) ?? []).length, 4, "banners: four writes purge the catalog tag");
  assert.equal((src.match(/revalidateBannersCache\(\);\n    revalidateCatalogCache\(\);/g) ?? []).length, 4, "banners: each catalog purge follows its banners purge");
  for (const fn of ["export async function createBanner", "export async function updateBanner", "export async function setBannerActive", "export async function deleteBanner"]) {
    const body = slice(src, fn);
    assert.match(body, /revalidateBannersCache\(\);\n    revalidateCatalogCache\(\);/, `${fn}: purges both tags`);
  }
  assert.match(src, /import \{ BANNERS_CACHE_TAG, revalidateBannersCache, revalidateCatalogCache \} from "\.\/storefront-cache"/, "banners: the catalog helper comes from the shared contract");
});

test("revalidateCatalogCache purges the catalog tag (real helper)", () => {
  revalidateTagCalls.length = 0;
  storefrontCache.revalidateCatalogCache();
  assert.deepEqual(revalidateTagCalls, ["catalog"]);
  revalidateTagCalls.length = 0;
  storefrontCache.revalidateBannersCache();
  assert.deepEqual(revalidateTagCalls, ["banners"]);
});

test("submitReview still does NOT purge the catalog tag (deliberate, unchanged)", () => {
  const src = root("lib/reviews.ts");
  const fn = slice(src, "export async function submitReview");
  assert.doesNotMatch(fn, /revalidateCatalogCache/, "reviews: submitReview must not purge — the refresh would remount the form");
  assert.doesNotMatch(src, /from "\.\/storefront-cache"/, "reviews: no storefront-cache import at all");
  // The aggregate still refreshes: the comment now says how — the
  // next product / order / banner write, or the 60-second
  // revalidate — instead of the old bare promise.
  assert.match(fn, /or within 60 seconds/, "reviews: the comment names the 60-second revalidate as the refresh");
  assert.match(fn, /banner writes purge the catalog tag/, "reviews: the comment says banner writes purge now");
});

test("the stale comments no longer promise a refresh that never happens", () => {
  // shared.ts used to say a stale catalogue would persist "until
  // the next banner write or restart" — wrong on both counts once
  // banner writes purge and the 60s revalidate exists.
  const shared = root("lib/products/actions/shared.ts");
  assert.doesNotMatch(shared, /until the next banner write or restart/, "shared: the stale banner-write-or-restart promise is gone");
  assert.match(
    slice(shared, "export function revalidateProductPages"),
    /until the next product \/[\s\S]*?order \/ banner write purged the tag, or the catalogue's[\s\S]*?60-second revalidate expired/,
    "shared: the comment describes the real refresh paths",
  );
  // The catalogue header used to list review submission as a
  // purger; the storefront-cache header did the same.
  const catalog = root("lib/supabase/catalog.ts");
  assert.doesNotMatch(
    slice(catalog, "SHARED DATA CACHE", "import { unstable_cache }"),
    /review submission \(rating aggregate\)/,
    "catalog: review submission is no longer listed as a purger",
  );
  assert.match(
    slice(catalog, "SHARED DATA CACHE", "import { unstable_cache }"),
    /Review submission deliberately does[\s\S]*?NOT purge/,
    "catalog: the header says review submission does not purge",
  );
  const contract = root("lib/storefront-cache.ts");
  assert.doesNotMatch(contract, /a review is submitted — the rating aggregate changes/, "storefront-cache: review submission is no longer listed as a refresher");
  assert.match(contract, /banner create \/ update \/ hide \/ show \/ delete/, "storefront-cache: banner writes are listed as catalogue refreshers");
  assert.match(contract, /revalidates 60 seconds after it was[\s\S]*?filled/, "storefront-cache: the 60-second revalidate is documented");
});
