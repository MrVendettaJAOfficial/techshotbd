// TechShot marketplace — product image path rules.
//
// Whether an image path is safe to store (local / Storage
// path or https URL, never Figma) and merging a product's
// photos into one ordered list. Pure functions, no imports.

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

/** A product can have at most 10 photos (product_images rows). */
export const MAX_PRODUCT_IMAGES = 10;

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
