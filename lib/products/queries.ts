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
  created_at: string;
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
}

function toListItems(
  rows: ProductRow[],
  categoriesById: Map<string, CategoryRow>,
  imagesByProduct: Map<string, string>,
  variantsByProduct: Map<string, ProductVariantItem[]>,
): ProductListItem[] {
  return rows.map((row) => {
    const category = row.category_id ? categoriesById.get(row.category_id) : undefined;
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
      sellerId: row.seller_id,
      imagePath: imagesByProduct.get(row.id) ?? null,
      variants: variantsByProduct.get(row.id) ?? [],
      createdAt: row.created_at,
    };
  });
}

async function loadExtras(
  admin: SupabaseClient,
  productIds: string[],
): Promise<{
  imagesByProduct: Map<string, string>;
  variantsByProduct: Map<string, ProductVariantItem[]>;
}> {
  const imagesByProduct = new Map<string, string>();
  const variantsByProduct = new Map<string, ProductVariantItem[]>();
  if (productIds.length === 0) return { imagesByProduct, variantsByProduct };

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
  for (const image of (images ?? []) as Array<{ product_id: string; storage_path: string }>) {
    if (!imagesByProduct.has(image.product_id)) {
      imagesByProduct.set(image.product_id, image.storage_path);
    }
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
  return { imagesByProduct, variantsByProduct };
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
      .select("id, seller_id, category_id, title, slug, description, price_poisha, compare_at_poisha, stock, status, created_at")
      .order("created_at", { ascending: false });
    if (productsError || !productsData) return empty;

    // The categories query and the images/variants extras are
    // independent of each other — run them in parallel (they used
    // to run one after another, three serial Supabase round trips
    // before the page could render).
    const productIds = (productsData as ProductRow[]).map((row) => row.id);
    const [{ data: categoryRows }, { imagesByProduct, variantsByProduct }] = await Promise.all([
      admin.from("categories").select("id, slug, name, is_active"),
      loadExtras(admin, productIds),
    ]);
    const categoryRowsTyped = (categoryRows ?? []) as CategoryRow[];
    const categoriesById = new Map<string, CategoryRow>(categoryRowsTyped.map((row) => [row.id, row]));
    return {
      products: toListItems(productsData as ProductRow[], categoriesById, imagesByProduct, variantsByProduct),
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
