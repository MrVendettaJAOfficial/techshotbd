// TechShot marketplace — pure catalogue rules.
//
// Maps Supabase rows to the storefront catalogue shape and enforces the
// public-visibility rule: ONLY status = 'active' products are ever shown
// to shoppers. A paused / draft / deleted product must not appear.
//
// This file has almost no imports on purpose: it is pure logic, so it
// can be imported directly by `node --test` (Node strips the erasable
// TypeScript types) and by the server-side catalogue loader in
// lib/supabase/catalog.ts. Its single import is lib/storage-images.ts,
// which follows the same rule (pure, no imports of its own), so the
// file stays directly loadable. Only erasable TypeScript is used here
// (interfaces + type annotations) — no enums, namespaces or parameter
// properties — so Node's type stripping can load this file as-is.
//
// Money is integer poisha everywhere (100 poisha = 1 BDT). Prices are
// copied from the database untouched: never converted, rounded or
// re-derived here.

import { resolveProductImageSrc } from "./storage-images";

/** A product_images row, as read from Supabase. */
export interface DbProductImageRow {
  storage_path: string;
  alt_text?: string | null;
  sort_order?: number | null;
}

/** A product_variants row, as read from Supabase. `image_path` is the
 *  variant's own photo (migration 0005): a Storage filename, a legacy
 *  /images/products/<file>.jpg path, or an https URL. NULL / empty
 *  means the gallery shows the product photo. */
export interface DbProductVariantRow {
  name: string;
  price_override_poisha?: number | null;
  stock?: number | null;
  image_path?: string | null;
}

/** A categories row, as read from Supabase. */
export interface DbCategoryRow {
  id?: string;
  slug: string;
  name: string;
  sort_order?: number | null;
  is_active?: boolean | null;
}

/**
 * A products row, as read from Supabase. `category_slug` is filled in by
 * the loader (lib/supabase/catalog.ts) from the categories table; a row
 * may also carry an embedded `categories` join instead.
 */
export interface DbProductRow {
  id?: string;
  category_id?: string | null;
  category_slug?: string | null;
  title: string;
  slug: string;
  description?: string | null;
  price_poisha: number;
  compare_at_poisha?: number | null;
  stock?: number | null;
  status: string;
  rating?: number | string | null;
  review_count?: number | null;
  is_flash_deal?: boolean | null;
  flash_ends_at?: string | null;
  product_images?: DbProductImageRow[] | null;
  product_variants?: DbProductVariantRow[] | null;
  categories?: { slug: string; name?: string } | Array<{ slug: string; name?: string }> | null;
}

/** The storefront Product shape (mirrors lib/data/catalog.ts Product). */
export interface MappedProduct {
  slug: string;
  title: string;
  variant: string;
  price_poisha: number;
  compare_at_poisha: number;
  rating: number;
  review_count: number;
  stock: number;
  category: string;
  brand: string;
  badge?: string;
  flash?: boolean;
  condition: "New" | "Refurbished";
  image: string;
  /**
   * Every photo for this product, in display order (product_images
   * sort_order), resolved to the URL the storefront renders. The
   * first entry is always `image` — cards, the cart and orders keep
   * using `image` alone, while the product gallery shows the whole
   * list (main photo, thumbnails, slider). A product with one photo
   * has a one-entry gallery; a product with no image rows falls back
   * to the slug image, exactly like `image` does.
   */
  gallery?: string[];
  description: string;
  specs: Record<string, string>;
  colours?: string[];
  storageOptions?: Array<{ label: string; priceDeltaPoisha: number; stock: number }>;
  /**
   * Photo per variant, keyed by the variant's exact name (a colour
   * name or a storage label) and resolved to the URL the storefront
   * renders (Storage URL when configured, local path otherwise).
   * Only variants with a photo set are present; a missing key means
   * "no photo for this variant — show the product photo". No real
   * per-colour photos exist yet, so this is usually absent.
   */
  variantImages?: Record<string, string>;
}

