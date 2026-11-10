// TechShot marketplace — server-side product reads for the admin
// dashboard (single-seller store: the owner manages every product
// in /admin; there is no seller dashboard any more).
//
// SERVER ONLY. The admin fetch uses the service-role client (it must
// list draft / paused products too). Neither function throws: on any
// failure (including Supabase not being configured) it returns empty
// lists with configured: false, and the page shows a plain notice
// instead of leaking configuration details.
//
// NOTE: the Supabase Database generic resolves query results to
// `never` with the installed supabase-js version (lib/supabase/
// catalog.ts works around the same issue with `as unknown` casts),
// so this file talks to the untyped client and casts rows to the
// local interfaces below. Runtime behaviour is unchanged.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient, createClient } from "@/lib/supabase/server";

import type { CategoryOption, ProductListItem, ProductVariantItem } from "./types";
import { poishaToTaka } from "./validation";

export interface ProductQueryResult {
  products: ProductListItem[];
  categories: CategoryOption[];
  /** False when Supabase is not configured or the read failed. */
  configured: boolean;
}

export interface AdminUserItem {
  id: string;
  displayName: string;
  role: string;
  createdAt: string;
}

function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

interface ProductRow {
  id: string;
  seller_id: string | null;
  category_id: string | null;
  title: string;
  slug: string;
  description: string | null;
  price_poisha: number;
  compare_at_poisha: number | null;
  stock: number;
  status: string;
  warranty: string | null;
  specifications: unknown;
  created_at: string;
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
}

/** Parse the products.specifications jsonb column defensively: only
 *  { key, value } string pairs survive; anything else is dropped. */
function toSpecificationItems(value: unknown): Array<{ key: string; value: string }> {
  if (!Array.isArray(value)) return [];
  const items: Array<{ key: string; value: string }> = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as { key?: unknown }).key === "string" &&
      typeof (entry as { value?: unknown }).value === "string"
    ) {
      items.push({
        key: ((entry as { key: string }).key ?? "").trim(),
        value: ((entry as { value: string }).value ?? "").trim(),
      });
    }
  }
  return items.filter((item) => item.key !== "");
}

function toListItems(
  rows: ProductRow[],
  categoriesById: Map<string, CategoryRow>,
  imagesByProduct: Map<string, string[]>,
  variantsByProduct: Map<string, ProductVariantItem[]>,
  categoriesByProduct: Map<string, string[]>,
): ProductListItem[] {
  const nameBySlug = new Map<string, string>();
  for (const category of categoriesById.values()) {
    nameBySlug.set(category.slug, category.name);
  }
  return rows.map((row) => {
    const category = row.category_id ? categoriesById.get(row.category_id) : undefined;
    const imagePaths = imagesByProduct.get(row.id) ?? [];
    // Primary first, then the extra memberships from the join
    // table, deduplicated — a product with no join rows has only
    // its primary category here.
    const categorySlugs = [
      ...new Set(
        [category?.slug, ...(categoriesByProduct.get(row.id) ?? [])].filter(
          (slug): slug is string => typeof slug === "string" && slug !== "",
        ),
      ),
    ];
    const categoryNames = categorySlugs.map((slug) => nameBySlug.get(slug) ?? slug);
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description ?? "",
      pricePoisha: row.price_poisha,
      compareAtPoisha: row.compare_at_poisha,
      stock: row.stock,
      status: row.status === "active" || row.status === "paused" || row.status === "draft" ? row.status : "draft",
      categorySlug: category?.slug ?? null,
      categoryName: category?.name ?? "General",
      categorySlugs,
      categoryNames,
      sellerId: row.seller_id,
      imagePath: imagePaths[0] ?? null,
      imagePaths,
      variants: variantsByProduct.get(row.id) ?? [],
      warranty: row.warranty ?? null,
      specifications: toSpecificationItems(row.specifications),
      createdAt: row.created_at,
    };
  });
}

