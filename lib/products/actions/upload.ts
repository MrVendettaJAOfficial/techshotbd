// TechShot marketplace — product photo upload server action.
//
// Uploads product photos straight to the public
// `product-images` bucket, from the /admin form. Staff only;
// see lib/products/actions/shared.ts for the staff gate.

"use server";

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
 * without saving leaves unreferenced files in the bucket. Those are
 * harmless and are never deleted automatically — a file may be
 * referenced by another product.
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
    if (uploaded.length > 0) {
      try {
        await admin.storage.from(PRODUCT_IMAGES_BUCKET).remove(uploaded);
      } catch {
        // Cleanup is best-effort; an orphaned file is harmless.
      }
    }
    return { ok: false, error: GENERIC_ERROR };
  }
  return { ok: true, files: uploaded };
}
