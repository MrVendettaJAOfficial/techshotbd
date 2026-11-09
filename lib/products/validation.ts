// TechShot marketplace — pure product validation helpers.
//
// No server imports in this file (zod only), so the slug / money /
// variant rules can be unit-tested without a database or Supabase
// credentials. Server actions in lib/products/actions.ts import the
// zod schemas from here; the Node tests in
// tests/products-actions.test.mjs mirror these pure helpers in plain
// JS (Node cannot import .ts directly — same pattern as
// tests/pricing.test.mjs).
//
// Money is integer poisha (100 poisha = 1 BDT) everywhere in the DB.
// The forms work in BDT taka; conversion to poisha happens here and
// in the server actions, never in the browser.

import { z } from "zod";

export type ProductStatus = "draft" | "active" | "paused";

/** Lowercase slug: non-alphanumerics become "-", runs collapse, ends trimmed. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || "product";
}

/** Append -2, -3, ... until the slug is not in `taken`. */
export function dedupeSlug(base: string, taken: Iterable<string>): string {
  const takenSet = new Set(taken);
  if (!takenSet.has(base)) return base;
  let n = 2;
  while (takenSet.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** BDT taka -> integer poisha, rounded to the nearest poisha. */
export function takaToPoisha(taka: number): number {
  return Math.round(taka * 100);
}

/** Integer poisha -> BDT taka. */
export function poishaToTaka(poisha: number): number {
  return poisha / 100;
}

/**
 * An image path is safe when it is a local / Storage path (starts with
 * "/") or an https URL. Figma URLs are never accepted: Figma file /
 * image URLs are temporary and must never be stored as product images.
 * data: / blob: / javascript: URLs are rejected too.
 */
export function isSafeImagePath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("/")) return !trimmed.includes("..");
  if (/^https:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname.toLowerCase().includes("figma")) return false;
      return true;
    } catch {
      return false;
    }
  }
  // A bare Supabase Storage filename, e.g. "apple-iphone-16-pro.jpg":
  // it resolves into the public product-images bucket (see
  // lib/storage-images.ts). One path segment only, with an image
  // extension; ".." and subdirectories are rejected.
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp|avif|gif)$/i.test(trimmed)) {
    return !trimmed.includes("..");
  }
  return false;
}

export interface ParsedVariant {
  name: string;
  priceTaka?: number;
  stock: number;
  /** Photo for this variant (migration 0005): a Storage filename, a
   *  legacy /images/products/<file>.jpg path, or an https URL.
   *  Absent when the variant has no photo of its own. */
  imagePath?: string;
}

/** A product can have at most 10 photos (product_images rows). */
export const MAX_PRODUCT_IMAGES = 10;

/** Largest single photo upload: 5 MB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

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

/**
 * Merge a product's photos into one ordered list: the imagePaths
 * array wins; the legacy single imagePath is used only when the
 * array is empty (an older caller that still sends one photo).
 * Empty entries are dropped and duplicates are removed, so the
 * first photo — the main photo — is always the first entry.
 */
export function mergeImagePaths(input: {
  imagePaths?: string[];
  imagePath?: string;
}): string[] {
  const raw = [...(input.imagePaths ?? [])];
  if (raw.length === 0 && input.imagePath) raw.push(input.imagePath);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const entry of raw) {
    const path = (entry ?? "").trim();
    if (path === "" || seen.has(path)) continue;
    seen.add(path);
    merged.push(path);
  }
  return merged;
}

/**
 * Parse the form's comma-separated variant list:
 *   "128GB:89900:10, 256GB:99900:5"  or  "Red::20" (no price override)
 * Each entry is "Name:priceTaka:stock"; price may be empty (use the
 * product price) and stock defaults to 0. An optional fourth segment
 * is the variant's photo: "Black Titanium::10:iphone-black.jpg"
 * (price empty, stock 10, photo set). The photo is validated with
 * the same isSafeImagePath rule as product images. A URL holds its
 * colons: segments after the third are rejoined, so an https photo
 * URL survives the split. Throws an Error with a user-facing
 * message on malformed input.
 */
