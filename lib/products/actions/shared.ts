// TechShot marketplace — product server actions (staff only).
//
// Single-seller store: the owner (role "admin", granted manually in
// the database) is the only seller and manages every product in
// /admin, together with co-admins (role "co_admin") and managers
// (role "manager"). There are no seller accounts and no seller
// approval flow. Who may do what (lib/roles.ts):
//   * create / delete / upload photos — owner, co-admin, manager
//   * update / pause (edit) — owner, co-admin, manager (2026-11-10:
//     managers CAN edit products too, including pausing them).
//     The database enforces the same rule once migration 0010 is
//     applied; until then the old RLS policy stops a manager's
//     edit and the action returns a generic error, never a crash.
//
// "use server": these run on the server only and are the enforcement
// point for product writes. The service-role client bypasses RLS, so
// every action checks the signed-in user itself, before it writes
// anything:
//
//   * Unauthenticated -> generic error.
//   * role must allow the action (see the header note): managers
//     may edit or pause a product, customers cannot manage
//     products at all.
//   * Every product is store-owned: seller_id is always null on
//     create, and updates never change it.
//
// Errors returned to the client are generic on purpose: never a stack
// trace, SQL, or table name, and never which environment variable is
// missing when Supabase is not configured.

//
// Shared helpers for the product server actions (see
// lib/products/actions/upload.ts, create-update.ts and
// manage.ts). Not a barrel export: these are internal to
// the actions, which is why this file is imported by the
// action files, not re-exported from lib/products/actions.ts.

import { revalidatePath } from "next/cache";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/server";
import { revalidateCatalogCache } from "@/lib/storefront-cache";
import { getCallerRole, getCurrentUser } from "@/lib/auth-server";
import { canEditProducts, canManageProducts } from "@/lib/roles";

import type { AppUser } from "@/lib/auth";
import {
  dedupeSlug,
  slugify,
  takaToPoisha,
  type ProductInput,
} from "../validation";

export const GENERIC_ERROR = "Something went wrong. Please try again.";
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

/**
 * Staff gate for product writes. "manage" covers create / delete /
 * photo upload and "edit" covers update / pause; both are any
 * staff role (owner, co-admin, manager — 2026-11-10 decision).
 * The role is re-read from the caller's profiles row (never from
 * the browser) via getCallerRole; a missing row is treated as a
 * customer.
 */
export async function requireStaff(
  action: "manage" | "edit",
): Promise<Actor | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: NOT_SIGNED_IN };
  const role = (await getCallerRole()) ?? user.role;
  const allowed = action === "edit" ? canEditProducts(role) : canManageProducts(role);
  if (!allowed) return { error: NO_PERMISSION };
  return { user };
}

export function adminClient(): AdminClient | null {
  try {
    return untyped(createAdminClient());
  } catch {
    // Service role not configured: generic error, never say which
    // environment variable is missing.
    return null;
  }
}

/** Unique slug for a title, excluding `excludeId` (on update). */
export async function uniqueSlug(admin: AdminClient, title: string, excludeId?: string): Promise<string> {
  const base = slugify(title);
  const { data } = await admin.from("products").select("id, slug").like("slug", `${base}%`);
  const taken = (data ?? []).filter((row) => row.id !== excludeId).map((row) => row.slug);
  return dedupeSlug(base, taken);
}

export async function loadCategory(admin: AdminClient, slug: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await admin.from("categories").select("id, name").eq("slug", slug).maybeSingle();
  if (error || !data) return null;
  return { id: data.id, name: data.name };
}

/**
 * Load several categories by slug (for the multi-category form):
 * every slug that matches a row comes back, in the order the
 * caller asked for; unknown slugs are dropped silently, so a
 * stale or mistyped extra category can never break a save. The
 * primary category is loaded separately by loadCategory above.
 */
export async function loadCategoriesBySlugs(
  admin: AdminClient,
  slugs: string[],
): Promise<Array<{ id: string; slug: string; name: string }>> {
  const wanted = [...new Set(slugs.map((slug) => slug.trim()).filter((slug) => slug !== ""))];
  if (wanted.length === 0) return [];
  const { data, error } = await admin.from("categories").select("id, slug, name").in("slug", wanted);
  if (error || !data) return [];
  const bySlug = new Map<string, { id: string; slug: string; name: string }>(
    (data as Array<{ id: string; slug: string; name: string }>).map((row) => [row.slug, row]),
  );
  return wanted
    .map((slug) => bySlug.get(slug))
    .filter((row): row is { id: string; slug: string; name: string } => !!row);
}

