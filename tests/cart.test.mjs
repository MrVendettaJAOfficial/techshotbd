// Cart pricing tests — TechShot.
//
// These tests import the REAL modules (lib/orders.ts, lib/data/catalog.ts,
// lib/catalog-rules.ts) through the loader registered by
// tests/register-ts-loader.mjs (see package.json "test"); Node 24 strips
// the erasable TypeScript types, so the rules tested here are the exact
// rules the cart page, the checkout form and the checkout action run.
//
// What is proven here (the cart bug fixed 2026-11-08):
//   - a live Supabase slug (apple-iphone-16-pro-256gb-natural-titanium)
//     prices from its seed product instead of being reported as
//     "no longer available" with a ৳0 total;
//   - the same for the other renamed seed product (netflix-premium-1-month);
//   - a storage-option price delta applies even when the live variant
//     label has no space ("256GB Natural Titanium" vs option "256 GB");
//   - quantities, remove (quantity 0 drops the line), free delivery over
//     ৳999, FIRST2000, and stock checks all still hold;
//   - the checkout totals path (computeCheckoutTotals) prices live slugs
//     too, so a guest checking out while Supabase is configured is not
//     blocked at ৳0.
//
// What is NOT proven here (no browser in `node --test`): the React
// cart store's localStorage persistence, the header badge, and the
// live-database line resolution in lib/cart-server.ts
// (getPricedCartLines — it imports next/headers and cannot run under
// node). Those are covered by the Playwright click-through in
// tests/e2e/smoke.mjs against the mock Supabase in tests/e2e/.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";

import {
  computeCheckoutTotals,
  computeCheckoutTotalsFromLines,
  computeTotals,
  resolveCartLines,
  validateCoupon,
  validateStock,
} from "../lib/orders.ts";
import { getProductForCartSlug } from "../lib/data/catalog.ts";
import {
  normalizeVariantLabel,
  variantMatchesOption,
} from "../lib/catalog-rules.ts";

// Live (Supabase) slugs from supabase/seed.sql, and their seed slugs.
const LIVE_IPHONE = "apple-iphone-16-pro-256gb-natural-titanium";
const LIVE_NETFLIX = "netflix-premium-1-month";

test("getProductForCartSlug resolves a live slug to its seed product", () => {
  const iphone = getProductForCartSlug(LIVE_IPHONE);
  assert.ok(iphone);
  assert.equal(iphone.slug, "apple-iphone-16-pro");
  assert.equal(iphone.price_poisha, 11990000);

  const netflix = getProductForCartSlug(LIVE_NETFLIX);
  assert.ok(netflix);
  assert.equal(netflix.slug, "netflix-premium");
  assert.equal(netflix.price_poisha, 64900);
});

test("getProductForCartSlug still resolves exact seed slugs and misses unknown ones", () => {
  assert.equal(getProductForCartSlug("apple-iphone-16-pro")?.slug, "apple-iphone-16-pro");
  assert.equal(getProductForCartSlug("sony-wh-1000xm5")?.slug, "sony-wh-1000xm5");
  assert.equal(getProductForCartSlug("no-such-product"), undefined);
  assert.equal(getProductForCartSlug("apple-iphone-16"), undefined);
});

test("variantMatchesOption ignores case and spacing", () => {
  // Live labels come from product titles ("256GB Natural Titanium");
  // seed storage options are written with a space ("256 GB").
  assert.equal(variantMatchesOption("256GB Natural Titanium", "256 GB"), true);
  assert.equal(variantMatchesOption("512 GB · Natural Titanium", "512 GB"), true);
  assert.equal(variantMatchesOption("1 TB", "1 TB"), true);
  assert.equal(variantMatchesOption("128 GB", "256 GB"), false);
  assert.equal(variantMatchesOption(undefined, "256 GB"), false);
  assert.equal(normalizeVariantLabel("256GB Natural Titanium"), "256gbnaturaltitanium");
});

test("resolveCartLines prices a live-slug line instead of dropping it", () => {
  const { lines, unknownSlugs } = resolveCartLines([
    { slug: LIVE_IPHONE, variant: "256GB Natural Titanium", quantity: 1 },
  ]);
  assert.deepEqual(unknownSlugs, []);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].productId, LIVE_IPHONE);
  assert.equal(lines[0].title, "Apple iPhone 16 Pro");
  assert.equal(lines[0].price_poisha, 11990000);
  assert.equal(lines[0].quantity, 1);
});

test("resolveCartLines prices the renamed subscription slug", () => {
  const { lines, unknownSlugs } = resolveCartLines([
    { slug: LIVE_NETFLIX, quantity: 2 },
  ]);
  assert.deepEqual(unknownSlugs, []);
  assert.equal(lines[0].price_poisha, 64900);
  assert.equal(lines[0].quantity, 2);
});

