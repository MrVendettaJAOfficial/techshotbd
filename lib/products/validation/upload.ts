// TechShot marketplace — photo upload validation.
//
// Upload limits (5 MB, 10 files), per-file validation
// (JPEG / PNG / WebP only, extension must match the content
// type) and the generated Storage path for an uploaded
// photo. Pure functions, no server imports.

import { slugify } from "./slug-money";

/** Largest single photo upload: 5 MB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * The one universal product-image size, in pixels: every product
 * photo is displayed as a 1200 x 1200 square (Daraz-style) and every
 * upload is cropped to exactly this size before it reaches Storage
 * (see lib/products/process-image.ts). Never hard-code 1200 anywhere
 * else — import this constant, so the display size, the upload crop
 * and the admin warning can never drift apart.
 */
export const PRODUCT_IMAGE_SIZE_PX = 1200;

/**
 * The admin-form note about the universal size, built from the
 * constant above so the text and the crop always agree. Shown next
 * to the photo-path list and next to the upload control in the admin
 * product form.
 */
export const PRODUCT_IMAGE_SIZE_NOTE = `Recommended size: ${PRODUCT_IMAGE_SIZE_PX} x ${PRODUCT_IMAGE_SIZE_PX} px (square). Larger images are cropped to this size automatically.`;

/** Most photos in one upload: 10. */
export const MAX_UPLOAD_FILES = 10;

/**
 * Uploadable photo types, by content type. The stored extension
 * always comes from the content type, never from the uploaded
 * filename — a file called "photo.jpg" whose type is image/png is
 * stored as .png, and a file whose type is not in this map is
 * rejected outright. Only JPEG, PNG and WebP: the formats
 * next/image can optimise and the formats the shop actually serves.
 */
const UPLOAD_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/**
 * Validate one uploaded photo (name, content type, size), or null
 * when it is fine. The message is user-facing: the admin form shows
 * it next to the upload control. A mismatched extension is rejected
 * too — a .gif renamed to .jpg, or a .jpg whose type says PNG,
 * is not what it claims to be, and Storage would serve it with the
 * wrong content type.
 */
export function validateUploadFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  const name = (file.name ?? "").trim();
  if (name === "") return "Each photo needs a filename.";
  const expectedExt = UPLOAD_EXTENSIONS[file.type];
  if (!expectedExt) {
    return `"${name}" is not a supported photo. Upload JPG, PNG or WebP only.`;
  }
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  const matchesType =
    (file.type === "image/jpeg" && (ext === ".jpg" || ext === ".jpeg")) ||
    (file.type === "image/png" && ext === ".png") ||
    (file.type === "image/webp" && ext === ".webp");
  if (!matchesType) {
    return `"${name}" does not look like a ${expectedExt.slice(1).toUpperCase()} photo. Upload a matching JPG, PNG or WebP file.`;
  }
  if (file.size <= 0) return `"${name}" is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) {
    return `"${name}" is too large. Photos must be 5 MB or smaller.`;
  }
  return null;
}

function randomUploadSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Storage path for an uploaded photo: the product slug, a timestamp
 * and a random suffix, with the extension from the content type.
 * The uploaded filename is never used — it can contain path
 * separators, "..", spaces or anything else, and a generated name
 * can never traverse out of the bucket or overwrite an existing
 * file (upsert is off as well). `nowMs` / `random` are parameters
 * only so tests can pin them; callers pass nothing.
 */
export function uploadStoragePath(
  slug: string,
  contentType: string,
  nowMs: number = Date.now(),
  random: string = randomUploadSuffix(),
): string {
  const ext = UPLOAD_EXTENSIONS[contentType] ?? ".jpg";
  const base = slugify(slug);
  return `${base}-${nowMs.toString(36)}-${random}${ext}`;
}