/** The storefront Category shape (mirrors lib/data/catalog.ts Category). */
export interface MappedCategory {
  slug: string;
  name: string;
  tagline: string;
}

/** The storefront SubscriptionPlan shape (mirrors lib/data/catalog.ts). */
export interface MappedSubscription {
  slug: string;
  name: string;
  price_poisha: number;
  period: string;
  tagline: string;
  productSlug: string;
}

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
// Public visibility — the core rule of this module.
// ---------------------------------------------------------------------------

/** True only for products shoppers may see: status must be 'active'. */
export function isPublicProduct(row: DbProductRow | null | undefined): boolean {
  return !!row && row.status === "active";
}

/** Keep only the publicly visible rows, in their original order. */
export function filterPublicProducts(rows: DbProductRow[]): DbProductRow[] {
  return (rows ?? []).filter(isPublicProduct);
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

/** Resolve the category slug for a row (loader-filled, or joined). */
export function categorySlugForRow(row: DbProductRow): string {
  if (row.category_slug) return row.category_slug;
  const joined = row.categories;
  if (joined) {
    const first = Array.isArray(joined) ? joined[0] : joined;
    if (first && first.slug) return first.slug;
  }
  return "uncategorized";
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toNonNegativeInt(value: number | string | null | undefined, fallback: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

/**
 * Map one database product row to the storefront Product shape.
 * Prices are preserved exactly as stored (integer poisha). The caller
 * is responsible for the visibility rule — map only rows that passed
 * isPublicProduct / filterPublicProducts.
 */
export function mapDbProductToCatalog(row: DbProductRow): MappedProduct {
  const pricePoisha = toNonNegativeInt(row.price_poisha, 0);
  const compareAtPoisha = toNonNegativeInt(
    row.compare_at_poisha ?? row.price_poisha,
    pricePoisha,
  );
  const reviewCount = toNonNegativeInt(row.review_count, 0);
  const stock = toNonNegativeInt(row.stock, 0);
  const rating = Number(row.rating ?? 0);
  const category = categorySlugForRow(row);
  const isSubscription = category === "subscriptions";
  const description = (row.description ?? "").trim();
  const flash = row.is_flash_deal === true;

  const images = [...(row.product_images ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );
  // Product photos live in the public `product-images` bucket in
  // Supabase Storage: a stored local path /images/products/<file>.jpg
  // or a bare filename resolves to its Storage URL, a full https URL
  // passes through, and the local path is kept when Supabase is not
  // configured (see lib/storage-images.ts). The slug fallback goes
  // through the same resolution, so a product with no image rows still
  // gets its Storage photo; an empty resolution falls back to the
  // local slug image, exactly as before. `gallery` is every resolved
  // photo in sort_order (the first is `image`); the gallery shows
  // the whole list, cards and the cart keep using `image` alone.
  const resolvedImages = images
    .map((row) =>
      resolveProductImageSrc(row.storage_path, process.env.NEXT_PUBLIC_SUPABASE_URL),
    )
    .filter((src) => src !== "");
  // The slug fallback goes through the same resolution, so a product
  // with no image rows still gets its Storage photo when configured
  // (and the local slug image when not).
  const image =
    resolvedImages[0] ??
    (resolveProductImageSrc(
      `/images/products/${row.slug}.jpg`,
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ) || `/images/products/${row.slug}.jpg`);
  const gallery = [...new Set([image, ...resolvedImages.slice(1)])];

  const variants = row.product_variants ?? [];
  const storageOptions = variants
    .filter((v) => isStorageVariantName(v.name))
    .map((v) => ({
      label: v.name.trim(),
      priceDeltaPoisha:
        toNonNegativeInt(v.price_override_poisha ?? pricePoisha, pricePoisha) - pricePoisha,
      stock: toNonNegativeInt(v.stock, 0),
    }));
  const colours = variants
    .filter((v) => isColourName(v.name))
    .map((v) => v.name.trim());
  // One photo per variant (migration 0005): a variant's image_path
  // resolves through the same Storage helper as the product photo.
  // Only variants with a usable photo are present — anything else
  // falls back to the product photo in the gallery.
  const variantImages: Record<string, string> = {};
  for (const v of variants) {
    const name = (v.name ?? "").trim();
    if (!name || variantImages[name]) continue;
    const resolved = resolveProductImageSrc(
      v.image_path,
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    );
    if (resolved) variantImages[name] = resolved;
  }

  const product: MappedProduct = {
    slug: row.slug,
    title: row.title,
    variant: deriveVariant(row),
    price_poisha: pricePoisha,
    compare_at_poisha: compareAtPoisha,
    rating: Number.isFinite(rating) ? rating : 0,
    review_count: reviewCount,
    stock,
    category,
    brand: deriveBrand(row.title),
    flash,
    condition: "New",
    image,
    gallery,
    description,
    specs: {
      Description: description || row.title,
      Warranty: isSubscription ? "Full validity guaranteed" : "1-year official warranty",
    },
  };

  if (reviewCount >= 900) product.badge = "BESTSELLER";
  else if (flash) product.badge = "FLASH DEAL";
  if (colours.length > 0) product.colours = colours;
  if (storageOptions.length > 0) product.storageOptions = storageOptions;
  if (Object.keys(variantImages).length > 0) product.variantImages = variantImages;
  return product;
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

/** Map one database category row to the storefront Category shape. */
export function mapDbCategoryToCatalog(row: DbCategoryRow): MappedCategory {
  // The database has no tagline column; the storefront tolerates an
  // empty tagline (category tiles render name + tagline).
  return { slug: row.slug, name: row.name, tagline: "" };
}

/**
 * Map a mapped subscription product to the SubscriptionPlan shape used
 * by the homepage. The plan name drops the trailing duration
 * ("Netflix Premium — 1 Month" -> "Netflix Premium"); the period comes
 * from the title / description (a year-long plan is "/year", otherwise
 * "/month"); the tagline is the description's first sentence.
 */
export function mapDbProductToSubscription(product: MappedProduct): MappedSubscription {
  const name = product.title.split(" — ")[0]?.trim() || product.title;
  const haystack = `${product.title} ${product.description}`.toLowerCase();
  const period = /1\s*year|12\s*months?|annual/.test(haystack) ? "/year" : "/month";
  const firstSentence = (product.description.split(/(?<=\.)\s+/)[0] ?? "").trim();
  return {
    slug: product.slug,
    name,
    price_poisha: product.price_poisha,
    period,
    tagline: firstSentence || product.title,
    productSlug: product.slug,
  };
}

/**
 * Apply the visibility rule and map in one step: the public catalogue
 * for a set of database rows. Adding a product (status 'active') makes
 * it appear; pausing / drafting / deleting it makes it disappear.
 */
export function publicProductsToCatalog(rows: DbProductRow[]): MappedProduct[] {
  return filterPublicProducts(rows).map(mapDbProductToCatalog);
}

/**
 * Earliest flash_ends_at among the given rows (flash deals only), or
 * undefined when no flash deal carries an end time.
 */
export function earliestFlashEndsAt(rows: DbProductRow[]): Date | undefined {
  let earliest: Date | undefined;
  for (const row of rows ?? []) {
    if (!row.is_flash_deal || !row.flash_ends_at) continue;
    const endsAt = new Date(row.flash_ends_at);
    if (Number.isNaN(endsAt.getTime())) continue;
    if (!earliest || endsAt.getTime() < earliest.getTime()) earliest = endsAt;
  }
  return earliest;
}

/**
 * Related products for a detail page: same-category products first,
 * then everything else, excluding the product itself.
 */
export function relatedProducts(
  products: MappedProduct[],
  product: MappedProduct,
  n: number,
): MappedProduct[] {
  const sameCategory = products.filter(
    (p) => p.slug !== product.slug && p.category === product.category,
  );
  const others = products.filter(
    (p) => p.slug !== product.slug && p.category !== product.category,
  );
  return [...sameCategory, ...others].slice(0, Math.max(0, n));
}
