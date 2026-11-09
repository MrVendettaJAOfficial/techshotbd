// TechShot marketplace — mapping database rows to the catalogue.
//
// Enforces the public-visibility rule (ONLY status = 'active'
// products are ever shown to shoppers) and maps Supabase rows
// to the storefront catalogue shape. Prices are copied from
// the database untouched: never converted, rounded or
// re-derived here. Money is integer poisha everywhere
// (100 poisha = 1 BDT). Only erasable TypeScript is used
// here, so `node --test` can load this file directly; its
// single value import is lib/storage-images.ts (pure, no
// imports of its own).

import { resolveProductImageSrc } from "../storage-images";

import type {
  DbCategoryRow,
  DbProductRow,
  MappedCategory,
  MappedProduct,
  MappedSubscription,
  ReviewStats,
} from "./db-types";
import { deriveBrand, deriveVariant, isColourName, isStorageVariantName } from "./brands-variants";
import { buildSpecs } from "./specs-gallery";

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
 *
 * Rating and review count come ONLY from real reviews: pass the
 * product's aggregated figures (from aggregateReviewStats over the
 * reviews table) as `reviewStats`. When none are passed the product
 * has rating 0 and review_count 0 — the row's own rating /
 * review_count columns are NEVER read (they are fabricated seed
 * numbers). The warranty text comes from the product's own warranty
 * column when set; specifications from the column are merged into
 * the specs record.
 */
export function mapDbProductToCatalog(row: DbProductRow, reviewStats?: ReviewStats): MappedProduct {
  const pricePoisha = toNonNegativeInt(row.price_poisha, 0);
  const compareAtPoisha = toNonNegativeInt(
    row.compare_at_poisha ?? row.price_poisha,
    pricePoisha,
  );
  const reviewCount = toNonNegativeInt(reviewStats?.review_count, 0);
  const stock = toNonNegativeInt(row.stock, 0);
  const rating = Number(reviewStats?.rating ?? 0);
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
  // configured (see lib/storage-images.ts). Rows are authoritative:
  // the admin form writes a row when it uploads a file, so a product
  // with rows gets exactly those photos.
  //
  // There is deliberately NO slug fallback here any more. The old
  // fallback guessed a Storage URL from the product slug
  // (/images/products/<slug>.jpg) for any product with no image rows
  // — and for the three subscription products that file was never
  // uploaded, so the guessed URL 404'd in Storage and the Next.js
  // image optimizer answered 400 on every shop/product render (the
  // console error, with the initials fallback covering it up). A
  // product with no image rows now gets image "" and an empty
  // gallery, and ProductImage renders the branded logo placeholder
  // instead — no doomed URL is ever requested. `gallery` is every
  // resolved photo in sort_order (the first is `image`); the gallery
  // shows the whole list, cards and the cart keep using `image` alone.
  const resolvedImages = images
    .map((row) =>
      resolveProductImageSrc(row.storage_path, process.env.NEXT_PUBLIC_SUPABASE_URL),
    )
    .filter((src) => src !== "");
  const image = resolvedImages[0] ?? "";
  const gallery = [...new Set(resolvedImages)];

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
    specs: buildSpecs(row, description, isSubscription),
  };

  if (reviewCount >= 900) product.badge = "BESTSELLER";
  else if (flash) product.badge = "FLASH DEAL";
  if (colours.length > 0) product.colours = colours;
  if (storageOptions.length > 0) product.storageOptions = storageOptions;
  if (Object.keys(variantImages).length > 0) product.variantImages = variantImages;
  return product;
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
 * Pass the aggregated review stats (aggregateReviewStats over the
 * reviews table) so ratings are real; without them every product
 * maps with rating 0 / review_count 0 — the fabricated row columns
 * are never used.
 */
export function publicProductsToCatalog(
  rows: DbProductRow[],
  statsByProductId?: Map<string, ReviewStats>,
): MappedProduct[] {
  return filterPublicProducts(rows).map((row) =>
    mapDbProductToCatalog(row, row.id ? statsByProductId?.get(row.id) : undefined),
  );
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
