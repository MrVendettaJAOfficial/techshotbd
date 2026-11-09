// Real-review catalogue rating tests — TechShot.
//
// These tests import the REAL modules (lib/catalog-rules.ts and
// lib/data/catalog.ts) through the loader registered by
// tests/register-ts-loader.mjs (see package.json "test"); Node 24
// strips the erasable TypeScript types, so the rules tested here
// are the exact rules the storefront runs — not a stub copy.
//
// What is proven here:
//   - aggregateReviewStats averages real review rows (rounded to 1
//     decimal) and counts them, per product;
//   - mapDbProductToCatalog IGNORES the row's rating / review_count
//     columns (the seeded numbers are fabricated): without real
//     review stats a product maps with rating 0 and review_count 0,
//     however large the row's columns claim;
//   - with real review stats the mapped rating / review_count are
//     exactly those figures;
//   - the local fallback catalogue (lib/data/catalog.ts) carries no
//     fabricated ratings at all: every product is rating 0 with
//     review_count 0;
//   - the warranty column and specifications column reach the mapped
//     specs record (warranty first, specifications merged in).
//
// The live fetch itself (lib/supabase/catalog.ts reading the
// reviews table in one query) is not runnable under `node --test` —
// it needs Supabase — so it is covered by `npx tsc --noEmit` and
// by live testing against the TechshotBD project (see README).
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateReviewStats,
  mapDbProductToCatalog,
  publicProductsToCatalog,
} from "../lib/catalog-rules.ts";
import { PRODUCTS } from "../lib/data/catalog.ts";

function row(overrides = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    category_id: "cat-smartphones",
    category_slug: "smartphones",
    title: "Apple iPhone 16 Pro 256GB Natural Titanium",
    slug: "apple-iphone-16-pro-256gb-natural-titanium",
    description: "A phone.",
    price_poisha: 11990000,
    compare_at_poisha: 12990000,
    stock: 12,
    status: "active",
    rating: 4.9,
    review_count: 1248,
    product_images: [],
    product_variants: [],
    ...overrides,
  };
}

test("aggregateReviewStats averages and counts real review rows per product", () => {
  const stats = aggregateReviewStats([
    { product_id: "p1", rating: 5 },
    { product_id: "p1", rating: 4 },
    { product_id: "p1", rating: 4 },
    { product_id: "p2", rating: 3 },
  ]);
  assert.deepEqual(stats.get("p1"), { rating: 4.3, review_count: 3 });
  assert.deepEqual(stats.get("p2"), { rating: 3, review_count: 1 });
  assert.equal(stats.has("p3"), false);
});

test("aggregateReviewStats returns an empty map for no reviews", () => {
  assert.equal(aggregateReviewStats([]).size, 0);
});

test("mapper ignores the fabricated row rating and review_count", () => {
  const product = mapDbProductToCatalog(row());
  assert.equal(product.rating, 0);
  assert.equal(product.review_count, 0);
  // The fabricated numbers must not leak into the badge either.
  assert.equal(product.badge, undefined);
});

test("mapper uses real review stats when they are passed", () => {
  const product = mapDbProductToCatalog(row(), { rating: 4.3, review_count: 3 });
  assert.equal(product.rating, 4.3);
  assert.equal(product.review_count, 3);
});

test("publicProductsToCatalog maps real stats by product id", () => {
  const stats = new Map([
    ["00000000-0000-0000-0000-000000000001", { rating: 5, review_count: 1 }],
  ]);
  const products = publicProductsToCatalog([row()], stats);
  assert.equal(products[0].rating, 5);
  assert.equal(products[0].review_count, 1);
  const withoutStats = publicProductsToCatalog([row()]);
  assert.equal(withoutStats[0].rating, 0);
  assert.equal(withoutStats[0].review_count, 0);
});

test("fallback catalogue has no fabricated ratings", () => {
  assert.ok(PRODUCTS.length > 0);
  for (const product of PRODUCTS) {
    assert.equal(product.rating, 0, product.slug);
    assert.equal(product.review_count, 0, product.slug);
    assert.notEqual(product.badge, "BESTSELLER", product.slug);
  }
});

test("mapper uses the warranty column and merges specifications into specs", () => {
  const product = mapDbProductToCatalog(
    row({
      warranty: "2 years official warranty",
      specifications: [
        { key: "Display", value: '6.3" OLED' },
        { key: "Warranty", value: "must not overwrite the warranty" },
      ],
    }),
  );
  assert.equal(product.specs.Warranty, "2 years official warranty");
  assert.equal(product.specs.Display, '6.3" OLED');
  assert.equal(product.specs.Description, "A phone.");
});

test("mapper falls back to the default warranty text when none is set", () => {
  const product = mapDbProductToCatalog(row());
  assert.equal(product.specs.Warranty, "1-year official warranty");
});
