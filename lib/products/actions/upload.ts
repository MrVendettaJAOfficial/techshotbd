// TechShot marketplace — product photo upload server action.
//
// Uploads product photos straight to the public
// `product-images` bucket, from the /admin form. Staff only;
// see lib/products/actions/shared.ts for the staff gate.

"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { PRODUCT_IMAGES_BUCKET } from "@/lib/storage-images";

import type { ProductImageUploadResult } from "../types";
import { processProductImage } from "../process-image";
import {
  MAX_UPLOAD_FILES,
  slugify,
  uploadStoragePath,
  validateUploadFile,
} from "../validation";
import { GENERIC_ERROR, adminClient, requireStaff } from "./shared";

/**
 * Aggregate bounds for product photo uploads (audit run-1, NV 14):
 * the 5 MB per-file and 10-files-per-call caps alone cannot stop
 * one staff account from filling the shared 1 GB Supabase Storage
 * bucket with photos that are never attached to a product, so
 * uploads are bounded per staff member per day and in total —
 * the same pattern as the banner caps in lib/banners-server.ts
 * (audit run-1, finding #13), with limits sized for product
 * work: a product launch is several photos, a banner is one.
 */
const PRODUCT_DAILY_UPLOAD_LIMIT = 50;
const PRODUCT_MAX_STORED_FILES = 500;
/** audit_log action recorded for each successful product upload. */
const PRODUCT_UPLOAD_AUDIT_ACTION = "product.upload";
/** A product photo counts as abandoned after this long. */
const PRODUCT_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How many product photos this staff member uploaded in the last
 * 24h, counted from audit_log — the table already records actor_id
 * + action + created_at (migration 0001), so no new table is
 * needed. Returns null when the count cannot be verified (the
 * caller fails closed: an unverifiable quota is not an unlimited
 * one). The rows are fetched newest-first, capped at the limit
 * plus a small margin, and filtered by created_at here instead of
 * a count=exact HEAD request, so the count keeps working against
 * the mock Supabase used in e2e, which answers plain selects.
 */
async function countProductUploadsLast24h(
  admin: SupabaseClient,
  actorId: string,
  now: Date = new Date(),
): Promise<number | null> {
  try {
    const { data, error } = await admin
      .from("audit_log")
      .select("id, created_at")
      .eq("actor_id", actorId)
      .eq("action", PRODUCT_UPLOAD_AUDIT_ACTION)
      .order("created_at", { ascending: false })
      .limit(PRODUCT_DAILY_UPLOAD_LIMIT + 5);
    if (error || !data) return null;
    const since = new Date(now.getTime() - PRODUCT_ORPHAN_AGE_MS).toISOString();
    return (data as Array<{ created_at?: unknown }>)
      .filter((row) => typeof row.created_at === "string" && row.created_at >= since)
      .length;
  } catch {
    return null;
  }
}

/**
 * Every Storage filename a product still references, from
 * product_images.storage_path and product_variants.image_path.
 * Both the stored value and its basename are collected: a row may
 * hold the bare Storage filename, a legacy "/images/products/<file>"
 * path, or a full URL (see lib/storage-images.ts), and the Storage
 * list only ever shows bare root filenames. Returns null when
 * either read fails (fail closed: callers keep the file, or count
 * it, rather than act on an incomplete reference set).
 */
async function fetchProductReferencedImagePaths(
  admin: SupabaseClient,
): Promise<Set<string> | null> {
  try {
    const [{ data: images, error: imagesError }, { data: variants, error: variantsError }] =
      await Promise.all([
        admin.from("product_images").select("storage_path"),
        admin.from("product_variants").select("image_path"),
      ]);
    if (imagesError || variantsError || !images || !variants) return null;
    const referenced = new Set<string>();
    const add = (value: unknown): void => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (trimmed === "") return;
      referenced.add(trimmed);
      // The Storage object name is the last path segment.
      const basename = trimmed.split("/").filter((part) => part !== "").pop();
      if (basename) referenced.add(basename);
    };
    for (const row of images as Array<{ storage_path?: unknown }>) add(row.storage_path);
    for (const row of variants as Array<{ image_path?: unknown }>) add(row.image_path);
    return referenced;
  } catch {
    return null;
  }
}

