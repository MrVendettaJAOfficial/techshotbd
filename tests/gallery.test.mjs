// Multi-angle gallery tests — TechShot.
//
// What is proven here (all pure logic, no browser):
//   - the catalogue mapper carries EVERY photo for a product, in
//     sort_order, as `gallery` — `image` stays the first photo, so
//     cards, the cart and orders are unchanged;
//   - buildGalleryList puts the selected variant's photo first, then
//     the product's photos, deduped, and falls back to the single
//     photo when there is no gallery;
//   - the slider / swipe / pinch maths (lib/gallery.ts): wrap-around
//     indexes, swipe direction (short and vertical drags are not
//     swipes), pinch scale clamped to 1x–4x, zoom steps;
//   - the admin photo rules (lib/products/validation.ts): upload
//     validation (type, extension, size), generated Storage paths
//     (slug + timestamp + random suffix, never the uploaded
//     filename), merging the photo list (array wins, legacy single
//     photo only when the array is empty, empties and duplicates
//     dropped), and the server schema accepting / rejecting the
//     photo list;
//   - the seed and the mock actually carry the iPhone's extra angles
//     (the real per-product shots already in the bucket), and the
//     gallery component wires the slider, swipe, pinch and viewer
//     (source markers — the live behaviour is covered by the
//     Playwright run in tests/e2e/gallery.mjs).
//
// What is NOT proven here (no browser in `node --test`): the gallery
// actually auto-advancing, pausing on hover, swiping, or pinch
// zooming on a real device. That is covered by tests/e2e/gallery.mjs
// against the mock Supabase.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildGalleryList,
  mapDbProductToCatalog,
} from "../lib/catalog-rules.ts";
import {
  GALLERY_AUTO_SLIDE_MS,
  GALLERY_ZOOM_MAX,
  GALLERY_ZOOM_MIN,
  clampZoom,
  nextGalleryIndex,
  pinchDistance,
  pinchScale,
  prevGalleryIndex,
  swipeDirection,
  zoomStep,
} from "../lib/gallery.ts";
import {
  MAX_PRODUCT_IMAGES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  mergeImagePaths,
  productInputSchema,
  uploadStoragePath,
  validateUploadFile,
} from "../lib/products/validation.ts";
import { PRODUCTS } from "../lib/data/catalog.ts";

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

// Since the cleanup, the gallery and the admin form live in focused
// modules; read them joined so the markers below are still pinned to
// the code that runs them. Assertions are unchanged.
function readAll(rels) {
  return rels.map((rel) => read(rel)).join("\n");
}

const GALLERY_FILES = [
  "components/product-gallery/gallery.tsx",
  "components/product-gallery/photo-viewer.tsx",
  "components/product-gallery/product-detail.tsx",
  "components/product-gallery/review-form.tsx",
];
const MANAGER_FILES = [
  "components/product-manager/product-form.tsx",
  "components/product-manager/product-list.tsx",
  "components/product-manager/helpers.ts",
];
const PRODUCT_ACTION_FILES = [
  "lib/products/actions/shared.ts",
  "lib/products/actions/upload.ts",
  "lib/products/actions/create-update.ts",
  "lib/products/actions/manage.ts",
];

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
// Catalogue mapping: every photo, in sort_order.
// ---------------------------------------------------------------------------

test("mapDbProductToCatalog carries every photo as gallery, image stays first", () => {
  const mapped = mapDbProductToCatalog(
    row({
      product_images: [
        { storage_path: "/images/products/second.jpg", alt_text: "2", sort_order: 1 },
        { storage_path: "/images/products/first.jpg", alt_text: "1", sort_order: 0 },
        { storage_path: "/images/products/third.jpg", alt_text: "3", sort_order: 2 },
      ],
    }),
  );
  assert.equal(mapped.image, "/images/products/first.jpg");
  assert.deepEqual(mapped.gallery, [
    "/images/products/first.jpg",
    "/images/products/second.jpg",
    "/images/products/third.jpg",
  ]);
});

test("gallery is empty when no image rows exist (no slug guess)", () => {
  // 2026-11-09 image-400 fix: see tests/catalog.test.mjs — a product
  // with no image rows gets image "" and an empty gallery, and the
  // gallery/product page renders the logo placeholder instead of
  // requesting a photo file that may not exist.
  const mapped = mapDbProductToCatalog(row({ product_images: [] }));
  assert.equal(mapped.image, "");
  assert.deepEqual(mapped.gallery, []);
});

