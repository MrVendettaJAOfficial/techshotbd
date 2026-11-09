// TechShot marketplace — product photo processing (upload crop).
//
// One job: take an uploaded photo and return the file that actually
// goes into Storage — a square of PRODUCT_IMAGE_SIZE_PX on each side
// (1200 x 1200, the one universal product-image size). sharp resizes
// with fit "cover", so a larger or non-square photo is centre-cropped
// to the square; the format never changes (JPEG stays JPEG, PNG stays
// PNG, WebP stays WebP), so the stored content type still matches
// the file.
//
// The one exception is a photo smaller than the target in BOTH
// dimensions: it is stored unchanged, never upscaled — enlarging a
// 400 x 200 photo to 1200 x 1200 would only blur it, and the display
// side (components/ProductImage, aspect-square + object-cover)
// already crops small photos to a square on the page. The rule is
// therefore: at least one side at or above the target means "larger",
// and the file comes out exactly 1200 x 1200; both sides below the
// target means "small", and the file is kept as-is. (sharp's
// withoutEnlargement cannot express this: on a 2000 x 1000 photo it
// refuses the height upscale the cover needs and returns 1200 x 1000
// — not a square — so the size gate is done here, from the metadata.)
// Server-only: sharp is a native dependency and must never be
// imported from a client component.

import sharp from "sharp";

import { PRODUCT_IMAGE_SIZE_PX } from "./validation/upload";

/** Content types the crop accepts, with the sharp output format. */
const OUTPUT_FORMATS: Record<string, "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Crop one uploaded photo to the universal square size. Returns the
 * processed bytes and the content type to store them under (always
 * the input type — the format is preserved). Throws on an unknown
 * content type or an unreadable image; the caller (the upload server
 * action) treats that like any other upload failure and cleans up.
 */
export async function processProductImage(
  input: Buffer,
  contentType: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const format = OUTPUT_FORMATS[contentType];
  if (!format) throw new Error(`unsupported photo type: ${contentType}`);
  const image = sharp(input);
  const meta = await image.metadata();
  // Small in both dimensions: keep as-is, never upscale (see the
  // header). Anything else is "larger" and is cover-resized to
  // exactly the universal square.
  if (
    typeof meta.width === "number" &&
    typeof meta.height === "number" &&
    meta.width < PRODUCT_IMAGE_SIZE_PX &&
    meta.height < PRODUCT_IMAGE_SIZE_PX
  ) {
    return { buffer: input, contentType };
  }
  const buffer = await image
    .resize(PRODUCT_IMAGE_SIZE_PX, PRODUCT_IMAGE_SIZE_PX, { fit: "cover" })
    .toFormat(format)
    .toBuffer();
  return { buffer, contentType };
}
