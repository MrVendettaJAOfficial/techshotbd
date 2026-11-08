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

import { createClient } from "./server";
import {
  CATEGORIES,
  FLASH_DEAL_ENDS_AT,
  PRODUCTS,
  SUBSCRIPTIONS,
} from "../data/catalog";
import type { Category, Product, SubscriptionPlan } from "../data/catalog";
import {
  earliestFlashEndsAt,
  filterPublicProducts,
  mapDbCategoryToCatalog,
  mapDbProductToCatalog,
  mapDbProductToSubscription,
  relatedProducts,
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
// variants joined in the same query.
const PRODUCT_SELECT =
  "*, product_images(storage_path, alt_text, sort_order), product_variants(name, price_override_poisha, stock)";

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
 * Attach the category slug to each product row, using the categories
 * table (products only carry category_id). Rows whose category is
 * missing keep category_slug unset and map to "uncategorized".
 */
function withCategorySlugs(
  productRows: DbProductRow[],
  categoryRows: DbCategoryRow[],
): DbProductRow[] {
  const slugById = new Map<string, string>();
  for (const category of categoryRows) {
    if (category.id) slugById.set(category.id, category.slug);
  }
  return productRows.map((row) => ({
    ...row,
    category_slug: row.category_id ? (slugById.get(row.category_id) ?? null) : null,
  }));
}

/** Map fetched rows to the storefront shape (visibility rule applied). */
function toLiveCatalog(
  productRows: DbProductRow[],
  categoryRows: DbCategoryRow[],
): LiveCatalog {
  const rows = withCategorySlugs(productRows, categoryRows);
  const publicRows = filterPublicProducts(rows);
  const products: Product[] = publicRows.map(mapDbProductToCatalog);
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
  const [categoryRows, productRows] = await Promise.all([
    fetchCategoryRows(supabase),
    fetchProductRows(supabase),
  ]);
  return toLiveCatalog(productRows, categoryRows);
}

/**
 * Live catalogue when available, otherwise the local seed catalogue.
 * The fallback logs a console warning only — no user-visible error
 * and no configuration detail is ever leaked.
 */
export async function getCatalog(): Promise<LiveCatalog> {
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
}

/**
 * One live product by slug. Returns undefined when there is no such
 * product or it is not active (paused / draft products are hidden).
 * Throws when Supabase is not configured or the query fails — callers
 * that want a local fallback should catch and use getProduct() instead.
 *
 * Slug rule: the exact slug is tried first, then the `<slug>-…` prefix
 * — the live database uses longer slugs than the seed catalogue for
 * some products (live `apple-iphone-16-pro-256gb-natural-titanium` vs
 * seed `apple-iphone-16-pro`), so a link using the shorter seed slug
 * still resolves to the live product instead of 404ing. This is the
 * same rule the cart and order code uses (see lib/cart-server.ts).
 */
export async function getLiveProduct(slug: string): Promise<Product | undefined> {
  if (!isSupabaseConfigured()) throw new Error("Supabase is not configured.");
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`Failed to load product: ${error.message}`);
  let row = (data ?? null) as unknown as DbProductRow | null;
  if (!row) {
    const prefixed = await supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .like("slug", `${slug}-%`)
      .eq("status", "active")
      .order("slug")
      .limit(1)
      .maybeSingle();
    if (prefixed.error) {
      throw new Error(`Failed to load product: ${prefixed.error.message}`);
    }
    row = (prefixed.data ?? null) as unknown as DbProductRow | null;
  }
  if (!row) return undefined;
  const categoryRows = await fetchCategoryRows(supabase);
  return mapDbProductToCatalog(withCategorySlugs([row], categoryRows)[0] as DbProductRow);
}

/**
 * Related live products for a detail page: same-category active
 * products first, then other active products. Throws when Supabase is
 * not configured or the query fails — callers that want a local
 * fallback should catch and use getRelated() instead.
 */
export async function getLiveRelated(product: Product, n: number): Promise<Product[]> {
  if (!isSupabaseConfigured()) throw new Error("Supabase is not configured.");
  const supabase = createClient();
  const [categoryRows, productRows] = await Promise.all([
    fetchCategoryRows(supabase),
    fetchProductRows(supabase),
  ]);
  const rows = withCategorySlugs(productRows, categoryRows);
  const products: Product[] = filterPublicProducts(rows).map(mapDbProductToCatalog);
  return relatedProducts(products, product, n);
}