test("gallery dedupes the same photo twice and drops empty rows", () => {
  const mapped = mapDbProductToCatalog(
    row({
      product_images: [
        { storage_path: "/images/products/first.jpg", sort_order: 0 },
        { storage_path: "/images/products/first.jpg", sort_order: 1 },
        { storage_path: "", sort_order: 2 },
      ],
    }),
  );
  assert.deepEqual(mapped.gallery, ["/images/products/first.jpg"]);
});

test("gallery resolves Storage filenames to Storage URLs when configured", () => {
  const before = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  try {
    const mapped = mapDbProductToCatalog(
      row({
        product_images: [
          { storage_path: "apple-iphone-16-pro.jpg", sort_order: 0 },
          { storage_path: "apple-iphone-16-pro-2.jpg", sort_order: 1 },
        ],
      }),
    );
    assert.deepEqual(mapped.gallery, [
      "https://example.supabase.co/storage/v1/object/public/product-images/apple-iphone-16-pro.jpg",
      "https://example.supabase.co/storage/v1/object/public/product-images/apple-iphone-16-pro-2.jpg",
    ]);
    assert.equal(mapped.image, mapped.gallery[0]);
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = before;
  }
});

// ---------------------------------------------------------------------------
// buildGalleryList: variant photo first, then the product's photos.
// ---------------------------------------------------------------------------

test("buildGalleryList puts the variant photo first, then the gallery", () => {
  const product = {
    image: "/images/products/iphone.jpg",
    gallery: [
      "/images/products/iphone.jpg",
      "/images/products/iphone-2.jpg",
      "/images/products/iphone-3.jpg",
    ],
    variantImages: { "Black Titanium": "/images/products/iphone-black.jpg" },
  };
  assert.deepEqual(buildGalleryList(product, "Black Titanium", null), [
    "/images/products/iphone-black.jpg",
    "/images/products/iphone.jpg",
    "/images/products/iphone-2.jpg",
    "/images/products/iphone-3.jpg",
  ]);
  assert.deepEqual(buildGalleryList(product, "Natural Titanium", null), [
    "/images/products/iphone.jpg",
    "/images/products/iphone-2.jpg",
    "/images/products/iphone-3.jpg",
  ]);
});

test("buildGalleryList dedupes a variant photo that is also the main photo", () => {
  const product = {
    image: "/images/products/iphone.jpg",
    gallery: ["/images/products/iphone.jpg", "/images/products/iphone-2.jpg"],
    variantImages: { "Natural Titanium": "/images/products/iphone.jpg" },
  };
  assert.deepEqual(buildGalleryList(product, "Natural Titanium", null), [
    "/images/products/iphone.jpg",
    "/images/products/iphone-2.jpg",
  ]);
});

test("buildGalleryList falls back to the single photo with no gallery", () => {
  const product = { image: "/images/products/sony.jpg" };
  assert.deepEqual(buildGalleryList(product, null, null), ["/images/products/sony.jpg"]);
});

// ---------------------------------------------------------------------------
// Slider / swipe / pinch maths (lib/gallery.ts).
// ---------------------------------------------------------------------------

test("slider indexes wrap around both ends", () => {
  assert.equal(nextGalleryIndex(3, 4), 0);
  assert.equal(nextGalleryIndex(0, 4), 1);
  assert.equal(prevGalleryIndex(0, 4), 3);
  assert.equal(prevGalleryIndex(2, 4), 1);
  assert.equal(nextGalleryIndex(0, 1), 0);
  assert.equal(nextGalleryIndex(0, 0), 0);
  assert.equal(GALLERY_AUTO_SLIDE_MS, 4500);
});

test("swipeDirection: left is next, right is previous, short and vertical drags are not swipes", () => {
  assert.equal(swipeDirection(300, 200, 200, 200), "left");
  assert.equal(swipeDirection(200, 200, 300, 200), "right");
  assert.equal(swipeDirection(200, 200, 240, 200), null); // too short
  assert.equal(swipeDirection(200, 200, 100, 400), null); // mostly vertical — page scroll
  assert.equal(swipeDirection(200, 200, 200, 200), null); // a tap
});

test("pinch maths: distance, scale from finger spread, clamped to 1x–4x", () => {
  assert.equal(pinchDistance(0, 0, 3, 4), 5);
  assert.equal(pinchScale(100, 200, 1), 2);
  assert.equal(pinchScale(100, 50, 1), 1); // fingers together never shrinks below 1x
  assert.equal(pinchScale(100, 1000, 1), 4); // clamped at 4x
  assert.equal(pinchScale(0, 200, 2), 2); // zero starting distance: unchanged
  assert.equal(clampZoom(0.5), GALLERY_ZOOM_MIN);
  assert.equal(clampZoom(9), GALLERY_ZOOM_MAX);
  assert.equal(zoomStep(1, 1), 1.5);
  assert.equal(zoomStep(4, 1), 4);
  assert.equal(zoomStep(1, -1), 1);
  assert.equal(zoomStep(2.25, -1), 1.5);
});

