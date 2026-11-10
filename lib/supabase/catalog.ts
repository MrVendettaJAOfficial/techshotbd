// TechShot marketplace — live storefront catalogue from Supabase.
//
// SERVER ONLY (imports lib/supabase/server, which reads cookies). The
// public storefront reads through the anon client, so Row Level Security
// applies: anon visitors can only read active products and active
// categories (see supabase/policies.sql). On top of that, this module
// enforces the visibility rule in code too — only status = 'active'
// products are ever returned (see lib/catalog-rules.ts).
//
// When Supabase is not configured, or a live query fails, getCatalog()
// falls back to the local seed catalogue (lib/data/catalog.ts) with a
// console warning only — shoppers never see an error and no
// configuration details are ever surfaced.

import { cache } from "react";
import { createClient } from "./server";
import {
  CATEGORIES,
  FLASH_DEAL_ENDS_AT,
  PRODUCTS,
  SUBSCRIPTIONS,
} from "../data/catalog";
import type { Category, Product, SubscriptionPlan } from "../data/catalog";
import {
  aggregateReviewStats,
  earliestFlashEndsAt,
  filterPublicProducts,
  mapDbCategoryToCatalog,
  mapDbProductToCatalog,
  mapDbProductToSubscription,
  type ReviewStats,
} from "../catalog-rules";
import type { DbCategoryRow, DbProductRow } from "../catalog-rules";

/** Everything the storefront pages need from the catalogue. */
export interface LiveCatalog {
  products: Product[];
  categories: Category[];
  subscriptions: SubscriptionPlan[];
  flashEndsAt: Date;
}