/**
 * How many product photo files are stored in the shared bucket
 * right now: every file at the bucket root EXCEPT banner files
 * (names starting with "banner-" belong to the banner cap in
 * lib/banners-server.ts — unless a product references one, e.g.
 * a product titled "Banner lamp" uploads banner-lamp-*.jpg, which
 * IS a product photo and must count here). Returns null when
 * Storage will not list: the caller treats that as "cannot
 * verify" and lets the upload go ahead, because the daily cap
 * above is the hard bound (at most 50 new files per staff member
 * per day) and refusing every upload over a read-only
 * introspection failure would break product management outright.
 * The failure is logged so it is not silent. When the
 * product-reference read fails, the count falls back to counting
 * every listed file (over-counting only ever rejects an upload,
 * never deletes a product photo).
 */
async function countStoredProductFiles(admin: SupabaseClient): Promise<number | null> {
  try {
    const { data, error } = await admin.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .list("", { limit: 1000, search: "" });
    if (error || !data) {
      console.warn("TechShot: could not list product files to check the storage cap.");
      return null;
    }
    const files = data.filter((file) => typeof file.name === "string");
    const productReferenced = await fetchProductReferencedImagePaths(admin);
    if (productReferenced === null) {
      console.warn(
        "TechShot: could not read product photo references to check the storage cap; counting every file.",
      );
      return files.length;
    }
    return files.filter(
      (file) => !file.name.startsWith("banner-") || productReferenced.has(file.name),
    ).length;
  } catch {
    console.warn("TechShot: could not list product files to check the storage cap.");
    return null;
  }
}

/**
 * Record one successful product photo upload in audit_log, so the
 * daily cap in countProductUploadsLast24h can count it. Returns
 * false when the record fails: the caller then removes the
 * uploaded files and fails the upload, so an upload can never be
 * invisible to the quota and repeated without limit. entity_id is
 * null — the product row does not exist yet when the photo is
 * uploaded.
 */
