// Live-catalogue rule tests — TechShot.
//
// The storefront reads products from Supabase (see
// lib/supabase/catalog.ts), and the visibility + mapping rules live in
// lib/catalog-rules.ts, a pure module whose single import is
// lib/storage-images.ts (pure, no imports of its own). Node 24 strips
// the erasable TypeScript types in those files, so these tests import
// them directly — the rules tested here are the exact rules the server
// code runs, not a copy.
//
// What is proven here:
//   (a) a newly added ACTIVE product appears in the public catalogue
//   (b) deleting a product removes it from the public catalogue
//   (c) a paused / draft product is hidden from shoppers
//   (d) mapping preserves database prices exactly (integer poisha)
//
// What is NOT proven here (no live Supabase keys are available in this
// environment): the network round-trip to the live project. The
// queries themselves are covered by `npx tsc --noEmit` and by the
// force-dynamic pages, which fall back to the local seed catalogue
// when Supabase is not configured.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveBrand,
  deriveVariant,
  earliestFlashEndsAt,
  filterPublicProducts,
  isPublicProduct,
  mapDbProductToCatalog,
  mapDbProductToSubscription,
  publicProductsToCatalog,
  relatedProducts,
} from "../lib/catalog-rules.ts";

// ---------------------------------------------------------------------------
// Fixtures: rows shaped like the seeded live database (12 products).
// ---------------------------------------------------------------------------

function row(overrides = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    category_id: "cat-smartphones",
    category_slug: "smartphones",
    title: "Apple iPhone 16 Pro 256GB Natural Titanium",
    slug: "apple-iphone-16-pro-256gb-natural-titanium",
    description:
      "Apple iPhone 16 Pro with 256GB storage in Natural Titanium. A18 Pro chip, 48MP Pro camera system, titanium design and USB-C. Official warranty in Bangladesh.",
    price_poisha: 11990000,
    compare_at_poisha: 12990000,
    stock: 12,
    status: "active",
    rating: 4.9,
    review_count: 1248,
    is_flash_deal: true,
    flash_ends_at: "2026-11-15T00:00:00.000Z",
    product_images: [
      { storage_path: "/images/products/apple-iphone-16-pro-256gb-natural-titanium.jpg", alt_text: "iPhone 16 Pro", sort_order: 0 },
    ],
    product_variants: [],
    ...overrides,
  };
}

const sonyHeadphones = row({
  id: "00000000-0000-0000-0000-000000000002",
  category_slug: "audio",
  title: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones",
  slug: "sony-wh-1000xm5",
  description: "Sony WH-1000XM5 wireless noise cancelling headphones.",
  price_poisha: 2499000,
  compare_at_poisha: 2999000,
  stock: 30,
  rating: 4.8,
  review_count: 862,
  is_flash_deal: false,
  flash_ends_at: null,
  product_images: [{ storage_path: "/images/products/sony-wh-1000xm5.jpg", sort_order: 0 }],
});

const samsungPhone = row({
  id: "00000000-0000-0000-0000-000000000003",
  category_slug: "smartphones",
  title: "Samsung Galaxy S24 Ultra",
  slug: "samsung-galaxy-s24-ultra",
  description: "Samsung Galaxy S24 Ultra with Galaxy AI and 200MP camera.",
  price_poisha: 10999900,
  compare_at_poisha: 12999900,
  stock: 15,
  rating: 4.8,
  review_count: 934,
  is_flash_deal: false,
  flash_ends_at: null,
  product_images: [{ storage_path: "/images/products/samsung-galaxy-s24-ultra.jpg", sort_order: 0 }],
});

const netflix = row({
  id: "00000000-0000-0000-0000-000000000004",
  category_slug: "subscriptions",
  title: "Netflix Premium — 1 Month",
  slug: "netflix-premium-1-month",
  description:
    "Netflix Premium subscription for 1 month. Stream in 4K Ultra HD on up to 4 screens at the same time.",
  price_poisha: 64900,
  compare_at_poisha: null,
  stock: 999,
  rating: 4.8,
  review_count: 412,
  is_flash_deal: false,
  flash_ends_at: null,
  product_images: [{ storage_path: "/images/products/netflix-premium-1-month.jpg", sort_order: 0 }],
});

// ---------------------------------------------------------------------------
// (a) A newly added active product appears in the public catalogue.
// ---------------------------------------------------------------------------

