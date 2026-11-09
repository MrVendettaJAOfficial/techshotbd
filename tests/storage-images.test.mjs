// Supabase Storage product-photo URL tests — TechShot.
//
// Proves the mapping in lib/storage-images.ts: a stored image value
// (legacy local path, bare Storage filename, or full https URL) maps
// to the URL the storefront renders, and the local fallback holds when
// Supabase is not configured. Also proves the catalogue mapper in
// lib/catalog-rules.ts resolves a database row's storage_path through
// the same mapping when NEXT_PUBLIC_SUPABASE_URL is set.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCT_IMAGES_BUCKET,
  resolveProductImageSrc,
  storagePublicUrl,
  supabaseStorageBaseUrl,
} from "../lib/storage-images.ts";
import { mapDbProductToCatalog } from "../lib/catalog-rules.ts";

const LIVE = "https://paaisrkigmgenpsdtoji.supabase.co";
const LIVE_STORAGE =
  "https://paaisrkigmgenpsdtoji.supabase.co/storage/v1/object/public/product-images";

test("bucket name is product-images", () => {
  assert.equal(PRODUCT_IMAGES_BUCKET, "product-images");
});

test("supabaseStorageBaseUrl: trims a trailing slash, rejects junk", () => {
  assert.equal(supabaseStorageBaseUrl(`${LIVE}/`), LIVE);
  assert.equal(supabaseStorageBaseUrl(""), null);
  assert.equal(supabaseStorageBaseUrl(null), null);
  assert.equal(supabaseStorageBaseUrl("not a url"), null);
  assert.equal(supabaseStorageBaseUrl("ftp://example.com"), null);
});

test("storagePublicUrl: builds the public bucket URL, encodes segments", () => {
  assert.equal(
    storagePublicUrl("apple-iphone-16-pro.jpg", LIVE),
    `${LIVE_STORAGE}/apple-iphone-16-pro.jpg`,
  );
  assert.equal(
    storagePublicUrl("my photo.jpg", LIVE),
    `${LIVE_STORAGE}/my%20photo.jpg`,
  );
  assert.equal(storagePublicUrl("apple-iphone-16-pro.jpg", ""), null);
  assert.equal(storagePublicUrl("../secret.jpg", LIVE), null);
  assert.equal(storagePublicUrl("", LIVE), null);
});

test("resolveProductImageSrc: legacy local path maps into the bucket", () => {
  assert.equal(
    resolveProductImageSrc("/images/products/apple-iphone-16-pro.jpg", LIVE),
    `${LIVE_STORAGE}/apple-iphone-16-pro.jpg`,
  );
});

test("resolveProductImageSrc: bare filename maps into the bucket", () => {
  assert.equal(
    resolveProductImageSrc("sony-wh-1000xm5.jpg", LIVE),
    `${LIVE_STORAGE}/sony-wh-1000xm5.jpg`,
  );
});

test("resolveProductImageSrc: full https URL passes through as-is", () => {
  const url = "https://example.com/photos/custom.jpg";
  assert.equal(resolveProductImageSrc(url, LIVE), url);
});

test("resolveProductImageSrc: other local paths pass through as-is", () => {
  assert.equal(resolveProductImageSrc("/images/hero.jpg", LIVE), "/images/hero.jpg");
});

test("resolveProductImageSrc: unconfigured keeps the local path", () => {
  assert.equal(
    resolveProductImageSrc("/images/products/apple-iphone-16-pro.jpg", ""),
    "/images/products/apple-iphone-16-pro.jpg",
  );
  assert.equal(
    resolveProductImageSrc("/images/products/apple-iphone-16-pro.jpg", null),
    "/images/products/apple-iphone-16-pro.jpg",
  );
  assert.equal(
    resolveProductImageSrc("sony-wh-1000xm5.jpg", ""),
    "/images/products/sony-wh-1000xm5.jpg",
  );
});

test("resolveProductImageSrc: empty or traversal value resolves to empty", () => {
  assert.equal(resolveProductImageSrc("", LIVE), "");
  assert.equal(resolveProductImageSrc(null, LIVE), "");
  assert.equal(resolveProductImageSrc("/images/products/../../secret.jpg", LIVE), "");
  assert.equal(resolveProductImageSrc("../secret.jpg", LIVE), "");
});

test("mapDbProductToCatalog: row storage_path resolves to the Storage URL", () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = LIVE;
  try {
    const product = mapDbProductToCatalog({
      title: "Apple iPhone 16 Pro 256GB Natural Titanium",
      slug: "apple-iphone-16-pro-256gb-natural-titanium",
      price_poisha: 11990000,
      status: "active",
      product_images: [
        { storage_path: "/images/products/apple-iphone-16-pro.jpg", alt_text: null, sort_order: 0 },
      ],
    });
    assert.equal(product.image, `${LIVE_STORAGE}/apple-iphone-16-pro.jpg`);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  }
});

test("mapDbProductToCatalog: unconfigured keeps the stored local path", () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    const product = mapDbProductToCatalog({
      title: "Apple iPhone 16 Pro 256GB Natural Titanium",
      slug: "apple-iphone-16-pro-256gb-natural-titanium",
      price_poisha: 11990000,
      status: "active",
      product_images: [
        { storage_path: "/images/products/apple-iphone-16-pro.jpg", alt_text: null, sort_order: 0 },
      ],
    });
    assert.equal(product.image, "/images/products/apple-iphone-16-pro.jpg");
    const noImage = mapDbProductToCatalog({
      title: "Sony WH-1000XM5",
      slug: "sony-wh-1000xm5",
      price_poisha: 2499000,
      status: "active",
      product_images: [],
    });
    assert.equal(noImage.image, "/images/products/sony-wh-1000xm5.jpg");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  }
});

test("mapDbProductToCatalog: no images still falls back to the slug image", () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = LIVE;
  try {
    const product = mapDbProductToCatalog({
      title: "Sony WH-1000XM5",
      slug: "sony-wh-1000xm5",
      price_poisha: 2499000,
      status: "active",
      product_images: [],
    });
    assert.equal(product.image, `${LIVE_STORAGE}/sony-wh-1000xm5.jpg`);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  }
});
