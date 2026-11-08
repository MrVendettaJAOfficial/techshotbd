// TechShot marketplace — product server actions (admin only).
//
// Single-seller store: the owner (role "admin", granted manually in
// the database) is the only seller and manages every product in
// /admin. There are no seller accounts and no seller approval flow.
//
// "use server": these run on the server only and are the enforcement
// point for product writes. The service-role client bypasses RLS, so
// every action checks the signed-in user itself, before it writes
// anything:
//
//   * Unauthenticated -> generic error.
//   * role must be "admin" (customers cannot manage products).
//   * Every product is store-owned: seller_id is always null on
//     create, and updates never change it.
//
// Errors returned to the client are generic on purpose: never a stack
// trace, SQL, or table name, and never which environment variable is
// missing when Supabase is not configured.

"use server";

import { revalidatePath } from "next/cache";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth-server";

import type { AppUser } from "@/lib/auth";
import type { ProductActionResult } from "./types";
import { dedupeSlug, productInputSchema, productStatusSchema, slugify, takaToPoisha, type ProductInput } from "./validation";

const GENERIC_ERROR = "Something went wrong. Please try again.";
const NOT_SIGNED_IN = "You must be signed in to manage products.";
const NO_PERMISSION = "You do not have permission to manage this product.";

type AdminClient = SupabaseClient;

/**
 * The Supabase Database generic resolves query results to `never`
 * with the installed supabase-js version (lib/supabase/catalog.ts
 * works around the same issue with `as unknown` casts), so this file
 * talks to the untyped client. Runtime behaviour is unchanged.
 */
function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

interface Actor {
  user: AppUser;
}

async function requireAdmin(): Promise<Actor | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: NOT_SIGNED_IN };
  if (user.role !== "admin") return { error: NO_PERMISSION };
  return { user };
}

function adminClient(): AdminClient | null {
  try {
    return untyped(createAdminClient());
  } catch {
    // Service role not configured: generic error, never say which
    // environment variable is missing.
    return null;
  }
}

/** Unique slug for a title, excluding `excludeId` (on update). */
async function uniqueSlug(admin: AdminClient, title: string, excludeId?: string): Promise<string> {
  const base = slugify(title);
  const { data } = await admin.from("products").select("id, slug").like("slug", `${base}%`);
  const taken = (data ?? []).filter((row) => row.id !== excludeId).map((row) => row.slug);
  return dedupeSlug(base, taken);
}

async function loadCategory(admin: AdminClient, slug: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await admin.from("categories").select("id, name").eq("slug", slug).maybeSingle();
  if (error || !data) return null;
  return { id: data.id, name: data.name };
}

async function writeAudit(admin: AdminClient, actorId: string, action: string, entityId: string): Promise<void> {
  try {
    await admin.from("audit_log").insert({
      actor_id: actorId,
      action,
      entity_type: "product",
      entity_id: entityId,
    });
  } catch {
    // Audit failure must not fail the product write or leak details.
  }
}

function revalidateProductPages(slug: string, oldSlug?: string): void {
  revalidatePath("/");
  revalidatePath("/shop");
  revalidatePath(`/product/${slug}`);
  if (oldSlug && oldSlug !== slug) revalidatePath(`/product/${oldSlug}`);
}

async function writeImages(admin: AdminClient, productId: string, imagePath: string, title: string): Promise<void> {
  if (!imagePath) return;
  try {
    await admin.from("product_images").insert({
      product_id: productId,
      storage_path: imagePath,
      alt_text: title,
      sort_order: 0,
    });
  } catch {
    // A failed image row must not fail the product write.
  }
}

async function writeVariants(admin: AdminClient, productId: string, variants: ProductInput["variants"]): Promise<void> {
  if (variants.length === 0) return;
  try {
    await admin.from("product_variants").insert(
      variants.map((variant) => ({
        product_id: productId,
        name: variant.name,
        price_override_poisha: variant.priceTaka === undefined ? null : takaToPoisha(variant.priceTaka),
        stock: variant.stock,
      })),
    );
  } catch {
    // A failed variant row must not fail the product write.
  }
}