// ---------------------------------------------------------------------------
// Upload validation (lib/products/validation.ts).
// ---------------------------------------------------------------------------

test("validateUploadFile accepts JPG, PNG and WebP within 5 MB", () => {
  assert.equal(validateUploadFile({ name: "photo.jpg", type: "image/jpeg", size: 1024 }), null);
  assert.equal(validateUploadFile({ name: "photo.jpeg", type: "image/jpeg", size: 1024 }), null);
  assert.equal(validateUploadFile({ name: "photo.png", type: "image/png", size: 1024 }), null);
  assert.equal(validateUploadFile({ name: "photo.webp", type: "image/webp", size: 1024 }), null);
  assert.equal(validateUploadFile({ name: "photo.jpg", type: "image/jpeg", size: MAX_UPLOAD_BYTES }), null);
  assert.equal(MAX_UPLOAD_FILES, 10);
});

test("validateUploadFile rejects other types, mismatched extensions and oversize files", () => {
  assert.match(
    validateUploadFile({ name: "photo.gif", type: "image/gif", size: 1024 }) ?? "",
    /JPG, PNG or WebP/,
  );
  assert.match(
    validateUploadFile({ name: "photo.png", type: "image/jpeg", size: 1024 }) ?? "",
    /does not look like/,
  );
  assert.match(
    validateUploadFile({ name: "photo.jpg", type: "image/jpeg", size: MAX_UPLOAD_BYTES + 1 }) ?? "",
    /too large/,
  );
  assert.match(validateUploadFile({ name: "photo.jpg", type: "image/jpeg", size: 0 }) ?? "", /empty/);
  assert.match(validateUploadFile({ name: "", type: "image/jpeg", size: 1024 }) ?? "", /filename/);
});

test("uploadStoragePath is slug + timestamp + random suffix, never the uploaded filename", () => {
  const path = uploadStoragePath("Apple iPhone 16 Pro!", "image/jpeg", 1780000000000, "abc123");
  assert.equal(path, "apple-iphone-16-pro-mppy1i4g-abc123.jpg");
  assert.equal(uploadStoragePath("Sony WH-1000XM5", "image/png", 1780000000000, "abc123"), "sony-wh-1000xm5-mppy1i4g-abc123.png");
  assert.equal(uploadStoragePath("Test", "image/webp", 1780000000000, "abc123"), "test-mppy1i4g-abc123.webp");
  // No traversal, no directories, no original filename in the result.
  const hostile = uploadStoragePath("../../etc", "image/jpeg", 1780000000000, "abc123");
  assert.ok(!hostile.includes("..") && !hostile.includes("/"));
  // Same inputs with a different random suffix give a different file.
  assert.notEqual(
    uploadStoragePath("Test", "image/jpeg", 1780000000000, "aaaaaa"),
    uploadStoragePath("Test", "image/jpeg", 1780000000000, "bbbbbb"),
  );
});

test("mergeImagePaths: array wins, legacy single photo only when the array is empty", () => {
  assert.deepEqual(mergeImagePaths({ imagePaths: ["a.jpg", "b.jpg"], imagePath: "old.jpg" }), ["a.jpg", "b.jpg"]);
  assert.deepEqual(mergeImagePaths({ imagePaths: [], imagePath: "old.jpg" }), ["old.jpg"]);
  assert.deepEqual(mergeImagePaths({ imagePaths: ["a.jpg", "a.jpg", "  ", "b.jpg"] }), ["a.jpg", "b.jpg"]);
  assert.deepEqual(mergeImagePaths({}), []);
});

test("productInputSchema accepts a photo list and rejects a bad entry or too many photos", () => {
  const base = {
    title: "Test Product",
    categorySlug: "audio",
    description: "",
    priceTaka: 1000,
    compareAtTaka: null,
    stock: 5,
    status: "active",
    variants: [],
  };
  assert.equal(productInputSchema.safeParse({ ...base, imagePaths: ["a.jpg", "b.jpg"] }).success, true);
  assert.equal(
    productInputSchema.safeParse({ ...base, imagePaths: ["https://www.figma.com/file/x/a.jpg"] }).success,
    false,
  );
  assert.equal(
    productInputSchema.safeParse({ ...base, imagePaths: Array.from({ length: MAX_PRODUCT_IMAGES + 1 }, (_, i) => `p${i}.jpg`) }).success,
    false,
  );
  // Legacy single-photo callers still validate.
  assert.equal(productInputSchema.safeParse({ ...base, imagePath: "a.jpg" }).success, true);
});

