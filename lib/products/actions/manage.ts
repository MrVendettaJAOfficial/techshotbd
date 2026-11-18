// TechShot marketplace — pause / activate / delete product actions.
//
// Pause (hide from shoppers) or re-activate a product, and
// delete a product. Any staff role may pause; any staff role
// may delete — see the staff gate in
// lib/products/actions/shared.ts.

"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProductActionResult } from "../types";
import { PRODUCT_IMAGES_BUCKET } from "../../storage-images";
import { productStatusSchema } from "../validation";
import {
  GENERIC_ERROR,
  adminClient,
  requireStaff,
  revalidateProductPages,
  writeAudit,
} from "./shared";

/** Pause (hide from shoppers) or re-activate a product. Any staff role (owner, co-admin, manager). */
export async function setProductStatus(id: string, rawStatus: unknown): Promise<ProductActionResult> {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }
  const parsed = productStatusSchema.safeParse(rawStatus);
  if (!parsed.success) {
    return { ok: false, error: "Please choose a valid status." };
  }
  const status = parsed.data;

  const actor = await requireStaff("edit");
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

/** Delete a product (images and variants cascade in the database). Owner / co-admin / manager. */
export async function deleteProduct(id: string): Promise<ProductActionResult> {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }

  const actor = await requireStaff("manage");
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

  // The Storage paths are read BEFORE the delete: the cascade
  // removes the product_images / product_variants rows, and with
  // them the only record of which bucket files belonged to this
  // product (audit run-1, LOW 8 — deleting used to leave the
  // photos at their public URLs forever). A null read means the
  // references could not be verified at all — the delete still
  // proceeds, but the warning below says so.
  const storagePaths = await collectProductStoragePaths(admin, existing.id);

  const { error } = await admin.from("products").delete().eq("id", existing.id);
  if (error) return { ok: false, error: GENERIC_ERROR };
  await writeAudit(admin, user.id, "product.delete", existing.id);

  // Reclaim the bucket files, best effort: the row is already gone
  // and the delete must not fail over Storage. A removal failure
  // is logged server-side AND returned as a visible warning on
  // the ok result — never a silent success (the files stay
  // publicly reachable until the orphan sweep in
  // lib/products/actions/upload.ts reclaims them).
  let warning: string | undefined;
  if (storagePaths === null) {
    warning = "Product deleted, but its photos could not be checked for removal from Storage.";
  } else if (storagePaths.length > 0) {
    try {
      const { error: storageError } = await admin.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .remove(storagePaths);
      if (storageError) {
        console.error(
          "TechShot: could not remove product photos from Storage for deleted product",
          existing.id,
          storageError,
        );
        warning = `Product deleted, but ${storagePaths.length} photo${storagePaths.length === 1 ? "" : "s"} could not be removed from Storage.`;
      }
    } catch (caught) {
      console.error(
        "TechShot: could not remove product photos from Storage for deleted product",
        existing.id,
        caught,
      );
      warning = `Product deleted, but ${storagePaths.length} photo${storagePaths.length === 1 ? "" : "s"} could not be removed from Storage.`;
    }
  }

  revalidateProductPages(existing.slug);
  return warning
    ? { ok: true, slug: existing.slug, warning }
    : { ok: true, slug: existing.slug };
}

/**
 * Bucket object names for one product's photos, from its
 * product_images.storage_path and product_variants.image_path
 * rows (read before the delete — see deleteProduct).
 *
 * A stored value names a bucket object only when it is:
 *   - a bare filename ("slug-123.jpg") — the object as-is;
 *   - a legacy "/images/products/<file>" path — it resolves into
 *     the bucket under its basename (lib/storage-images.ts).
 * A full https URL is NOT a bucket object and is skipped, and any
 * other "/..." path is not one either.
 *
 * A file another product — or a banner — still references is
 * never collected: the same photo may be shared, and deleting it
 * would break the other product / banner. (The banner check
 * mirrors deleteBanner in lib/banners-server.ts, which keeps a
 * file a product still references.)
 *
 * Returns [] when the product has no bucket files, and null when
 * the reads fail: the row delete still proceeds and the orphan
 * sweep reclaims the files later — but the failure is logged, not
 * silent, and the caller warns the admin.
 */
async function collectProductStoragePaths(
  admin: SupabaseClient,
  productId: string,
): Promise<string[] | null> {
  try {
    const [
      { data: images, error: imagesError },
      { data: variants, error: variantsError },
      { data: banners, error: bannersError },
    ] = await Promise.all([
      admin.from("product_images").select("product_id, storage_path"),
      admin.from("product_variants").select("product_id, image_path"),
      admin.from("banners").select("image_path"),
    ]);
    if (imagesError || variantsError || bannersError || !images || !variants || !banners) {
      console.warn(
        "TechShot: could not read product photo references for deleted product",
        productId,
      );
      return null;
    }
    const toBucketName = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      if (trimmed === "" || trimmed.includes("..")) return null;
      if (/^https?:\/\//i.test(trimmed)) return null;
      if (trimmed.startsWith("/")) {
        // Only the legacy product-photo path resolves into the
        // bucket; any other absolute path is not a bucket object.
        if (!trimmed.startsWith("/images/products/")) return null;
        const base = trimmed.split("/").filter((part) => part !== "").pop();
        return base ?? null;
      }
      return trimmed;
    };
    // Bucket names something else still references (same value or
    // same basename — a variant photo stored as a legacy path
    // names the same object as the bare filename).
    const referencedElsewhere = new Set<string>();
    for (const row of images as Array<{ product_id?: unknown; storage_path?: unknown }>) {
      if (row.product_id === productId) continue;
      const name = toBucketName(row.storage_path);
      if (name) referencedElsewhere.add(name);
    }
    for (const row of variants as Array<{ product_id?: unknown; image_path?: unknown }>) {
      if (row.product_id === productId) continue;
      const name = toBucketName(row.image_path);
      if (name) referencedElsewhere.add(name);
    }
    for (const row of banners as Array<{ image_path?: unknown }>) {
      const name = toBucketName(row.image_path);
      if (name) referencedElsewhere.add(name);
    }
    const own = new Set<string>();
    for (const row of images as Array<{ product_id?: unknown; storage_path?: unknown }>) {
      if (row.product_id !== productId) continue;
      const name = toBucketName(row.storage_path);
      if (name && !referencedElsewhere.has(name)) own.add(name);
    }
    for (const row of variants as Array<{ product_id?: unknown; image_path?: unknown }>) {
      if (row.product_id !== productId) continue;
      const name = toBucketName(row.image_path);
      if (name && !referencedElsewhere.has(name)) own.add(name);
    }
    return [...own];
  } catch {
    console.warn(
      "TechShot: could not read product photo references for deleted product",
      productId,
    );
    return null;
  }
}
