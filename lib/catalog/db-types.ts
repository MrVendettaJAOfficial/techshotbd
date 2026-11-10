// TechShot marketplace — database row types and storefront shapes.
//
// The Supabase row shapes (Db*Row), the real-review figures
// (ReviewStats) and the storefront shapes the mapper produces
// (MappedProduct / MappedCategory / MappedSubscription). Pure
// types plus the review-stats aggregation — no imports, so
// `node --test` can load this file directly (only erasable
// TypeScript is used here, same rule as lib/catalog-rules.ts).

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
  /**
   * Every category slug the product belongs to, primary included
   * (loader-filled from the product_categories join table,
   * migration 0012). Missing / empty means "primary category
   * only" — rows written before the join table existed keep
   * working with no migration of their own.
   */
  category_slugs?: string[] | null;
  title: string;
  slug: string;
  description?: string | null;
  price_poisha: number;
  compare_at_poisha?: number | null;
  stock?: number | null;
  status: string;
  /**
   * IGNORED by the mapper: the seeded products.rating /
   * review_count columns are fabricated numbers, not real reviews.
   * Rating and review count come only from the reviews table (see
   * ReviewStats / mapDbProductToCatalog's second argument and
   * lib/supabase/catalog.ts). Kept on the row type because the
   * columns still exist in the database.
   */
  rating?: number | string | null;
  review_count?: number | null;
  /** Warranty text (products.warranty, migration 0008), or null. */
  warranty?: string | null;
  /** Specifications (products.specifications jsonb, migration 0008). */
  specifications?: Array<{ key: string; value: string }> | null;
  is_flash_deal?: boolean | null;
  flash_ends_at?: string | null;
  product_images?: DbProductImageRow[] | null;
  product_variants?: DbProductVariantRow[] | null;
  categories?: { slug: string; name?: string } | Array<{ slug: string; name?: string }> | null;
}

/** Real review figures for one product, aggregated from the reviews table. */
export interface ReviewStats {
  rating: number;
  review_count: number;
}

/**
 * Aggregate raw review rows ({ product_id, rating }) into per-product
 * figures: the average rating rounded to 1 decimal, and the count.
 * Pure, so it is unit-testable without a database.
 */
export function aggregateReviewStats(
  rows: Array<{ product_id: string; rating: number }>,
): Map<string, ReviewStats> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const row of rows ?? []) {
    if (!row || typeof row.product_id !== "string" || !Number.isFinite(row.rating)) continue;
    const entry = sums.get(row.product_id) ?? { total: 0, count: 0 };
    entry.total += row.rating;
    entry.count += 1;
    sums.set(row.product_id, entry);
  }
  const stats = new Map<string, ReviewStats>();
  for (const [productId, entry] of sums) {
    stats.set(productId, {
      rating: entry.count === 0 ? 0 : Math.round((entry.total / entry.count) * 10) / 10,
      review_count: entry.count,
    });
  }
  return stats;
}

/**
 * The "Flash deals" category slug. Ticking it in the product form
 * puts a product in the home-page flash-deal section (see
 * lib/catalog/mapping.ts isFlashDealRow); the seed and migration
 * 0012 both create the category under this slug.
 */
export const FLASH_DEALS_SLUG = "flash-deals";

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
  /**
   * Every category this product belongs to, the primary category
   * first (see MappedProduct.category). The product form's
   * checkbox list writes these through the product_categories
   * join table (migration 0012); a product with no join rows has
   * exactly one entry — its primary category. The shop filter
   * matches any entry, and the flash-deal section reads membership
   * in "flash-deals" (see lib/catalog/mapping.ts isFlashDealRow).
   */
  categorySlugs: string[];
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