test("(a) a newly added active product appears in the public catalogue", () => {
  const before = publicProductsToCatalog([sonyHeadphones, samsungPhone]);
  assert.equal(
    before.some((p) => p.slug === "anker-737-power-bank"),
    false,
  );

  // The owner adds a product in the backend (via /admin); it is status 'active'.
  const added = row({
    id: "00000000-0000-0000-0000-000000000099",
    category_slug: "accessories",
    title: "Anker 737 Power Bank 24,000mAh",
    slug: "anker-737-power-bank",
    description: "Anker 737 GaNPrime power bank, 24,000mAh capacity with 140W fast charging.",
    price_poisha: 1299900,
    compare_at_poisha: 1699900,
    stock: 50,
    rating: 4.6,
    review_count: 203,
    is_flash_deal: false,
    flash_ends_at: null,
    product_images: [{ storage_path: "/images/products/anker-737-power-bank.jpg", sort_order: 0 }],
  });
  const after = publicProductsToCatalog([sonyHeadphones, samsungPhone, added]);
  const found = after.find((p) => p.slug === "anker-737-power-bank");
  assert.ok(found, "newly added active product must appear");
  assert.equal(found.title, "Anker 737 Power Bank 24,000mAh");
  assert.equal(found.brand, "Anker");
  assert.equal(found.category, "accessories");
});

// ---------------------------------------------------------------------------
// (b) Deleting a product removes it from the public catalogue.
// ---------------------------------------------------------------------------

test("(b) deleting a product removes it from the public catalogue", () => {
  const before = publicProductsToCatalog([sonyHeadphones, samsungPhone, netflix]);
  assert.equal(before.length, 3);
  assert.ok(before.some((p) => p.slug === "sony-wh-1000xm5"));

  // The product row is deleted in the backend, so it is no longer
  // returned by the query at all.
  const afterDelete = publicProductsToCatalog([samsungPhone, netflix]);
  assert.equal(afterDelete.length, 2);
  assert.equal(
    afterDelete.some((p) => p.slug === "sony-wh-1000xm5"),
    false,
  );
  // The remaining products are untouched by the delete.
  assert.ok(afterDelete.some((p) => p.slug === "samsung-galaxy-s24-ultra"));
  assert.ok(afterDelete.some((p) => p.slug === "netflix-premium-1-month"));
});

// ---------------------------------------------------------------------------
// (c) Paused / draft products are hidden from shoppers.
// ---------------------------------------------------------------------------

test("(c) a paused product is hidden publicly", () => {
  const paused = row({ status: "paused" });
  assert.equal(isPublicProduct(paused), false);
  assert.deepEqual(filterPublicProducts([paused, sonyHeadphones]).map((r) => r.slug), [
    "sony-wh-1000xm5",
  ]);
  assert.equal(
    publicProductsToCatalog([paused, sonyHeadphones]).some(
      (p) => p.slug === "apple-iphone-16-pro-256gb-natural-titanium",
    ),
    false,
  );
});

test("(c) a draft product is hidden publicly", () => {
  const draft = row({ slug: "unreleased-phone", status: "draft" });
  assert.equal(isPublicProduct(draft), false);
  assert.deepEqual(publicProductsToCatalog([draft]), []);
});

test("(c) only active products pass the visibility rule", () => {
  assert.equal(isPublicProduct(row({ status: "active" })), true);
  assert.equal(isPublicProduct(row({ status: "paused" })), false);
  assert.equal(isPublicProduct(row({ status: "draft" })), false);
  assert.equal(isPublicProduct(row({ status: "archived" })), false);
  assert.equal(isPublicProduct(null), false);
  assert.equal(isPublicProduct(undefined), false);
});

// ---------------------------------------------------------------------------
// (d) Mapping preserves database prices exactly (integer poisha).
// ---------------------------------------------------------------------------

test("(d) mapping preserves DB prices in poisha, exactly", () => {
  const mapped = mapDbProductToCatalog(row());
  assert.equal(mapped.price_poisha, 11990000);
  assert.equal(mapped.compare_at_poisha, 12990000);
  // A subscription with no compare-at price falls back to its own price.
  assert.equal(mapDbProductToCatalog(netflix).price_poisha, 64900);
  assert.equal(mapDbProductToCatalog(netflix).compare_at_poisha, 64900);
});

test("(d) variant price deltas are computed in poisha from the override", () => {
  const withVariants = row({
    product_variants: [
      { name: "128 GB", price_override_poisha: 10990000, stock: 8 },
      { name: "256 GB", price_override_poisha: 11990000, stock: 12 },
      { name: "512 GB", price_override_poisha: 13990000, stock: 6 },
      { name: "Natural Titanium", price_override_poisha: null, stock: 12 },
    ],
  });
  const mapped = mapDbProductToCatalog(withVariants);
  assert.deepEqual(mapped.storageOptions, [
    { label: "128 GB", priceDeltaPoisha: -1000000, stock: 8 },
    { label: "256 GB", priceDeltaPoisha: 0, stock: 12 },
    { label: "512 GB", priceDeltaPoisha: 2000000, stock: 6 },
  ]);
  assert.deepEqual(mapped.colours, ["Natural Titanium"]);
  // The variant label is built from the stored variants.
  assert.equal(mapped.variant, "128 GB · 256 GB · 512 GB · Natural Titanium");
});

// ---------------------------------------------------------------------------
// Mapping details: brand, variant, badge, specs, images, subscriptions.
// ---------------------------------------------------------------------------

