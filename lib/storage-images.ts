// TechShot marketplace — product photo URLs from Supabase Storage.
//
// Product photos live in the public `product-images` bucket in Supabase
// Storage. The product_images.storage_path column holds one of:
//   - a full https URL (passes through as-is),
//   - a legacy local path /images/products/<file>.jpg (the seed wrote
//     these; the filename is resolved into the bucket),
//   - a bare filename such as <slug>.jpg (the admin product form
//     accepts these).
// When Supabase is not configured the local /images/products/... path
// is kept, so the unconfigured preview still shows the bundled photos
// from public/images/products/.
//
// This file is pure logic with no imports on purpose (same rule as
// lib/catalog-rules.ts): it is imported directly by `node --test`
// (Node strips the erasable TypeScript types), so only erasable
// TypeScript is used here — no enums, namespaces or parameter
// properties. The Supabase URL is always passed in by the caller;
// this module never reads process.env itself, so the mapping is
// testable with any base URL (including the local mock Supabase).

/** The Supabase Storage bucket holding every product photo. Public. */
export const PRODUCT_IMAGES_BUCKET = "product-images";

/** Local product-photo path prefix, used before Storage and as fallback. */
export const LOCAL_PRODUCTS_PREFIX = "/images/products/";

/**
 * Normalise a Supabase URL into a base for Storage URLs, or null when
 * there is no usable URL (unconfigured, blank, or not http(s)). A
 * trailing slash is stripped so callers can append paths safely.
 */
export function supabaseStorageBaseUrl(supabaseUrl: string | null | undefined): string | null {
  const base = (supabaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return base;
  } catch {
    return null;
  }
}

/**
 * Public Storage URL for one file in the product-images bucket, or null
 * when Supabase is not configured or the filename is unsafe. Each path
 * segment is encoded, so a filename with spaces still builds a valid
 * URL; ".." is rejected outright.
 */
export function storagePublicUrl(
  fileName: string,
  supabaseUrl: string | null | undefined,
): string | null {
  const base = supabaseStorageBaseUrl(supabaseUrl);
  if (!base) return null;
  const file = (fileName ?? "").trim().replace(/^\/+/, "");
  if (!file || file.includes("..")) return null;
  const encoded = file
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${base}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${encoded}`;
}

/**
 * Map a stored product-image value to the URL the storefront renders.
 * A full http(s) URL passes through untouched; a legacy local path
 * /images/products/<file>.jpg resolves to that file in the Storage
 * bucket (falling back to the local path when Supabase is not
 * configured); any other local path is returned as-is; a bare
 * filename resolves into the bucket (falling back to the local
 * products folder when unconfigured). An empty value or a value
 * containing ".." resolves to "" — the caller falls back to the
 * product's slug image.
 */
export function resolveProductImageSrc(
  value: string | null | undefined,
  supabaseUrl: string | null | undefined,
): string {
  const raw = (value ?? "").trim();
  if (!raw || raw.includes("..")) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith(LOCAL_PRODUCTS_PREFIX)) {
    const file = raw.slice(LOCAL_PRODUCTS_PREFIX.length);
    return storagePublicUrl(file, supabaseUrl) ?? raw;
  }
  if (raw.startsWith("/")) return raw;
  return storagePublicUrl(raw, supabaseUrl) ?? `${LOCAL_PRODUCTS_PREFIX}${raw.replace(/^\/+/, "")}`;
}
