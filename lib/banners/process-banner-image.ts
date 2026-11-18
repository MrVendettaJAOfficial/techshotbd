// TechShot marketplace — banner photo processing (upload crop).
//
// One job: take an uploaded banner photo and return the file that
// actually goes into Storage — a wide cover of
// BANNER_IMAGE_WIDTH_PX x BANNER_IMAGE_HEIGHT_PX (1600 x 640, the
// one universal banner size). sharp resizes with fit "cover", so a
// larger or differently-shaped photo is centre-cropped to the wide
// strip; the format never changes (JPEG stays JPEG, PNG stays PNG,
// WebP stays WebP), so the stored content type still matches the
// file. Banner photos are NOT the square 1200 x 1200 product size
// (lib/products/process-image.ts) — a banner is a wide strip, and a
// square crop would throw most of the photo away.
//
// The one exception is a photo smaller than the target in BOTH
// dimensions: it is kept at its original size, never upscaled —
// enlarging a 400 x 200 photo to 1600 x 640 would only blur it,
// and the display side (components/HeroCarousel, object-cover)
// already crops small photos to the strip on the page. "Kept at
// its original size" does NOT mean stored byte for byte: the photo
// is still re-encoded through sharp at its own size, because sharp
// drops EXIF / GPS / embedded metadata on re-encode (audit run-1,
// LOW 9, same flaw as the product-photo path) — a small banner
// photo must not leak its location into the public bucket just
// because it is small. The rule is therefore: at least one side
// at or above the target means "larger", and the file comes out
// exactly 1600 x 640; both sides below the target means "small",
// and the file comes out at its own size, re-encoded with metadata
// dropped. (sharp's withoutEnlargement cannot express this: on a
// 2000 x 1000 photo it refuses the height upscale the cover needs
// and returns 1600 x 800 — not the strip — so the size gate is
// done here, from the metadata.)
// Server-only: sharp is a native dependency and must never be
// imported from a client component.

import sharp from "sharp";

import { BANNER_IMAGE_HEIGHT_PX, BANNER_IMAGE_WIDTH_PX } from "../banners";

/** Content types the crop accepts, with the sharp output format. */
const OUTPUT_FORMATS: Record<string, "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Crop one uploaded banner photo to the universal wide size.
 * Returns the processed bytes and the content type to store them
 * under (always the input type — the format is preserved). Small
 * photos are re-encoded at their original size (never upscaled)
 * so no stored photo keeps EXIF / GPS metadata, whatever its
 * dimensions. Throws on an unknown content type or an unreadable
 * image; the caller (the upload server action) treats that like
 * any other upload failure and cleans up.
 */
export async function processBannerImage(
  input: Buffer,
  contentType: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const format = OUTPUT_FORMATS[contentType];
  if (!format) throw new Error(`unsupported photo type: ${contentType}`);
  const image = sharp(input);
  const meta = await image.metadata();
  // Small in both dimensions: re-encode at the original size —
  // never upscale (see the header) — so the stored bytes carry no
  // EXIF / GPS metadata. Anything else is "larger" and is
  // cover-resized to exactly the universal wide strip. Both paths
  // re-encode through sharp, which drops metadata by default
  // (no .withMetadata() call anywhere here).
  if (
    typeof meta.width === "number" &&
    typeof meta.height === "number" &&
    meta.width < BANNER_IMAGE_WIDTH_PX &&
    meta.height < BANNER_IMAGE_HEIGHT_PX
  ) {
    const buffer = await image.toFormat(format).toBuffer();
    return { buffer, contentType };
  }
  const buffer = await image
    .resize(BANNER_IMAGE_WIDTH_PX, BANNER_IMAGE_HEIGHT_PX, { fit: "cover" })
    .toFormat(format)
    .toBuffer();
  return { buffer, contentType };
}