/** True when the public Supabase env vars are set. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function localCatalog(): LiveCatalog {
  return {
    products: PRODUCTS,
    categories: CATEGORIES,
    subscriptions: SUBSCRIPTIONS,
    flashEndsAt: FLASH_DEAL_ENDS_AT,
  };
}

// Columns fetched for a storefront product, with its images and
// variants joined in the same query. product_variants.image_path is
// the variant's own photo (migration 0005).
const PRODUCT_SELECT =
  "*, product_images(storage_path, alt_text, sort_order), product_variants(name, price_override_poisha, stock, image_path)";

const CATEGORY_SELECT = "id, slug, name, sort_order, is_active";

type Supabase = ReturnType<typeof createClient>;

/** Active categories, in display order. Throws on query failure. */
async function fetchCategoryRows(supabase: Supabase): Promise<DbCategoryRow[]> {
  const { data, error } = await supabase
    .from("categories")
    .select(CATEGORY_SELECT)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Failed to load categories: ${error.message}`);
  return ((data ?? []) as unknown as DbCategoryRow[]).filter((row) => row.is_active !== false);
}

/** Active products with images and variants, oldest first. Throws on failure. */
async function fetchProductRows(supabase: Supabase): Promise<DbProductRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return (data ?? []) as unknown as DbProductRow[];
}

/**
 * Real review figures for the catalogue, aggregated from the reviews
 * table in one query and mapped by product id. The seeded
 * products.rating / review_count columns are fabricated and are
 * never read (see lib/catalog-rules.ts) — a product with no reviews
 * simply has no entry here and maps with rating 0 / review_count 0.
 * A failure here must not fail the whole catalogue: it returns an
 * empty map and the products list with zero ratings instead.
 */
async function fetchReviewStats(supabase: Supabase): Promise<Map<string, ReviewStats>> {
  try {
    const { data, error } = await supabase.from("reviews").select("product_id, rating");
    if (error || !data) return new Map();
    return aggregateReviewStats(
      (data as Array<{ product_id: string; rating: number }>).filter(
        (row) => typeof row?.product_id === "string" && Number.isFinite(row?.rating),
      ),
    );
  } catch {
    return new Map();
  }
}

/**
 * Attach the category slug to each product row, using the categories
 * table (products only carry category_id). Rows whose category is
 * missing keep category_slug unset and map to "uncategorized". The
 * extra memberships from the product_categories join table
 * (migration 0012) are attached as category_slugs, resolved to
 * slugs through the same categories map; the primary slug is
 * always first (see lib/catalog/mapping.ts categorySlugsForRow).
 * A row with no join rows gets only its primary slug.
 */
function withCategorySlugs(
  productRows: DbProductRow[],
  categoryRows: DbCategoryRow[],
  slugsByProductId: Map<string, string[]>,
): DbProductRow[] {
  const slugById = new Map<string, string>();
  for (const category of categoryRows) {
    if (category.id) slugById.set(category.id, category.slug);
  }
  return productRows.map((row) => {
    const primary = row.category_id ? (slugById.get(row.category_id) ?? null) : null;
    const extra = (row.id ? slugsByProductId.get(row.id) : undefined) ?? [];
    return {
      ...row,
      category_slug: primary,
      category_slugs: [...new Set([primary, ...extra].filter((slug): slug is string => slug !== null))],
    };
  });
}

/**
 * Extra category memberships (product_id -> category slugs) from
 * the product_categories join table (migration 0012). A failure
 * here must not fail the whole catalogue: the table does not exist
 * until migration 0012 is applied, and until then every product
 * simply shows under its primary category (plus the legacy
 * is_flash_deal flag for flash deals). Returns an empty map on
 * any failure, exactly like fetchReviewStats below.
 */
async function fetchProductCategorySlugs(
  supabase: Supabase,
  categoryRows: DbCategoryRow[],
): Promise<Map<string, string[]>> {
  try {
    const { data, error } = await supabase
      .from("product_categories")
      .select("product_id, category_id");
    if (error || !data) return new Map();
    const slugById = new Map<string, string>();
    for (const category of categoryRows) {
      if (category.id) slugById.set(category.id, category.slug);
    }
    const byProduct = new Map<string, string[]>();
    for (const row of data as Array<{ product_id: string; category_id: string }>) {
      if (typeof row?.product_id !== "string" || typeof row?.category_id !== "string") continue;
      const slug = slugById.get(row.category_id);
      if (!slug) continue;
      const list = byProduct.get(row.product_id) ?? [];
      if (!list.includes(slug)) list.push(slug);
      byProduct.set(row.product_id, list);
    }
    return byProduct;
  } catch {
    return new Map();
  }
}

/** Map fetched rows to the storefront shape (visibility rule applied). */
function toLiveCatalog(
  productRows: DbProductRow[],
  categoryRows: DbCategoryRow[],
  reviewStats: Map<string, ReviewStats>,
  slugsByProductId: Map<string, string[]>,
): LiveCatalog {
  const rows = withCategorySlugs(productRows, categoryRows, slugsByProductId);
  const publicRows = filterPublicProducts(rows);
  const products: Product[] = publicRows.map((row) =>
    mapDbProductToCatalog(row, row.id ? reviewStats.get(row.id) : undefined),
  );
  const subscriptions: SubscriptionPlan[] = products
    .filter((product) => product.category === "subscriptions")
    .map(mapDbProductToSubscription);
  return {
    products,
    categories: categoryRows.map(mapDbCategoryToCatalog),
    subscriptions,
    flashEndsAt: earliestFlashEndsAt(publicRows) ?? FLASH_DEAL_ENDS_AT,
  };
}

/**
 * The live catalogue. Throws when Supabase is not configured or a
 * query fails — getCatalog() catches that and falls back to local data.
 */
export async function getLiveCatalog(): Promise<LiveCatalog> {
  if (!isSupabaseConfigured()) throw new Error("Supabase is not configured.");
  const supabase = createClient();
  const [categoryRows, productRows, reviewStats] = await Promise.all([
    fetchCategoryRows(supabase),
    fetchProductRows(supabase),
    fetchReviewStats(supabase),
  ]);
  // The join-table read needs the categories map, so it runs after
  // the categories fetch — and it is tolerant (see
  // fetchProductCategorySlugs): a missing table is an empty map,
  // never a failed catalogue.
  const slugsByProductId = await fetchProductCategorySlugs(supabase, categoryRows);
  return toLiveCatalog(productRows, categoryRows, reviewStats, slugsByProductId);
}

/**
 * Live catalogue when available, otherwise the local seed catalogue.
 * The fallback logs a console warning only — no user-visible error
 * and no configuration detail is ever leaked.
 *
 * Per-request cached (React cache()): a product page used to fetch
 * the catalogue three times per visit — once for the product, once
 * for related products, and once more for metadata — each fetch
 * being three Supabase round trips (categories + products +
 * reviews) plus a fourth, tolerant read of the product_categories
 * join table (see fetchProductCategorySlugs — a missing table is
 * an empty map, never a failure). The
 * metadata render and the page render share one request, so they now
 * share one fetch. The cache is per-request only: the next visit
 * re-fetches, so prices and stock are never stale — force-dynamic
 * freshness is unchanged.
 */
const fetchCatalog = cache(async (): Promise<LiveCatalog> => {
  if (!isSupabaseConfigured()) return localCatalog();
  try {
    return await getLiveCatalog();
  } catch (error) {
    console.warn(
      "TechShot: live catalogue unavailable, using local catalogue.",
      error instanceof Error ? error.message : error,
    );
    return localCatalog();
  }
});

export async function getCatalog(): Promise<LiveCatalog> {
  return fetchCatalog();
}