test("brand is derived from the title; PlayStation is Sony", () => {
  assert.equal(deriveBrand("Apple iPhone 16 Pro"), "Apple");
  assert.equal(deriveBrand("Samsung Galaxy S24 Ultra"), "Samsung");
  assert.equal(deriveBrand("PlayStation DualSense Wireless Controller"), "Sony");
  assert.equal(deriveBrand("JBL Flip 6 Portable Bluetooth Speaker"), "JBL");
  assert.equal(deriveBrand("Netflix Premium — 1 Month"), "Netflix");
  assert.equal(deriveBrand("Some Unknown Gadget"), "Other");
});

test("variant comes from the title, never from the description text", () => {
  const mapped = mapDbProductToCatalog(row());
  // Trailing variant info from the title, not the description's first
  // 60 characters (which would start "Apple iPhone 16 Pro with...").
  assert.equal(mapped.variant, "256GB Natural Titanium");
  assert.equal(mapDbProductToCatalog(netflix).variant, "1 Month");
  assert.equal(deriveVariant(sonyHeadphones), "WH-1000XM5 Wireless Noise Cancelling Headphones");
});

test("badge: BESTSELLER at 900+ reviews, FLASH DEAL for flash deals", () => {
  assert.equal(mapDbProductToCatalog(row()).badge, "BESTSELLER"); // 1248 reviews + flash
  assert.equal(mapDbProductToCatalog(sonyHeadphones).badge, undefined); // 862, not flash
  const flashOnly = row({ review_count: 100, is_flash_deal: true });
  assert.equal(mapDbProductToCatalog(flashOnly).badge, "FLASH DEAL");
  assert.equal(mapDbProductToCatalog(flashOnly).flash, true);
  assert.equal(mapDbProductToCatalog(sonyHeadphones).condition, "New");
});

test("specs carry the description and the right warranty line", () => {
  const mapped = mapDbProductToCatalog(row());
  assert.equal(mapped.specs.Description, row().description);
  assert.equal(mapped.specs.Warranty, "1-year official warranty");
  assert.equal(
    mapDbProductToCatalog(netflix).specs.Warranty,
    "Full validity guaranteed",
  );
});

test("image falls back to the conventional product path when none is stored", () => {
  const noImage = row({ product_images: [] });
  assert.equal(
    mapDbProductToCatalog(noImage).image,
    "/images/products/apple-iphone-16-pro-256gb-natural-titanium.jpg",
  );
  const firstImageWins = row({
    product_images: [
      { storage_path: "/images/products/second.jpg", sort_order: 1 },
      { storage_path: "/images/products/first.jpg", sort_order: 0 },
    ],
  });
  assert.equal(mapDbProductToCatalog(firstImageWins).image, "/images/products/first.jpg");
});

test("subscription plans map with the right name, period and tagline", () => {
  const plan = mapDbProductToSubscription(mapDbProductToCatalog(netflix));
  assert.equal(plan.slug, "netflix-premium-1-month");
  assert.equal(plan.name, "Netflix Premium");
  assert.equal(plan.price_poisha, 64900);
  assert.equal(plan.period, "/month");
  assert.equal(plan.productSlug, "netflix-premium-1-month");
  assert.ok(plan.tagline.startsWith("Netflix Premium subscription for 1 month."));

  const yearly = mapDbProductToSubscription(
    mapDbProductToCatalog(
      row({
        category_slug: "subscriptions",
        title: "Amazon Prime — 1 Year",
        slug: "amazon-prime-1-year",
        description: "Amazon Prime membership for 1 year. Prime Video and more.",
        price_poisha: 149900,
      }),
    ),
  );
  assert.equal(yearly.period, "/year");
  assert.equal(yearly.name, "Amazon Prime");
});

test("flash countdown uses the earliest flash end time", () => {
  const rows = [
    row({ flash_ends_at: "2026-11-15T00:00:00.000Z" }),
    row({ slug: "other-flash", is_flash_deal: true, flash_ends_at: "2026-11-10T00:00:00.000Z" }),
    sonyHeadphones, // not a flash deal
  ];
  assert.equal(
    earliestFlashEndsAt(rows)?.toISOString(),
    "2026-11-10T00:00:00.000Z",
  );
  assert.equal(earliestFlashEndsAt([sonyHeadphones]), undefined);
});

test("related products prefer the same category, then the rest", () => {
  const products = publicProductsToCatalog([row(), samsungPhone, sonyHeadphones, netflix]);
  const iphone = products.find((p) => p.slug === "apple-iphone-16-pro-256gb-natural-titanium");
  const related = relatedProducts(products, iphone, 2);
  assert.equal(related.length, 2);
  assert.equal(related[0].slug, "samsung-galaxy-s24-ultra"); // same category first
  assert.equal(
    related.some((p) => p.slug === iphone.slug),
    false,
  );
});
