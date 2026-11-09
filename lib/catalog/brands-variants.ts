// TechShot marketplace — brand and variant helpers.
//
// Derives the brand from a product title (the database has no
// brand column) and classifies / matches variant names
// (storage sizes, colours, normalised labels). Pure logic,
// no imports except the row type — only erasable TypeScript,
// so `node --test` can load this file directly.

import type { DbProductRow } from "./db-types";

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

/** Brands the storefront knows how to derive from a product title. */
export const KNOWN_BRANDS: string[] = [
  "Apple",
  "Samsung",
  "Sony",
  "JBL",
  "Anker",
  "Netflix",
  "Amazon",
  "Google",
];

/**
 * Derive the brand from a product title. The database has no brand
 * column, so the brand comes from the title: the first known brand
 * mentioned in it. "PlayStation DualSense" is a Sony product.
 */
export function deriveBrand(title: string): string {
  const text = (title ?? "").trim();
  if (/playstation/i.test(text)) return "Sony";
  for (const brand of KNOWN_BRANDS) {
    if (new RegExp(`\\b${brand}\\b`, "i").test(text)) return brand;
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/** True for variant names that are a storage size, e.g. "256 GB", "1 TB". */
export function isStorageVariantName(name: string): boolean {
  return /^\s*[\d,]+(\.\d+)?\s*(gb|tb|mb)\s*$/i.test(name ?? "");
}

const COLOUR_WORDS: string[] = [
  "black",
  "white",
  "silver",
  "blue",
  "red",
  "green",
  "cream",
  "purple",
  "grey",
  "gray",
  "gold",
  "pink",
  "yellow",
  "orange",
  "brown",
  "beige",
  "midnight",
  "starlight",
  "titanium",
  "natural",
  "desert",
  "space",
  "violet",
  "galactic",
  "squad",
  "phantom",
  "lavender",
  "mint",
  "coral",
  "navy",
  "graphite",
  "cosmic",
];

/**
 * True for variant names that are a colour, e.g. "Black",
 * "Natural Titanium", "Titanium Violet". Every word of the name must be
 * a known colour word; anything else (a model, a size, a plan) is not.
 */
export function isColourName(name: string): boolean {
  const words = (name ?? "")
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((w) => w.length > 0);
  return words.length > 0 && words.every((w) => COLOUR_WORDS.includes(w));
}

/**
 * Normalise a variant / storage-option label for comparison: lowercase
 * with all whitespace removed. The live database derives variant labels
 * from product titles ("256GB Natural Titanium") while the seed
 * catalogue writes storage options with a space ("256 GB"), so a plain
 * startsWith() comparison misses the option and prices the line at the
 * base price. Comparing normalised forms matches both spellings.
 */
export function normalizeVariantLabel(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, "");
}

/**
 * True when a cart line's variant starts with a storage-option label,
 * ignoring case and spacing: "256GB Natural Titanium" and
 * "256 GB · Natural Titanium" both match the "256 GB" option, and
 * "512GB Natural Titanium" matches "512 GB". A missing variant never
 * matches — a line with no variant is priced at the base price.
 */
export function variantMatchesOption(
  variant: string | null | undefined,
  optionLabel: string,
): boolean {
  if (!variant) return false;
  const normalised = normalizeVariantLabel(variant);
  const label = normalizeVariantLabel(optionLabel);
  return label.length > 0 && normalised.startsWith(label);
}

/**
 * Variant label for a product card. Built from the stored variants
 * (product_variants rows) when there are any, e.g. "256 GB · Black".
 * Otherwise derived from the title's trailing variant info: the part
 * after an em dash ("Netflix Premium — 1 Month" -> "1 Month"), or the
 * text from the first storage / size marker ("Apple iPhone 16 Pro
 * 256GB Natural Titanium" -> "256GB Natural Titanium"), or the title
 * with its brand prefix stripped. Never the first N characters of the
 * description.
 */
export function deriveVariant(row: DbProductRow): string {
  const stored = (row.product_variants ?? [])
    .map((v) => (v.name ?? "").trim())
    .filter((name) => name.length > 0);
  if (stored.length > 0) return stored.join(" · ");

  const title = (row.title ?? "").trim();
  const dashParts = title.split(" — ");
  if (dashParts.length > 1) return (dashParts[dashParts.length - 1] ?? "").trim();

  const brand = deriveBrand(title);
  const withoutBrand =
    brand !== "Other" && title.toLowerCase().startsWith(brand.toLowerCase())
      ? title.slice(brand.length).trim()
      : title;
  const sizeMatch = withoutBrand.match(/[\d,]+(\.\d+)?\s*(gb|tb|mah)\b/i) ??
    withoutBrand.match(/\d+(\.\d+)?\s*"/);
  if (sizeMatch && typeof sizeMatch.index === "number") {
    return withoutBrand.slice(sizeMatch.index).trim();
  }
  return withoutBrand;
}
