// TechShot marketplace — product server actions (staff only).
//
// Single-seller store: the owner (role "admin", granted manually in
// the database) is the only seller and manages every product in
// /admin, together with co-admins (role "co_admin") and managers
// (role "manager"). There are no seller accounts and no seller
// approval flow. Who may do what (lib/roles.ts):
//   * create / delete / upload photos — owner, co-admin, manager
//   * update / pause (edit) — owner and co-admin ONLY. A manager
//     attempting an edit gets an error, never a silent success.
//
// "use server": these run on the server only and are the enforcement
// point for product writes. The service-role client bypasses RLS, so
// every action checks the signed-in user itself, before it writes
// anything:
//
//   * Unauthenticated -> generic error.
//   * role must allow the action (see the header note): managers
//     cannot edit or pause a product, customers cannot manage
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
 * photo upload (owner, co-admin, manager); "edit" covers update /
 * pause (owner and co-admin only — a manager attempting an edit
 * gets an error, never a silent success). The role is re-read from
 * the caller's profiles row (never from the browser) via
 * getCallerRole; a missing row is treated as a customer.
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
}

export async function writeImages(
  admin: AdminClient,
  productId: string,
  imagePaths: string[],
  title: string,
): Promise<void> {
  // One product_images row per photo, sort_order 0, 1, 2, … — the
  // first is the main photo and the gallery shows the rest in this
  // order. Empty entries are dropped; duplicates were already
  // removed by mergeImagePaths.
  const paths = imagePaths.map((path) => path.trim()).filter((path) => path !== "");
  if (paths.length === 0) return;
  try {
    await admin.from("product_images").insert(
      paths.map((storage_path, index) => ({
        product_id: productId,
        storage_path,
        alt_text: title,
        sort_order: index,
      })),
    );
  } catch {
    // A failed image row must not fail the product write.
  }
}

export async function writeVariants(admin: AdminClient, productId: string, variants: ProductInput["variants"]): Promise<void> {
  if (variants.length === 0) return;
  try {
    await admin.from("product_variants").insert(
      variants.map((variant) => ({
        product_id: productId,
        name: variant.name,
        price_override_poisha: variant.priceTaka === undefined ? null : takaToPoisha(variant.priceTaka),
        stock: variant.stock,
        image_path: variant.imagePath ? variant.imagePath : null,
      })),
    );
  } catch {
    // A failed variant row must not fail the product write.
  }
}
