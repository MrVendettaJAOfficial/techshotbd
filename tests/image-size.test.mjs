// TechShot universal product-image size tests (1200 x 1200 square).
//
// Pins the one universal size: the shared constant, the exact admin
// warning text built from it, the upload crop in
// lib/products/process-image.ts (large / non-square photos come out
// exactly 1200 x 1200; small photos are never upscaled), and the
// display-side square rendering (aspect-square + object-cover) on
// every image render site.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import {
  PRODUCT_IMAGE_SIZE_NOTE,
  PRODUCT_IMAGE_SIZE_PX,
} from "../lib/products/validation/upload.ts";
import { processProductImage } from "../lib/products/process-image.ts";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (rel) => readFileSync(path.join(SOURCE_ROOT, rel), "utf8");

async function makeImage(width, height, format) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 120, b: 90 },
    },
  })
    .toFormat(format)
    .toBuffer();
}

async function dimensions(buffer) {
  const meta = await sharp(buffer).metadata();
  return { width: meta.width, height: meta.height, format: meta.format };
}

test("universal size constant is 1200", () => {
  assert.equal(PRODUCT_IMAGE_SIZE_PX, 1200);
});

test("admin warning text is exact", () => {
  assert.equal(
    PRODUCT_IMAGE_SIZE_NOTE,
    "Recommended size: 1200 x 1200 px (square). Larger images are cropped to this size automatically.",
  );
});

test("1200 is defined in exactly one place (the shared constant)", () => {
  // Count 1200 only on code lines, not in // comments (which may
  // describe the size in words) and not in the JSDoc above the
  // constant itself. The rule: no executable code anywhere else may
  // hard-code the size — it must import PRODUCT_IMAGE_SIZE_PX.
  const codeLines = (src) =>
    src
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
  const validationCode = codeLines(readSource("lib/products/validation/upload.ts")).join("\n");
  assert.equal((validationCode.match(/1200/g) ?? []).length, 1, "PRODUCT_IMAGE_SIZE_PX = 1200, once");
  for (const rel of [
    "lib/products/process-image.ts",
    "lib/products/actions/upload.ts",
    "components/product-manager/product-form.tsx",
  ]) {
    const code = codeLines(readSource(rel)).join("\n");
    assert.equal(
      (code.match(/1200/g) ?? []).length,
      0,
      `${rel} must not hard-code 1200 in code — it uses the constant`,
    );
  }
  // The crop and the form both reach the size only through the
  // shared constant / note (the upload action reaches it through
  // processProductImage).
  assert.match(
    codeLines(readSource("lib/products/process-image.ts")).join("\n"),
    /PRODUCT_IMAGE_SIZE_PX/,
  );
  assert.match(
    codeLines(readSource("components/product-manager/product-form.tsx")).join("\n"),
    /PRODUCT_IMAGE_SIZE_NOTE/,
  );
});

test("crop: large landscape 2000x1000 JPEG comes out exactly 1200x1200", async () => {
  const input = await makeImage(2000, 1000, "jpeg");
  const { buffer, contentType } = await processProductImage(input, "image/jpeg");
  assert.equal(contentType, "image/jpeg");
  assert.deepEqual(await dimensions(buffer), { width: 1200, height: 1200, format: "jpeg" });
});

test("crop: existing-photo shape 1376x768 JPEG comes out exactly 1200x1200", async () => {
  const input = await makeImage(1376, 768, "jpeg");
  const { buffer } = await processProductImage(input, "image/jpeg");
  assert.deepEqual(await dimensions(buffer), { width: 1200, height: 1200, format: "jpeg" });
});

test("crop: large portrait 800x1600 PNG comes out exactly 1200x1200, format kept", async () => {
  const input = await makeImage(800, 1600, "png");
  const { buffer, contentType } = await processProductImage(input, "image/png");
  assert.equal(contentType, "image/png");
  assert.deepEqual(await dimensions(buffer), { width: 1200, height: 1200, format: "png" });
});

test("crop: already-square 1500x1500 WebP comes out 1200x1200", async () => {
  const input = await makeImage(1500, 1500, "webp");
  const { buffer } = await processProductImage(input, "image/webp");
  assert.deepEqual(await dimensions(buffer), { width: 1200, height: 1200, format: "webp" });
});

test("no upscale: small 400x200 JPEG is kept exactly as-is", async () => {
  const input = await makeImage(400, 200, "jpeg");
  const { buffer, contentType } = await processProductImage(input, "image/jpeg");
  assert.equal(contentType, "image/jpeg");
  assert.ok(buffer.equals(input), "small photo bytes are unchanged, not re-encoded");
  assert.deepEqual(await dimensions(buffer), { width: 400, height: 200, format: "jpeg" });
});

test("no upscale: tiny 100x100 PNG is kept exactly as-is", async () => {
  const input = await makeImage(100, 100, "png");
  const { buffer } = await processProductImage(input, "image/png");
  assert.ok(buffer.equals(input));
  assert.deepEqual(await dimensions(buffer), { width: 100, height: 100, format: "png" });
});

test("crop: unsupported content type throws", async () => {
  const input = await makeImage(1300, 1300, "jpeg");
  await assert.rejects(() => processProductImage(input, "image/gif"), /unsupported photo type/);
});

test("display: ProductImage renders a square with object-cover", () => {
  const src = readSource("components/ProductImage.tsx");
  assert.match(src, /aspect-square/);
  assert.match(src, /object-cover/);
  assert.match(src, /fill/);
});

test("display: ProductCard is full-height with a bottom-pinned button, so a row is level", () => {
  const src = readSource("components/ProductCard.tsx");
  assert.match(src, /flex h-full min-w-0 flex-col/);
  assert.match(src, /mt-auto flex w-full items-center justify-center/);
});

test("display: cart recommendations no longer use a non-square h-28 w-full thumb", () => {
  const src = readSource("app/cart/page.tsx");
  assert.doesNotMatch(src, /h-28 w-full/);
  assert.match(src, /max-w-56 rounded-lg/);
});

test("display: gallery main image stays full-size square (not capped)", () => {
  // The gallery is carved out of the card-thumbnail resize: the
  // product-detail main photo stays full column width, square.
  const src = readSource("components/product-gallery/gallery.tsx");
  assert.doesNotMatch(src, /max-w-\[320px\]/);
  assert.match(src, /<ProductImage\n\s+key=\{list\[active\]\}/);
});

test("display: card thumbnails are capped smaller than the card, square, centred", () => {
  const src = readSource("components/ProductCard.tsx");
  assert.match(src, /relative mx-auto w-full max-w-\[220px\] pt-3/);
  assert.match(src, /<ProductImage src=\{product\.image\} alt=\{product\.title\} className="rounded-xl" \/>/);
});

test("admin form: the size note appears next to the photo-path list AND the upload control", () => {
  const src = readSource("components/product-manager/product-form.tsx");
  assert.match(src, /PRODUCT_IMAGE_SIZE_NOTE/);
  assert.match(src, /data-testid="photo-size-note"/);
  assert.match(src, /data-testid="photo-upload-size-note"/);
  // Each note renders the shared constant, not a pasted copy of the text.
  assert.equal((src.match(/PRODUCT_IMAGE_SIZE_NOTE/g) ?? []).length, 3);
});

test("overflow fix: header hides the wishlist heart below 400px and shrinks on mobile", () => {
  const src = readSource("components/Header.tsx");
  assert.match(src, /min-\[400px\]:flex/);
  assert.match(src, /px-3 py-3 sm:gap-6 sm:px-4/);
});