export function parseVariantsText(text: string): ParsedVariant[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  const variants: ParsedVariant[] = [];
  for (const rawEntry of trimmed.split(",")) {
    const entry = rawEntry.trim();
    if (entry === "") continue;
    const parts = entry.split(":").map((part) => part.trim());
    const name = parts[0] ?? "";
    if (name === "") {
      throw new Error("Each variant needs a name, e.g. \"128GB:89900:10\".");
    }
    const priceRaw = parts[1] ?? "";
    const stockRaw = parts[2] ?? "";
    const imageRaw = parts.slice(3).join(":").trim();
    const variant: ParsedVariant = { name, stock: 0 };
    if (priceRaw !== "") {
      const price = Number(priceRaw);
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(`Variant "${name}" has an invalid price. Prices must be ৳0 or more.`);
      }
      variant.priceTaka = price;
    }
    if (stockRaw !== "") {
      const stock = Number(stockRaw);
      if (!Number.isInteger(stock) || stock < 0) {
        throw new Error(`Variant "${name}" has an invalid stock. Stock must be a whole number, 0 or more.`);
      }
      variant.stock = stock;
    }
    if (imageRaw !== "") {
      if (!isSafeImagePath(imageRaw)) {
        throw new Error(
          `Variant "${name}" has an invalid photo. Use a Supabase Storage filename (e.g. <slug>.jpg), a storage path (e.g. /images/products/<slug>.jpg) or an https URL — never a Figma link.`,
        );
      }
      variant.imagePath = imageRaw;
    }
    variants.push(variant);
  }
  if (variants.length > 20) {
    throw new Error("A product can have at most 20 variants.");
  }
  return variants;
}

export const productVariantInputSchema = z.object({
  name: z.string().trim().min(1, "Each variant needs a name.").max(100, "Variant names must be 100 characters or fewer."),
  priceTaka: z.number().finite().min(0, "Variant prices must be ৳0 or more.").max(100_000_000).optional(),
  stock: z.number().int("Variant stock must be a whole number.").min(0, "Variant stock cannot be negative.").max(1_000_000),
  imagePath: z
    .string()
    .trim()
    .max(500, "Variant photo path is too long.")
    .optional()
    .refine(
      (value) => value === undefined || value === "" || isSafeImagePath(value),
      "Variant photo must be a Supabase Storage filename (e.g. <slug>.jpg), a storage path (e.g. /images/products/<slug>.jpg) or an https URL — never a Figma link.",
    ),
});

/** Server-side validation for create / update product input. */
export const productInputSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(200, "Title must be 200 characters or fewer."),
  categorySlug: z
    .string()
    .trim()
    .min(1, "Please choose a category.")
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Please choose a valid category."),
  description: z.string().trim().max(2000, "Description must be 2,000 characters or fewer.").optional().default(""),
  priceTaka: z.number().finite("Price must be a number.").min(0, "Price must be ৳0 or more.").max(100_000_000, "Price is too large."),
  compareAtTaka: z
    .number()
    .finite("Compare-at price must be a number.")
    .min(0, "Compare-at price must be ৳0 or more.")
    .max(100_000_000, "Compare-at price is too large.")
    .optional()
    .nullable(),
  stock: z.number().int("Stock must be a whole number.").min(0, "Stock cannot be negative.").max(1_000_000),
  status: z.enum(["draft", "active", "paused"]),
  /**
   * Legacy single photo, kept so an older caller that still sends
   * one photo keeps working. The form sends `imagePaths` instead;
   * mergeImagePaths (above) combines the two, array first.
   */
  imagePath: z
    .string()
    .trim()
    .max(500, "Image path is too long.")
    .optional()
    .default("")
    .refine(
      (value) => value === "" || isSafeImagePath(value),
      "Image must be a Supabase Storage filename (e.g. <slug>.jpg), a storage path (e.g. /images/products/<slug>.jpg) or an https URL — never a Figma link.",
    ),
  /**
   * Every photo for the product, in display order — the first is the
   * main photo. Each entry follows the same isSafeImagePath rule as
   * the single path above; at most 10 photos per product.
   */
  imagePaths: z
    .array(
      z
        .string()
        .trim()
        .max(500, "Image path is too long.")
        .refine(
          (value) => value === "" || isSafeImagePath(value),
          "Image must be a Supabase Storage filename (e.g. <slug>.jpg), a storage path (e.g. /images/products/<slug>.jpg) or an https URL — never a Figma link.",
        ),
    )
    .max(MAX_PRODUCT_IMAGES, "A product can have at most 10 photos.")
    .optional()
    .default([]),
  variants: z.array(productVariantInputSchema).max(20, "A product can have at most 20 variants.").optional().default([]),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export const productStatusSchema = z.enum(["active", "paused"]);
