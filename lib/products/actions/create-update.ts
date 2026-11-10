// TechShot marketplace — create / update product server actions.
//
// Staff only; update is any staff role (owner / co-admin /
// manager — 2026-11-10 decision: managers CAN edit) — see the
// staff gate in lib/products/actions/shared.ts. All products are
// store-owned (seller_id always null).
//
// Multi-category (migration 0012): the form sends every selected
// category in `categorySlugs`, primary first. The primary stays on
// products.category_id; the REST go into the product_categories
// join table (writeCategories in ./shared.ts). A product with no
// join rows still shows under its primary category, so old data
// keeps working.

"use server";

import type { ProductActionResult } from "../types";
import { mergeImagePaths, productInputSchema, takaToPoisha } from "../validation";
import {
  GENERIC_ERROR,
  adminClient,
  loadCategoriesBySlugs,
  loadCategory,
  requireStaff,
  revalidateProductPages,
  uniqueSlug,
  writeAudit,
  writeCategories,
  writeImages,
  writeVariants,
} from "./shared";

/** The extra categories for a save: the full selection minus the primary. */
function extraCategoryIds(
  selected: Array<{ id: string; slug: string; name: string }>,
  primarySlug: string,
): string[] {
  return selected.filter((category) => category.slug !== primarySlug).map((category) => category.id);
}

/** Create a product. All products are store-owned (seller_id null). Staff with the manage gate (owner / co-admin / manager). */
export async function createProduct(rawInput: unknown): Promise<ProductActionResult> {
  const parsed = productInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }
  const input = parsed.data;

  const actor = await requireStaff("manage");
  if ("error" in actor) return { ok: false, error: actor.error };
  const { user } = actor;

  const admin = adminClient();
  if (!admin) return { ok: false, error: GENERIC_ERROR };

  const category = await loadCategory(admin, input.categorySlug);
  if (!category) return { ok: false, error: "Please choose a valid category." };
  const extraCategories = await loadCategoriesBySlugs(admin, input.categorySlugs ?? []);

  const slug = await uniqueSlug(admin, input.title);
  const searchText = [input.title, input.description, category.name, ...extraCategories.map((c) => c.name)]
    .join(" ")
    .toLowerCase()
    .slice(0, 1000);

  const { data, error } = await admin
    .from("products")
    .insert({
      seller_id: null,
      category_id: category.id,
      title: input.title,
      slug,
      description: input.description || null,
      price_poisha: takaToPoisha(input.priceTaka),
      compare_at_poisha: input.compareAtTaka === undefined || input.compareAtTaka === null ? null : takaToPoisha(input.compareAtTaka),
      stock: input.stock,
      status: input.status,
      warranty: input.warranty === "" ? null : input.warranty,
      specifications: input.specifications,
      search_text: searchText,
    })
    .select("id, slug")
    .single();
  if (error || !data) return { ok: false, error: GENERIC_ERROR };

  await writeImages(admin, data.id, mergeImagePaths(input), input.title);
  await writeVariants(admin, data.id, input.variants);
  await writeCategories(admin, data.id, extraCategoryIds(extraCategories, input.categorySlug));
  await writeAudit(admin, user.id, "product.create", data.id);

  revalidateProductPages(data.slug);
  return { ok: true, slug: data.slug };
}

/** Update a product (any staff role — owner, co-admin, manager). Warranty and specifications are saved here too, so they share the same edit gate. */
export async function updateProduct(id: string, rawInput: unknown): Promise<ProductActionResult> {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }
  const parsed = productInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }
  const input = parsed.data;

  const actor = await requireStaff("edit");
  if ("error" in actor) return { ok: false, error: actor.error };
  const { user } = actor;

  const admin = adminClient();
  if (!admin) return { ok: false, error: GENERIC_ERROR };

  const { data: existing, error: loadError } = await admin
    .from("products")
    .select("id, slug, title")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !existing) {
    return { ok: false, error: "Product not found." };
  }

  const category = await loadCategory(admin, input.categorySlug);
  if (!category) return { ok: false, error: "Please choose a valid category." };
  const extraCategories = await loadCategoriesBySlugs(admin, input.categorySlugs ?? []);

  const slug = existing.title === input.title ? existing.slug : await uniqueSlug(admin, input.title, existing.id);
  const searchText = [input.title, input.description, category.name, ...extraCategories.map((c) => c.name)]
    .join(" ")
    .toLowerCase()
    .slice(0, 1000);

  const { error } = await admin
    .from("products")
    .update({
      category_id: category.id,
      title: input.title,
      slug,
      description: input.description || null,
      price_poisha: takaToPoisha(input.priceTaka),
      compare_at_poisha: input.compareAtTaka === undefined || input.compareAtTaka === null ? null : takaToPoisha(input.compareAtTaka),
      stock: input.stock,
      status: input.status,
      warranty: input.warranty === "" ? null : input.warranty,
      specifications: input.specifications,
      search_text: searchText,
    })
    .eq("id", existing.id);
  if (error) return { ok: false, error: GENERIC_ERROR };

  await admin.from("product_images").delete().eq("product_id", existing.id);
  await writeImages(admin, existing.id, mergeImagePaths(input), input.title);
  await admin.from("product_variants").delete().eq("product_id", existing.id);
  await writeVariants(admin, existing.id, input.variants);
  await writeCategories(admin, existing.id, extraCategoryIds(extraCategories, input.categorySlug));
  await writeAudit(admin, user.id, "product.update", existing.id);

  revalidateProductPages(slug, existing.slug);
  return { ok: true, slug };
}