/** Create a product. All products are store-owned (seller_id null). */
export async function createProduct(rawInput: unknown): Promise<ProductActionResult> {
  const parsed = productInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }
  const input = parsed.data;

  const actor = await requireAdmin();
  if ("error" in actor) return { ok: false, error: actor.error };
  const { user } = actor;

  const admin = adminClient();
  if (!admin) return { ok: false, error: GENERIC_ERROR };

  const category = await loadCategory(admin, input.categorySlug);
  if (!category) return { ok: false, error: "Please choose a valid category." };

  const slug = await uniqueSlug(admin, input.title);
  const searchText = [input.title, input.description, category.name].join(" ").toLowerCase().slice(0, 1000);

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
      search_text: searchText,
    })
    .select("id, slug")
    .single();
  if (error || !data) return { ok: false, error: GENERIC_ERROR };

  await writeImages(admin, data.id, input.imagePath, input.title);
  await writeVariants(admin, data.id, input.variants);
  await writeAudit(admin, user.id, "product.create", data.id);

  revalidateProductPages(data.slug);
  return { ok: true, slug: data.slug };
}

/** Update a product (admin only). */
export async function updateProduct(id: string, rawInput: unknown): Promise<ProductActionResult> {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }
  const parsed = productInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }
  const input = parsed.data;

  const actor = await requireAdmin();
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

  const slug = existing.title === input.title ? existing.slug : await uniqueSlug(admin, input.title, existing.id);
  const searchText = [input.title, input.description, category.name].join(" ").toLowerCase().slice(0, 1000);

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
      search_text: searchText,
    })
    .eq("id", existing.id);
  if (error) return { ok: false, error: GENERIC_ERROR };

  await admin.from("product_images").delete().eq("product_id", existing.id);
  await writeImages(admin, existing.id, input.imagePath, input.title);
  await admin.from("product_variants").delete().eq("product_id", existing.id);
  await writeVariants(admin, existing.id, input.variants);
  await writeAudit(admin, user.id, "product.update", existing.id);

  revalidateProductPages(slug, existing.slug);
  return { ok: true, slug };
}

/** Pause (hide from shoppers) or re-activate a product. */
export async function setProductStatus(id: string, rawStatus: unknown): Promise<ProductActionResult> {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }
  const parsed = productStatusSchema.safeParse(rawStatus);
  if (!parsed.success) {
    return { ok: false, error: "Please choose a valid status." };
  }
  const status = parsed.data;

  const actor = await requireAdmin();
  if ("error" in actor) return { ok: false, error: actor.error };
  const { user } = actor;

  const admin = adminClient();
  if (!admin) return { ok: false, error: GENERIC_ERROR };

  const { data: existing, error: loadError } = await admin
    .from("products")
    .select("id, slug")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !existing) {
    return { ok: false, error: "Product not found." };
  }

  const { error } = await admin.from("products").update({ status }).eq("id", existing.id);
  if (error) return { ok: false, error: GENERIC_ERROR };
  await writeAudit(admin, user.id, "product.status", existing.id);

  revalidateProductPages(existing.slug);
  return { ok: true, slug: existing.slug };
}

/** Delete a product (images and variants cascade in the database). */
export async function deleteProduct(id: string): Promise<ProductActionResult> {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }

  const actor = await requireAdmin();
  if ("error" in actor) return { ok: false, error: actor.error };
  const { user } = actor;

  const admin = adminClient();
  if (!admin) return { ok: false, error: GENERIC_ERROR };

  const { data: existing, error: loadError } = await admin
    .from("products")
    .select("id, slug")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !existing) {
    return { ok: false, error: "Product not found." };
  }

  const { error } = await admin.from("products").delete().eq("id", existing.id);
  if (error) return { ok: false, error: GENERIC_ERROR };
  await writeAudit(admin, user.id, "product.delete", existing.id);

  revalidateProductPages(existing.slug);
  return { ok: true, slug: existing.slug };
}