async function loadExtras(
  admin: SupabaseClient,
  productIds: string[],
): Promise<{
  imagesByProduct: Map<string, string[]>;
  variantsByProduct: Map<string, ProductVariantItem[]>;
  /** Extra category ids per product, from the product_categories
   *  join table (migration 0012). Empty when the table does not
   *  exist yet — the product then shows under its primary category
   *  only (see toListItems), so a missing migration never fails
   *  the admin list. */
  categoriesByProduct: Map<string, string[]>;
}> {
  const imagesByProduct = new Map<string, string[]>();
  const variantsByProduct = new Map<string, ProductVariantItem[]>();
  const categoriesByProduct = new Map<string, string[]>();
  if (productIds.length === 0) return { imagesByProduct, variantsByProduct, categoriesByProduct };

  // Images and variants are independent queries — run them in
  // parallel instead of one after another.
  const [{ data: images }, { data: variants }] = await Promise.all([
    admin
      .from("product_images")
      .select("product_id, storage_path, sort_order")
      .in("product_id", productIds)
      .order("sort_order", { ascending: true }),
    admin
      .from("product_variants")
      .select("product_id, name, price_override_poisha, stock, image_path")
      .in("product_id", productIds),
  ]);
  // Every photo per product, in sort_order — the first is the main
  // photo; the admin form edits the whole list.
  for (const image of (images ?? []) as Array<{ product_id: string; storage_path: string }>) {
    const list = imagesByProduct.get(image.product_id) ?? [];
    list.push(image.storage_path);
    imagesByProduct.set(image.product_id, list);
  }

  for (const variant of (variants ?? []) as Array<{
    product_id: string;
    name: string;
    price_override_poisha: number | null;
    stock: number;
    image_path: string | null;
  }>) {
    const list = variantsByProduct.get(variant.product_id) ?? [];
    list.push({
      name: variant.name,
      priceTaka: variant.price_override_poisha === null ? null : poishaToTaka(variant.price_override_poisha),
      stock: variant.stock,
      imagePath: variant.image_path ?? null,
    });
    variantsByProduct.set(variant.product_id, list);
  }

  // Extra category memberships (migration 0012). Tolerant: the
  // table does not exist until the migration is applied, and a
  // missing table must not fail the admin list — an empty map
  // means "primary category only" for every product.
  try {
    const { data: memberships } = await admin
      .from("product_categories")
      .select("product_id, category_id")
      .in("product_id", productIds);
    for (const row of (memberships ?? []) as Array<{
      product_id: string;
      category_id: string;
    }>) {
      const list = categoriesByProduct.get(row.product_id) ?? [];
      if (!list.includes(row.category_id)) list.push(row.category_id);
      categoriesByProduct.set(row.product_id, list);
    }
  } catch {
    // No join table yet: every product keeps its primary only.
  }
  return { imagesByProduct, variantsByProduct, categoriesByProduct };
}

/** Live categories for the product form (active categories only). */
export async function fetchCategories(): Promise<{ categories: CategoryOption[]; configured: boolean }> {
  try {
    const supabase = untyped(createClient());
    const { data, error } = await supabase
      .from("categories")
      .select("id, slug, name, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error || !data) return { categories: [], configured: false };
    return {
      categories: (data as CategoryRow[]).map((row) => ({ slug: row.slug, name: row.name })),
      configured: true,
    };
  } catch {
    return { categories: [], configured: false };
  }
}

/** Every product (all statuses), newest first. Admin only. */
export async function fetchAllProducts(): Promise<ProductQueryResult> {
  const empty: ProductQueryResult = { products: [], categories: [], configured: false };
  try {
    const admin = untyped(createAdminClient());
    const { data: productsData, error: productsError } = await admin
      .from("products")
      .select("id, seller_id, category_id, title, slug, description, price_poisha, compare_at_poisha, stock, status, warranty, specifications, created_at")
      .order("created_at", { ascending: false });
    if (productsError || !productsData) return empty;

    // The categories query and the images/variants extras are
    // independent of each other — run them in parallel (they used
    // to run one after another, three serial Supabase round trips
    // before the page could render).
    const productIds = (productsData as ProductRow[]).map((row) => row.id);
    const [{ data: categoryRows }, { imagesByProduct, variantsByProduct, categoriesByProduct }] = await Promise.all([
      admin.from("categories").select("id, slug, name, is_active"),
      loadExtras(admin, productIds),
    ]);
    const categoryRowsTyped = (categoryRows ?? []) as CategoryRow[];
    const categoriesById = new Map<string, CategoryRow>(categoryRowsTyped.map((row) => [row.id, row]));
    // The join table carries category ids; the list items carry
    // slugs — resolve here, dropping ids with no category row.
    const categorySlugsByProduct = new Map<string, string[]>();
    for (const [productId, categoryIds] of categoriesByProduct) {
      const slugs = categoryIds
        .map((id) => categoriesById.get(id)?.slug)
        .filter((slug): slug is string => typeof slug === "string" && slug !== "");
      if (slugs.length > 0) categorySlugsByProduct.set(productId, slugs);
    }
    return {
      products: toListItems(productsData as ProductRow[], categoriesById, imagesByProduct, variantsByProduct, categorySlugsByProduct),
      categories: categoryRowsTyped
        .filter((row) => row.is_active)
        .map((row) => ({ slug: row.slug, name: row.name })),
      configured: true,
    };
  } catch {
    return empty;
  }
}

/**
 * Every registered user (profiles rows), newest first. Admin only.
 * Emails are not stored in profiles, so the display name is shown
 * with the account id; the auth worker owns any richer user admin.
 */
export async function fetchAdminUsers(): Promise<{ users: AdminUserItem[]; configured: boolean }> {
  try {
    const admin = untyped(createAdminClient());
    const { data, error } = await admin
      .from("profiles")
      .select("id, display_name, role, created_at")
      .order("created_at", { ascending: false });
    if (error || !data) return { users: [], configured: false };
    return {
      users: (data as Array<{ id: string; display_name: string | null; role: string; created_at: string }>).map(
        (row) => ({
          id: row.id,
          displayName: row.display_name ?? "TechShot user",
          role: row.role,
          createdAt: row.created_at,
        }),
      ),
      configured: true,
    };
  } catch {
    return { users: [], configured: false };
  }
}