async function recordProductUpload(admin: SupabaseClient, actorId: string): Promise<boolean> {
  try {
    const { error } = await admin.from("audit_log").insert({
      actor_id: actorId,
      action: PRODUCT_UPLOAD_AUDIT_ACTION,
      entity_type: "product",
      entity_id: null,
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Best-effort Storage removal: a failed removal never fails the
 * caller's action — the row is already gone and the orphan sweep
 * (cleanupOrphanProductPhotos) reclaims the file later.
 */
async function removeStorageFilesBestEffort(
  admin: SupabaseClient,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  try {
    await admin.storage.from(PRODUCT_IMAGES_BUCKET).remove(paths);
  } catch {
    // Best effort only — see above.
  }
}

/**
 * Upload product photos straight to the public `product-images`
 * bucket, from the /admin form. Admin only, exactly like the other
 * product actions: the service-role client bypasses RLS, so the
 * role check above is the enforcement point, and the service-role
 * key never leaves the server.
 *
 * Each file is validated before anything is uploaded (JPEG / PNG /
 * WebP only, 5 MB max, at most 10 files at once). Filenames are
 * generated server-side from the product slug + timestamp + random
 * suffix — the uploaded filename is never used, so it cannot
 * traverse out of the bucket or overwrite an existing file (upsert
 * is off as well). Before storing, each photo is cropped with sharp
 * to the one universal size (1200 x 1200 square, see
 * lib/products/process-image.ts) — a bigger or non-square upload
 * lands in Storage already square, and the stored content type is
 * the processed file's type, so it always matches the bytes. If one
 * upload fails after others succeeded, the uploaded files are
 * removed again, best-effort, so a half-finished upload leaves no
 * orphans.
 *
 * The files are uploaded immediately; the product_images rows are
 * only written when the product itself is saved, so uploading
 * without saving leaves unreferenced files in the bucket. Those
 * are bounded, not permanent: uploads are capped per staff member
 * per day (50 photos) and in total (500 stored product files —
 * see the checks below), every successful upload is recorded in
 * audit_log, and the staff-only cleanupOrphanProductPhotos action
 * sweeps unreferenced product files older than 24h. Banner files
 * ("banner-*") are the banner sweep's job, not this one's — a
 * "banner-*" file a product references is a product photo and is
 * kept by both sweeps.
 *
 * Aggregate bounds (audit run-1, NV 14): before storing, the
 * caller's successful uploads in the last 24h are counted from
 * audit_log (cap 50/day) and the stored product files are counted
 * via Storage list (cap 500 files). The daily count is
 * fail-closed — when it cannot be verified the upload is
 * rejected — while the total count is fail-open on a list failure
 * (the daily cap is the hard bound, and refusing every upload
 * over a read-only introspection failure would break product
 * management). A successful upload is recorded in audit_log, so
 * the daily cap can count it; if that record fails the files are
 * removed again and the upload fails, so no upload is ever
 * invisible to the quota.
 */
export async function uploadProductImages(formData: FormData): Promise<ProductImageUploadResult> {
  const actor = await requireStaff("manage");
  if ("error" in actor) return { ok: false, error: actor.error };

  const admin = adminClient();
  if (!admin) return { ok: false, error: GENERIC_ERROR };

  const title = typeof formData.get("title") === "string" ? (formData.get("title") as string) : "";
  const files = formData
    .getAll("photos")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return { ok: false, error: "Choose at least one photo to upload." };
  if (files.length > MAX_UPLOAD_FILES) {
    return { ok: false, error: `Upload at most ${MAX_UPLOAD_FILES} photos at a time.` };
  }
  for (const file of files) {
    const problem = validateUploadFile(file);
    if (problem) return { ok: false, error: problem };
  }

  // Aggregate bounds, before anything is stored: a per-staff
  // daily cap (counted in photos — one call uploads up to 10),
  // then a cap on total stored product files.
  const dailyCount = await countProductUploadsLast24h(admin, actor.user.id);
  if (dailyCount === null) return { ok: false, error: GENERIC_ERROR };
  if (dailyCount + files.length > PRODUCT_DAILY_UPLOAD_LIMIT) {
    return {
      ok: false,
      error: `You have reached today's product photo upload limit (${PRODUCT_DAILY_UPLOAD_LIMIT} photos). Try again tomorrow.`,
    };
  }
  const storedCount = await countStoredProductFiles(admin);
  if (storedCount !== null && storedCount >= PRODUCT_MAX_STORED_FILES) {
    return {
      ok: false,
      error: `The product photo store is full (${PRODUCT_MAX_STORED_FILES} photos). Delete an unused product photo first.`,
    };
  }

  const slug = slugify(title);
  const uploaded: string[] = [];
  try {
    for (const file of files) {
      // Crop to the universal square before storing: the raw upload
      // never reaches the bucket. The processed file keeps the input
      // format, so the path extension and content type still come
      // from file.type, as before.
      const processed = await processProductImage(
        Buffer.from(await file.arrayBuffer()),
        file.type,
      );
      const path = uploadStoragePath(slug, processed.contentType);
      const { error } = await admin.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .upload(path, processed.buffer, {
          contentType: processed.contentType,
          upsert: false,
          cacheControl: "3600",
        });
      if (error) throw new Error("upload failed");
      uploaded.push(path);
    }
  } catch {
    await removeStorageFilesBestEffort(admin, uploaded);
    return { ok: false, error: GENERIC_ERROR };
  }
  // Record each upload, so the daily cap counts it. A failed
  // record removes the files again and fails the upload — an
  // unrecorded upload would be invisible to the quota.
  for (let i = 0; i < uploaded.length; i += 1) {
    if (!(await recordProductUpload(admin, actor.user.id))) {
      await removeStorageFilesBestEffort(admin, uploaded);
      return { ok: false, error: GENERIC_ERROR };
    }
  }
  return { ok: true, files: uploaded };
}

export type ProductCleanupResult =
  | { ok: true; removed: number; kept: number }
  | { ok: false; error: string };

/**
 * Sweep product photo files in Storage that no product row
 * references and that are older than 24h (audit run-1, NV 14).
 * Staff only, run by hand — there is no cron, and nothing here
 * runs on a schedule. (No admin button wires it yet: the Products
 * tab needs a "Clean up unused product photos" button calling
 * this action, the way the Banners tab wires
 * cleanupOrphanBannerPhotos.)
 *
 * Only files at the bucket root whose name does NOT start with
 * "banner-" are considered — banner files are the banner sweep's
 * job, and a "banner-*" file a product references is a product
 * photo the banner sweep already keeps. A file is removed only
 * when no product_images row and no product_variants row
 * references its name (exact value or basename — a variant photo
 * stored as "/images/products/<file>" names the same object as
 * the bare filename) AND no banners row references it AND its
 * Storage created_at is older than 24h — a photo uploaded moments
 * ago for a product still being composed is never swept. A missing
 * or unparseable created_at is never swept either: keeping a file
 * is safer than deleting a fresh one. `removed` counts the files
 * deleted, `kept` the product files left in place (referenced,
 * too new, or both). A failed list, read or removal returns an
 * error and removes nothing silently. A failed reference read
 * also returns an error and removes nothing: the sweep cannot
 * prove a file is not a product photo, so it must not delete any.
 */
export async function cleanupOrphanProductPhotos(): Promise<ProductCleanupResult> {
  const actor = await requireStaff("manage");
  if ("error" in actor) return { ok: false, error: actor.error };
  const admin = adminClient();
  if (!admin) return { ok: false, error: GENERIC_ERROR };
  try {
    const { data: files, error: listError } = await admin.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .list("", { limit: 1000, search: "" });
    if (listError || !files) return { ok: false, error: GENERIC_ERROR };
    const productFiles = files.filter(
      (file) => typeof file.name === "string" && !file.name.startsWith("banner-"),
    );
    const productReferenced = await fetchProductReferencedImagePaths(admin);
    if (productReferenced === null) return { ok: false, error: GENERIC_ERROR };
    const { data: bannerRows, error: bannerError } = await admin
      .from("banners")
      .select("image_path");
    if (bannerError || !bannerRows) return { ok: false, error: GENERIC_ERROR };
    const referenced = new Set(productReferenced);
    for (const row of bannerRows as Array<{ image_path?: unknown }>) {
      if (typeof row.image_path !== "string") continue;
      const trimmed = row.image_path.trim();
      if (trimmed === "") continue;
      referenced.add(trimmed);
      const basename = trimmed.split("/").filter((part) => part !== "").pop();
      if (basename) referenced.add(basename);
    }
    const cutoff = new Date(Date.now() - PRODUCT_ORPHAN_AGE_MS).toISOString();
    const orphans = productFiles.filter((file) => {
      if (referenced.has(file.name)) return false;
      // Only files old enough to be abandoned. A missing or
      // unparseable timestamp is never swept.
      if (typeof file.created_at !== "string" || file.created_at === "") return false;
      return file.created_at < cutoff;
    });
    if (orphans.length === 0) {
      return { ok: true, removed: 0, kept: productFiles.length };
    }
    const names = orphans.map((file) => file.name);
    const { error: removeError } = await admin.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .remove(names);
    if (removeError) return { ok: false, error: GENERIC_ERROR };
    return { ok: true, removed: names.length, kept: productFiles.length - names.length };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}
