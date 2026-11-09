// Per-variant photo tests — TechShot.
//
// A variant (a colour, or a storage option) can carry its own photo
// (product_variants.image_path, migration 0005), so the product
// gallery shows the selected colour's photo instead of always
// showing the product's single main photo. The value is a Storage
// filename / legacy local path / https URL, resolved through the
// same helper as product images (lib/storage-images.ts).
//
// What is proven here:
//   - resolveVariantImage picks the colour's photo first, then a
//     storage option's, and returns undefined when the selection
//     has no photo (gallery falls back to the product photo);
//   - mapDbProductToCatalog carries variantImages, resolved the
//     same way as the product photo (Storage URL when configured,
//     local path otherwise), and omits variants with no photo;
//   - the admin variant format accepts an optional fourth segment
//     (the photo), validated with the same isSafeImagePath rule as
//     product images, and the server schema accepts / rejects it;
//   - the loader fetches image_path, the gallery uses it, and the
//     mock seeds exactly one stand-in variant image, labelled as
//     such — no real per-colour photos exist yet, and none are
//     invented here (no seed product sets variantImages).
//
// What is NOT proven here (no browser in `node --test`): the
// gallery actually swapping its displayed <img> when a colour is
// clicked. That is covered by the Playwright run in
// tests/e2e/mini-cart-variant-photos.mjs against the mock Supabase.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  mapDbProductToCatalog,
  resolveVariantImage,
} from "../lib/catalog-rules.ts";
import {
  parseVariantsText,
  productVariantInputSchema,
} from "../lib/products/validation.ts";
import { PRODUCTS } from "../lib/data/catalog.ts";

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

function row(overrides = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    category_id: "cat-smartphones",
    category_slug: "smartphones",
    title: "Apple iPhone 16 Pro 256GB Natural Titanium",
    slug: "apple-iphone-16-pro-256gb-natural-titanium",
    description: "Apple iPhone 16 Pro with 256GB storage in Natural Titanium.",
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

// ---------------------------------------------------------------------------
// resolveVariantImage: colour first, storage second, undefined fallback.
// ---------------------------------------------------------------------------

test("resolveVariantImage prefers the colour photo, then the storage photo", () => {
  const product = {
    variantImages: {
      "Black Titanium": "/images/products/iphone-black.jpg",
      "512 GB": "/images/products/iphone-512.jpg",
    },
  };
  assert.equal(
    resolveVariantImage(product, "Black Titanium", "512 GB"),
    "/images/products/iphone-black.jpg",
  );
  assert.equal(
    resolveVariantImage(product, "Natural Titanium", "512 GB"),
    "/images/products/iphone-512.jpg",
  );
  assert.equal(resolveVariantImage(product, "Natural Titanium", "256 GB"), undefined);
  assert.equal(resolveVariantImage(product, undefined, undefined), undefined);
  assert.equal(resolveVariantImage({}, "Black Titanium", undefined), undefined);
  assert.equal(resolveVariantImage({ variantImages: {} }, "Black Titanium"), undefined);
});

// ---------------------------------------------------------------------------
// Mapping: variantImages is carried, resolved like the product photo.
// ---------------------------------------------------------------------------

test("mapDbProductToCatalog carries a variant photo (local fallback, unconfigured)", () => {
  const mapped = mapDbProductToCatalog(
    row({
      product_variants: [
        { name: "Natural Titanium", price_override_poisha: null, stock: 12, image_path: null },
        { name: "Black Titanium", price_override_poisha: null, stock: 12, image_path: "iphone-16-pro-black.jpg" },
        { name: "512 GB", price_override_poisha: 13990000, stock: 6, image_path: "/images/products/iphone-16-pro-512.jpg" },
      ],
    }),
  );
  assert.deepEqual(mapped.colours, ["Natural Titanium", "Black Titanium"]);
  assert.deepEqual(mapped.variantImages, {
    "Black Titanium": "/images/products/iphone-16-pro-black.jpg",
    "512 GB": "/images/products/iphone-16-pro-512.jpg",
  });
  // The variant without a photo is absent — the gallery falls back.
  assert.equal("Natural Titanium" in (mapped.variantImages ?? {}), false);
  // Prices and the main image are unchanged by the photo mapping.
  assert.equal(mapped.price_poisha, 11990000);
  assert.equal(
    mapped.image,
    "/images/products/apple-iphone-16-pro-256gb-natural-titanium.jpg",
  );
});

test("mapDbProductToCatalog resolves a variant photo to its Storage URL when configured", () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:3101";
  try {
    const mapped = mapDbProductToCatalog(
      row({
        product_variants: [
          { name: "Black Titanium", price_override_poisha: null, stock: 12, image_path: "iphone-16-pro-black.jpg" },
          { name: "White Titanium", price_override_poisha: null, stock: 12, image_path: "https://example.com/white.jpg" },
        ],
      }),
    );
    assert.equal(
      mapped.variantImages?.["Black Titanium"],
      "http://127.0.0.1:3101/storage/v1/object/public/product-images/iphone-16-pro-black.jpg",
    );
    // A full https URL passes through untouched.
    assert.equal(mapped.variantImages?.["White Titanium"], "https://example.com/white.jpg");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  }
});