// ---------------------------------------------------------------------------
// Seed catalogue, seed.sql and the mock carry the iPhone's extra angles.
// ---------------------------------------------------------------------------

test("seed catalogue iPhone has the four real angle photos as its gallery", () => {
  const iphone = PRODUCTS.find((p) => p.slug === "apple-iphone-16-pro");
  assert.ok(iphone);
  assert.deepEqual(iphone.gallery, [
    "/images/products/apple-iphone-16-pro.jpg",
    "/images/products/apple-iphone-16-pro-2.jpg",
    "/images/products/apple-iphone-16-pro-3.jpg",
    "/images/products/apple-iphone-16-pro-4.jpg",
  ]);
  assert.equal(iphone.image, iphone.gallery[0]);
});

test("seed.sql seeds the iPhone's extra angles as product_images rows", () => {
  const seed = read("supabase/seed.sql");
  assert.match(seed, /apple-iphone-16-pro-2\.jpg/);
  assert.match(seed, /apple-iphone-16-pro-3\.jpg/);
  assert.match(seed, /apple-iphone-16-pro-4\.jpg/);
  assert.match(seed, /on conflict \(product_id, storage_path\) do nothing/);
});

test("the mock serves the iPhone's extra angles and accepts Storage uploads", () => {
  const mock = read("tests/e2e/mock-supabase.mjs");
  assert.match(mock, /img-iphone-2/);
  assert.match(mock, /apple-iphone-16-pro-4\.jpg/);
  assert.match(mock, /storage\/v1\/object\/product-images\//);
  assert.match(mock, /req\.method === "POST"/);
});

test("the gallery wires the slider, hover arrows, swipe, pinch and viewer", () => {
  const gallery = readAll(GALLERY_FILES);
  assert.match(gallery, /GALLERY_AUTO_SLIDE_MS/);
  assert.match(gallery, /hover: hover/);
  assert.match(gallery, /prefers-reduced-motion/);
  assert.match(gallery, /data-testid="gallery-prev"/);
  assert.match(gallery, /data-testid="gallery-next"/);
  assert.match(gallery, /swipeDirection/);
  assert.match(gallery, /pinchScale/);
  assert.match(gallery, /role="dialog"/);
  assert.match(gallery, /data-testid="viewer-zoom-in"/);
  assert.match(gallery, /data-testid="viewer-close"/);
  assert.match(gallery, /buildGalleryList/);
});

test("the admin form has a photo list with upload, and the actions write one row per photo", () => {
  const manager = readAll(MANAGER_FILES);
  assert.match(manager, /data-testid=\{`product-photo-\$\{index\}`\}/);
  assert.match(manager, /data-testid="add-photo-row"/);
  assert.match(manager, /data-testid="photo-upload-input"/);
  assert.match(manager, /uploadProductImages/);
  const actions = readAll(PRODUCT_ACTION_FILES);
  assert.match(actions, /export async function uploadProductImages/);
  assert.match(actions, /sort_order: index/);
  assert.match(actions, /mergeImagePaths\(input\)/);
  assert.match(actions, /upsert: false/);
});

test("the save confirmation survives router.refresh() via a module-scope pending notice", () => {
  // router.refresh() resets this form's client state (verified by
  // probing: typing a title, then Pause/Activate on another product,
  // clears the title), so a notice kept only in state never renders.
  // The notice is therefore also stored in module scope and consumed
  // once by the next mount's initial state. The e2e run proves the
  // notice actually appears after a save; this test pins the
  // mechanism in place so a later edit cannot silently drop it.
  const manager = readAll(MANAGER_FILES);
  assert.match(manager, /let pendingSaveNotice: string \| null = null/);
  assert.match(manager, /pendingSaveNotice = notice/);
  assert.match(manager, /const notice = pendingSaveNotice;\s*\n\s*pendingSaveNotice = null;/);
  assert.match(manager, /useState<string \| null>\(\(\) => \{/);
});

test("the gallery thumbnail row wraps instead of overflowing on a phone", () => {
  // With a colour variant picked the row holds 5 thumbnails (448px),
  // wider than a phone's content column (~358px at 390px). Without
  // the wrap the page's layout viewport expands to fit the row and
  // the whole page — including the fixed viewer — renders wider than
  // the screen. Pinned by tests/e2e/responsive-gallery.mjs.
  const gallery = readAll(GALLERY_FILES);
  assert.match(gallery, /mt-3 flex flex-wrap gap-3/);
});
