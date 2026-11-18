// EXIF-strip tests — TechShot.
//
// Covers audit run-1 LOW 9
// (techshot:upload-small-image-exif-preserved-public-bucket):
// small uploaded product photos used to be stored byte for byte,
// so any EXIF metadata (camera software, GPS latitude/longitude)
// in the upload survived into the public product-images bucket.
// Every photo is now re-encoded through sharp at its own size —
// never upscaled — and sharp drops metadata on re-encode, so no
// stored photo retains EXIF regardless of dimensions. The same
// fix applies to banner photos (lib/banners/process-banner-image.ts),
// which had the identical small-image passthrough.
//
// The fixtures are real EXIF-bearing images built with sharp's
// .withMetadata(): the 800x600 JPEG carries Software + GPS
// coordinates, the 100x100 PNG carries Software. What is proven:
// the output has no EXIF segment at all, the identifying strings
// are gone from the bytes, the dimensions are unchanged (no
// upscale), and large photos keep their existing behaviour.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { processProductImage } from "../lib/products/process-image.ts";
import { processBannerImage } from "../lib/banners/process-banner-image.ts";

/** A small JPEG carrying real EXIF: Software + GPS coordinates. */
async function exifJpeg(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 120, b: 90 } },
  })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Software: "verify-dummy-camera", Make: "DummyCam" },
        GPS: {
          GPSLatitudeRef: "N",
          GPSLatitude: "22/1 34/1 0/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "91/1 49/1 0/1",
        },
      },
    })
    .toBuffer();
}

/** A small PNG carrying real EXIF (Software). */
async function exifPng(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 120, b: 90 } },
  })
    .png()
    .withMetadata({ exif: { IFD0: { Software: "verify-dummy-camera" } } })
    .toBuffer();
}

async function dimensions(buffer) {
  const meta = await sharp(buffer).metadata();
  return { width: meta.width, height: meta.height, exifBytes: meta.exif?.length ?? 0 };
}

test("small product photo: 800x600 JPEG with EXIF + GPS comes back the same size, EXIF gone", async () => {
  const input = await exifJpeg(800, 600);
  assert.ok((await sharp(input).metadata()).exif?.length > 0, "fixture must carry EXIF");
  assert.ok(input.includes(Buffer.from("verify-dummy-camera")), "fixture must carry the Software string");
  const { buffer, contentType } = await processProductImage(input, "image/jpeg");
  assert.equal(contentType, "image/jpeg");
  assert.deepEqual(await dimensions(buffer), { width: 800, height: 600, exifBytes: 0 });
  assert.ok(!buffer.includes(Buffer.from("verify-dummy-camera")), "Software string must not survive");
  assert.ok(!buffer.includes(Buffer.from("DummyCam")), "Make string must not survive");
});

test("small product photo: 100x100 PNG with EXIF comes back the same size, EXIF gone", async () => {
  const input = await exifPng(100, 100);
  assert.ok((await sharp(input).metadata()).exif?.length > 0, "fixture must carry EXIF");
  const { buffer, contentType } = await processProductImage(input, "image/png");
  assert.equal(contentType, "image/png");
  assert.deepEqual(await dimensions(buffer), { width: 100, height: 100, exifBytes: 0 });
  assert.ok(!buffer.includes(Buffer.from("verify-dummy-camera")));
});

test("large product photo: 2000x1000 JPEG with EXIF still comes out 1200x1200, EXIF gone", async () => {
  const input = await exifJpeg(2000, 1000);
  const { buffer } = await processProductImage(input, "image/jpeg");
  assert.deepEqual(await dimensions(buffer), { width: 1200, height: 1200, exifBytes: 0 });
});

test("small banner photo: 400x200 JPEG with EXIF comes back the same size, EXIF gone", async () => {
  const input = await exifJpeg(400, 200);
  const { buffer, contentType } = await processBannerImage(input, "image/jpeg");
  assert.equal(contentType, "image/jpeg");
  assert.deepEqual(await dimensions(buffer), { width: 400, height: 200, exifBytes: 0 });
  assert.ok(!buffer.includes(Buffer.from("verify-dummy-camera")));
});

test("large banner photo: 2000x1000 JPEG with EXIF still comes out 1600x640, EXIF gone", async () => {
  const input = await exifJpeg(2000, 1000);
  const { buffer } = await processBannerImage(input, "image/jpeg");
  assert.deepEqual(await dimensions(buffer), { width: 1600, height: 640, exifBytes: 0 });
});

test("no upscale still holds: small photos keep their dimensions exactly", async () => {
  const { buffer } = await processProductImage(await exifJpeg(400, 200), "image/jpeg");
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.width, 400);
  assert.equal(meta.height, 200);
});
