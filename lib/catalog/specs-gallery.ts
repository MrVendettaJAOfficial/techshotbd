// TechShot marketplace — specs record and gallery / variant photos.
//
// Builds the specs record for a mapped product and resolves
// which photo the gallery shows for the current variant
// selection. Pure logic, no imports except the row type —
// only erasable TypeScript, so `node --test` can load this
// file directly.

import type { DbProductRow } from "./db-types";

/**
 * The specs record for a mapped product: Description, then Warranty
 * (the product's own warranty column when set, otherwise the
 * long-standing default), then the product's specifications column
 * merged in — a specification never overwrites Description or
 * Warranty, and duplicate keys (case-insensitive) are dropped.
 */
export function buildSpecs(
  row: DbProductRow,
  description: string,
  isSubscription: boolean,
): Record<string, string> {
  const specs: Record<string, string> = {
    Description: description || row.title,
    Warranty:
      (row.warranty ?? "").trim() !== ""
        ? (row.warranty as string).trim()
        : isSubscription
          ? "Full validity guaranteed"
          : "1-year official warranty",
  };
  const seen = new Set(Object.keys(specs).map((key) => key.toLowerCase()));
  for (const spec of row.specifications ?? []) {
    const key = (spec?.key ?? "").trim();
    const value = (spec?.value ?? "").trim();
    if (key === "" || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    specs[key] = value;
  }
  return specs;
}

/**
 * Photo for the currently selected variant, or undefined when the
 * selection has no photo (the gallery then shows the product photo).
 * The colour decides the photo first — a storage option's photo is
 * the fallback — because a colour is what a photo shows; a storage
 * size rarely has its own shot. `product` only needs its
 * variantImages map, so this is usable from the seed catalogue too.
 */
export function resolveVariantImage(
  product: { variantImages?: Record<string, string> },
  colour?: string | null,
  storageLabel?: string | null,
): string | undefined {
  const images = product.variantImages;
  if (!images) return undefined;
  if (colour && images[colour]) return images[colour];
  if (storageLabel && images[storageLabel]) return images[storageLabel];
  return undefined;
}

/**
 * The photo list the gallery shows for the current selection, in
 * order: the selected variant's photo first when one is set (a
 * colour's photo is what a photo shows; a storage size rarely has
 * its own shot), then every photo for the product in sort_order.
 * A product with no gallery falls back to its single photo, so the
 * list always has at least one entry. Duplicates are removed — a
 * variant photo that is also the main photo appears once.
 */
export function buildGalleryList(
  product: {
    image: string;
    gallery?: string[];
    variantImages?: Record<string, string>;
  },
  colour?: string | null,
  storageLabel?: string | null,
): string[] {
  const variantImage = resolveVariantImage(product, colour, storageLabel);
  const base =
    product.gallery && product.gallery.length > 0 ? product.gallery : [product.image];
  const list = variantImage ? [variantImage, ...base] : base;
  return [...new Set(list)];
}