/**
 * Sync a product's extra category memberships (product_categories
 * join table, migration 0012): delete the product's current rows,
 * then insert one row per category id. The primary category is
 * stored on products.category_id, NOT here — callers pass only
 * the extra categories (primary first is restored by the mapper:
 * categorySlugsForRow always puts the primary slug first).
 *
 * Returns false when the sync fails — a failed delete, a failed
 * insert, or a thrown error — so the caller (createProduct /
 * updateProduct) can report the save as failed instead of
 * claiming success with the memberships silently lost (audit
 * run-1, finding #12). The delete runs first because the table's
 * primary key is (product_id, category_id) (migration 0012): the
 * new rows cannot be inserted before the stale ones are gone.
 * Like writeImages / writeVariants, a failure here means the
 * caller returns { ok: false }; migration 0012 is applied live,
 * so a missing table is a failure now, not a silent skip.
 */
export async function writeCategories(
  admin: AdminClient,
  productId: string,
  categoryIds: string[],
): Promise<boolean> {
  try {
    const { error: deleteError } = await admin
      .from("product_categories")
      .delete()
      .eq("product_id", productId);
    if (deleteError) return false;
    const ids = [...new Set(categoryIds)];
    if (ids.length === 0) return true;
    const { error } = await admin
      .from("product_categories")
      .insert(ids.map((category_id) => ({ product_id: productId, category_id })));
    return !error;
  } catch {
    // A thrown write error is a failed save too: report it,
    // never swallow it.
    return false;
  }
}

export async function writeAudit(admin: AdminClient, actorId: string, action: string, entityId: string): Promise<void> {
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

export function revalidateProductPages(slug: string, oldSlug?: string): void {
  revalidatePath("/");
  revalidatePath("/shop");
  revalidatePath(`/product/${slug}`);
  if (oldSlug && oldSlug !== slug) revalidatePath(`/product/${oldSlug}`);
  // The catalogue data cache (tag "catalog", lib/storefront-cache.ts)
  // holds the same pages' data: without this purge, a price / title
  // / pause change would sit in the cache until the next product /
  // order / banner write purged the tag, or the catalogue's
  // 60-second revalidate expired (see lib/supabase/catalog.ts).
  revalidateCatalogCache();
}

export async function writeImages(
  admin: AdminClient,
  productId: string,
  imagePaths: string[],
  title: string,
): Promise<boolean> {
  // One product_images row per photo, sort_order 0, 1, 2, … — the
  // first is the main photo and the gallery shows the rest in this
  // order. Empty entries are dropped; duplicates were already
  // removed by mergeImagePaths.
  //
  // Returns false when the insert fails — a returned { error }
  // from Supabase, or a thrown error — so the caller can report
  // the save as failed instead of claiming success with the photos
  // silently lost (audit run-1, finding #12). The stale rows are
  // deleted by the caller before this runs, because the table's
  // unique (product_id, storage_path) constraint (migration 0001)
  // forbids inserting the new rows first: a photo the product
  // already has would violate it.
  const paths = imagePaths.map((path) => path.trim()).filter((path) => path !== "");
  if (paths.length === 0) return true;
  try {
    const { error } = await admin.from("product_images").insert(
      paths.map((storage_path, index) => ({
        product_id: productId,
        storage_path,
        alt_text: title,
        sort_order: index,
      })),
    );
    return !error;
  } catch {
    // A thrown insert error is a failed save too: report it,
    // never swallow it.
    return false;
  }
}

export async function writeVariants(admin: AdminClient, productId: string, variants: ProductInput["variants"]): Promise<boolean> {
  // Returns false when the insert fails — a returned { error }
  // from Supabase, or a thrown error — so the caller can report
  // the save as failed instead of claiming success with the
  // variants silently lost (audit run-1, finding #12). The stale
  // rows are deleted by the caller before this runs: variants have
  // no stable identity to tell a stale row from a new one, so the
  // new rows cannot be inserted first and the old ones deleted
  // after.
  if (variants.length === 0) return true;
  try {
    const { error } = await admin.from("product_variants").insert(
      variants.map((variant) => ({
        product_id: productId,
        name: variant.name,
        price_override_poisha: variant.priceTaka === undefined ? null : takaToPoisha(variant.priceTaka),
        stock: variant.stock,
        image_path: variant.imagePath ? variant.imagePath : null,
      })),
    );
    return !error;
  } catch {
    // A thrown insert error is a failed save too: report it,
    // never swallow it.
    return false;
  }
}