test("mapDbProductToCatalog omits variantImages entirely when no variant has a photo", () => {
  const mapped = mapDbProductToCatalog(
    row({
      product_variants: [
        { name: "128 GB", price_override_poisha: 10990000, stock: 8 },
        { name: "Natural Titanium", price_override_poisha: null, stock: 12 },
      ],
    }),
  );
  assert.equal(mapped.variantImages, undefined);
  assert.deepEqual(mapped.colours, ["Natural Titanium"]);
});

// ---------------------------------------------------------------------------
// Admin format: optional fourth segment, same image validation.
// ---------------------------------------------------------------------------

test("parseVariantsText accepts a variant photo as the fourth segment", () => {
  assert.deepEqual(parseVariantsText("Black Titanium::10:iphone-16-pro-black.jpg"), [
    { name: "Black Titanium", stock: 10, imagePath: "iphone-16-pro-black.jpg" },
  ]);
  assert.deepEqual(parseVariantsText("256GB:119900:5:iphone-256.jpg"), [
    { name: "256GB", priceTaka: 119900, stock: 5, imagePath: "iphone-256.jpg" },
  ]);
  // A variant without a photo is unchanged.
  assert.deepEqual(parseVariantsText("128GB:89900:10, 256GB:99900:5"), [
    { name: "128GB", priceTaka: 89900, stock: 10 },
    { name: "256GB", priceTaka: 99900, stock: 5 },
  ]);
});

test("parseVariantsText keeps an https photo URL intact (colons rejoined)", () => {
  assert.deepEqual(parseVariantsText("Black::5:https://example.com/black.jpg"), [
    { name: "Black", stock: 5, imagePath: "https://example.com/black.jpg" },
  ]);
});

test("parseVariantsText rejects an unsafe variant photo", () => {
  assert.throws(
    () => parseVariantsText("Black::5:../secret.jpg"),
    /invalid photo/,
  );
  assert.throws(
    () => parseVariantsText("Black::5:https://www.figma.com/file/x/black.jpg"),
    /invalid photo/,
  );
});

test("productVariantInputSchema validates the variant photo like a product image", () => {
  const base = { name: "Black Titanium", stock: 10 };
  assert.equal(productVariantInputSchema.safeParse(base).success, true);
  assert.equal(
    productVariantInputSchema.safeParse({ ...base, imagePath: "iphone-16-pro-black.jpg" }).success,
    true,
  );
  assert.equal(
    productVariantInputSchema.safeParse({ ...base, imagePath: "/images/products/iphone-black.jpg" }).success,
    true,
  );
  assert.equal(
    productVariantInputSchema.safeParse({ ...base, imagePath: "https://www.figma.com/file/x/black.jpg" }).success,
    false,
  );
  assert.equal(
    productVariantInputSchema.safeParse({ ...base, imagePath: "../secret.jpg" }).success,
    false,
  );
});

// ---------------------------------------------------------------------------
// Wiring: loader, gallery, admin form, migration — and no invented photos.
// ---------------------------------------------------------------------------

test("loader fetches image_path and the gallery switches on it", () => {
  assert.match(
    read("lib/supabase/catalog.ts"),
    /product_variants\(name, price_override_poisha, stock, image_path\)/,
  );
  // The detail page builds its photo list through buildGalleryList:
  // the selected variant's photo first, then every photo for the
  // product in sort_order (the multi-angle gallery, 2026-11-09).
  const gallery = read("components/ProductGallery.tsx");
  assert.match(gallery, /buildGalleryList\(product, colour, storage\?\.label\)/);
  const rules = read("lib/catalog-rules.ts");
  assert.match(rules, /export function buildGalleryList/);
  assert.match(rules, /variantImage \? \[variantImage, \.\.\.base\] : base/);
  // Switching the variant resets the gallery to its first image.
  assert.match(gallery, /useEffect\(\(\) => \{\s*setActive\(0\);?\s*\}, \[images\]\)/s);
});

test("admin form sets a variant photo and round-trips it", () => {
  const manager = read("components/ProductManager.tsx");
  assert.match(manager, /variant\.imagePath \? `\$\{base\}:\$\{variant\.imagePath\}` : base/);
  assert.match(manager, /Black Titanium::5:iphone-black\.jpg/);
  assert.match(manager, /photo set/);
  // The server action writes image_path (migration 0005 column).
  assert.match(
    read("lib/products/actions.ts"),
    /image_path: variant\.imagePath \? variant\.imagePath : null/,
  );
  assert.match(
    read("lib/products/queries.ts"),
    /product_id, name, price_override_poisha, stock, image_path/,
  );
});

test("migration 0005 adds image_path to product_variants", () => {
  const sql = read("supabase/migrations/0005_product_variant_image.sql");
  assert.match(sql, /alter table public\.product_variants/);
  assert.match(sql, /add column if not exists image_path text/);
  // No seed values: no real per-colour photos exist yet.
  assert.equal(/insert into public\.product_variants/i.test(sql), false);
});

test("no seed product invents a variant photo", () => {
  for (const product of PRODUCTS) {
    assert.equal(product.variantImages, undefined, `${product.slug} has a variantImages map`);
  }
});

test("the mock's only variant image is labelled a stand-in, not a real colour photo", () => {
  const mock = read("tests/e2e/mock-supabase.mjs");
  assert.match(mock, /STAND-IN ONLY/);
  assert.match(mock, /image_path: "sony-wh-1000xm5\.jpg"/);
  assert.match(mock, /No real per-colour/);
});