test("resolveCartLines applies the storage-option delta for live variant labels", () => {
  const fiveTwelve = resolveCartLines([
    { slug: LIVE_IPHONE, variant: "512GB Natural Titanium", quantity: 1 },
  ]);
  // 512 GB is +৳20,000 over the 256 GB base price.
  assert.equal(fiveTwelve.lines[0].price_poisha, 13990000);

  const oneTwoEight = resolveCartLines([
    { slug: LIVE_IPHONE, variant: "128 GB · Natural Titanium", quantity: 1 },
  ]);
  // 128 GB is −৳10,000 against the base price.
  assert.equal(oneTwoEight.lines[0].price_poisha, 10990000);
});

test("resolveCartLines multiplies by quantity and drops only truly unknown slugs", () => {
  const { lines, unknownSlugs } = resolveCartLines([
    { slug: LIVE_IPHONE, variant: "256GB Natural Titanium", quantity: 3 },
    { slug: "deleted-product", quantity: 1 },
  ]);
  assert.deepEqual(unknownSlugs, ["deleted-product"]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 3);
  assert.equal(lines[0].price_poisha * lines[0].quantity, 35970000);
});

test("cart totals: free delivery at ৳999 and above, ৳60 below", () => {
  const iphone = resolveCartLines([
    { slug: LIVE_IPHONE, variant: "256GB Natural Titanium", quantity: 1 },
  ]).lines;
  const big = computeTotals(iphone, "standard", 0);
  assert.equal(big.subtotal_poisha, 11990000);
  assert.equal(big.deliveryFee_poisha, 0);
  assert.equal(big.total_poisha, 11990000);

  const small = resolveCartLines([{ slug: "youtube-premium-1-month", quantity: 1 }]).lines;
  assert.equal(small[0].price_poisha, 14900);
  const smallTotals = computeTotals(small, "standard", 0);
  assert.equal(smallTotals.deliveryFee_poisha, 6000);
  assert.equal(smallTotals.total_poisha, 20900);
});

test("cart totals: FIRST2000 takes ৳2,000 off a first order above ৳50,000", () => {
  const iphone = resolveCartLines([
    { slug: LIVE_IPHONE, variant: "256GB Natural Titanium", quantity: 1 },
  ]).lines;
  const coupon = validateCoupon("FIRST2000", 11990000);
  assert.deepEqual(coupon, { discount_poisha: 200000 });
  const totals = computeTotals(iphone, "standard", 200000);
  assert.equal(totals.total_poisha, 11990000 - 200000);

  const tooSmall = validateCoupon("FIRST2000", 100000);
  assert.ok("error" in tooSmall);
});

test("validateStock rejects a quantity above stock and accepts one within it", () => {
  const over = resolveCartLines([
    { slug: LIVE_IPHONE, variant: "256GB Natural Titanium", quantity: 13 },
  ]).lines;
  const overResult = validateStock(over);
  assert.equal(overResult.ok, false);
  assert.match(overResult.errors.join(" "), /only 12 in stock/);

  const within = resolveCartLines([
    { slug: LIVE_IPHONE, variant: "256GB Natural Titanium", quantity: 12 },
  ]).lines;
  assert.deepEqual(validateStock(within), { ok: true });
});

test("computeCheckoutTotals prices live slugs (guest checkout while Supabase is configured)", async () => {
  const totals = await computeCheckoutTotals(
    [{ slug: LIVE_IPHONE, variant: "256GB Natural Titanium", quantity: 2 }],
    null,
    "standard",
  );
  assert.equal(totals.errors, undefined);
  assert.equal(totals.items.length, 1);
  assert.equal(totals.subtotal_poisha, 23980000);
  assert.equal(totals.deliveryFee_poisha, 0);
  assert.equal(totals.total_poisha, 23980000);
});

test("computeCheckoutTotals still reports a genuinely unknown slug", async () => {
  const totals = await computeCheckoutTotals(
    [{ slug: "deleted-product", quantity: 1 }],
    null,
    "standard",
  );
  assert.equal(totals.items.length, 0);
  assert.ok((totals.errors ?? []).some((e) => e.includes("deleted-product")));
});

test("computeCheckoutTotalsFromLines reuses priced lines (live resolver output)", () => {
  const { lines } = resolveCartLines([
    { slug: LIVE_IPHONE, variant: "256GB Natural Titanium", quantity: 1 },
  ]);
  const totals = computeCheckoutTotalsFromLines(lines, [], "FIRST2000", "standard");
  assert.equal(totals.couponDiscount_poisha, 200000);
  assert.equal(totals.total_poisha, 11990000 - 200000);
  assert.equal(totals.errors, undefined);
});
