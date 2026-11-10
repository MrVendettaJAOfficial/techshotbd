// TechShot marketplace — hero banner slides.
//
// SERVER ACTIONS ("use server"). One job: the server-side reads and
// writes for the `banners` table (migration 0011 — NOT applied live
// yet; until it is, every function below returns an empty list / a
// generic error and the Banners tab says banners are unavailable,
// instead of failing the page — and the home page falls back to
// product slides, see lib/hero-slides.ts).
//
// Enforcement is two layers, following the same pattern as
// lib/announcements-server.ts:
//   * Server action: the caller's profiles.role is re-read from the
//     database on every call (getCallerRole, never trusted from
//     the browser). Managing banners needs lib/roles.ts
//     canManageBanners — any staff role (Owner, co-admin,
//     manager), the same rule as managing products. Customers
//     calling a write get an error, never a silent success.
//     Listing for the admin tab needs isStaff.
//   * RLS (migration 0011): SELECT of active banners for anyone
//     (the public home page), INSERT / UPDATE / DELETE for staff
//     only. The service-role client below bypasses RLS, so the
//     role checks above are the enforcement point here — they
//     must never be removed.
//   * Input is validated by the pure rules in lib/banners.ts
//     (headline 1–120 chars, subcopy 0–300, button label 0–40,
//     button link an internal path, sort order a whole number).
//     An uploaded photo is cropped to 1600 x 640 before Storage
//     (lib/banners/process-banner-image.ts), JPEG / PNG / WebP
//     only, 5 MB max, filename generated server-side.
//
// The home-page read (listActiveBanners) uses the request-scoped
// client, so the authenticated/anon SELECT policy applies — the
// honest RLS path, not the service role. Errors returned to the
// client are generic on purpose: never a stack trace, SQL, or
// table name, and never which environment variable is missing
// when Supabase is not configured.

"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient, createClient } from "./supabase/server";
import { getCallerRole, getCurrentUser } from "./auth-server";
import { canManageBanners, isStaff } from "./roles";
import { PRODUCT_IMAGES_BUCKET } from "./storage-images";
import {
  BANNER_DEFAULT_CTA_HREF,
  sortBanners,
  validateBannerInput,
  type Banner,
} from "./banners";
import { processBannerImage } from "./banners/process-banner-image";
import { slugify, uploadStoragePath, validateUploadFile } from "./products/validation";

const BANNER_GENERIC_ERROR = "Something went wrong. Please try again.";
const BANNER_NOT_ALLOWED_ERROR = "Only store staff can manage banners.";

function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function isAdminConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function mapRow(row: Record<string, unknown>): Banner {
  return {
    id: String(row.id),
    imagePath: typeof row.image_path === "string" ? row.image_path : "",
    headline: typeof row.headline === "string" ? row.headline : "",
    subcopy: typeof row.subcopy === "string" ? row.subcopy : "",
    ctaLabel: typeof row.cta_label === "string" ? row.cta_label : "",
    ctaHref:
      typeof row.cta_href === "string" && row.cta_href !== ""
        ? row.cta_href
        : BANNER_DEFAULT_CTA_HREF,
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
    active: row.active !== false,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

const BANNER_COLUMNS = "id, image_path, headline, subcopy, cta_label, cta_href, sort_order, active, created_at";

/**
 * Active banners, lowest sort_order first, for the home-page hero
 * carousel. Anyone may read them (anon SELECT policy on active
 * rows); the home page is public. Empty when Supabase is not
 * configured or migration 0011 has not been applied yet — the home
 * page then falls back to product slides.
 */
export async function listActiveBanners(): Promise<Banner[]> {
  if (!isConfigured()) return [];
  let supabase: SupabaseClient;
  try {
    supabase = untyped(createClient());
  } catch {
    return [];
  }
  try {
    const { data, error } = await supabase
      .from("banners")
      .select(BANNER_COLUMNS)
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return sortBanners((data as unknown as Array<Record<string, unknown>>).map(mapRow));
  } catch {
    return [];
  }
}

/**
 * Every banner, lowest sort_order first, for the admin Banners tab.
 * Staff only (Owner, co-admin, manager): anyone else gets an empty
 * list. Empty when Supabase is not configured or migration 0011 has
 * not been applied yet.
 */
export async function listBanners(): Promise<Banner[]> {
  if (!isAdminConfigured()) return [];
  const role = await getCallerRole().catch(() => null);
  if (!isStaff(role)) return [];
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return [];
  }
  try {
    const { data, error } = await admin
      .from("banners")
      .select(BANNER_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return sortBanners((data as unknown as Array<Record<string, unknown>>).map(mapRow));
  } catch {
    return [];
  }
}

export type SaveBannerResult =
  | { ok: true; banner: Banner }
  | { ok: false; error: string };

/**
 * Add a banner. Any staff role — a manager is staff, the same rule
 * as managing products. Revalidates /admin and / so the slide
 * appears at once.
 */
export async function createBanner(input: {
  imagePath: string;
  headline: string;
  subcopy: string;
  ctaLabel: string;
  ctaHref: string;
  sortOrder: number;
  active: boolean;
}): Promise<SaveBannerResult> {
  const validated = validateBannerInput(input);
  if (!validated.ok) return { ok: false, error: validated.error };
  if (!isAdminConfigured()) return { ok: false, error: BANNER_GENERIC_ERROR };
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { ok: false, error: BANNER_NOT_ALLOWED_ERROR };
  const role = await getCallerRole().catch(() => null);
  if (!canManageBanners(role)) return { ok: false, error: BANNER_NOT_ALLOWED_ERROR };
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
  try {
    const { data, error } = (await admin
      .from("banners")
      .insert({
        image_path: validated.value.imagePath,
        headline: validated.value.headline,
        subcopy: validated.value.subcopy,
        cta_label: validated.value.ctaLabel,
        cta_href: validated.value.ctaHref,
        sort_order: validated.value.sortOrder,
        active: validated.value.active,
      })
      .select(BANNER_COLUMNS)
      .single()) as {
      data: Record<string, unknown> | null;
      error: unknown;
    };
    if (error || !data) return { ok: false, error: BANNER_GENERIC_ERROR };
    revalidatePath("/admin");
    revalidatePath("/");
    return { ok: true, banner: mapRow(data) };
  } catch {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
}

/**
 * Change a banner. Same gate as creating. Revalidates /admin and /.
 */
export async function updateBanner(
  id: string,
  input: {
    imagePath: string;
    headline: string;
    subcopy: string;
    ctaLabel: string;
    ctaHref: string;
    sortOrder: number;
    active: boolean;
  },
): Promise<SaveBannerResult> {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
  const validated = validateBannerInput(input);
  if (!validated.ok) return { ok: false, error: validated.error };
  if (!isAdminConfigured()) return { ok: false, error: BANNER_GENERIC_ERROR };
  const role = await getCallerRole().catch(() => null);
  if (!canManageBanners(role)) return { ok: false, error: BANNER_NOT_ALLOWED_ERROR };
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
  try {
    const { data, error } = (await admin
      .from("banners")
      .update({
        image_path: validated.value.imagePath,
        headline: validated.value.headline,
        subcopy: validated.value.subcopy,
        cta_label: validated.value.ctaLabel,
        cta_href: validated.value.ctaHref,
        sort_order: validated.value.sortOrder,
        active: validated.value.active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(BANNER_COLUMNS)
      .single()) as {
      data: Record<string, unknown> | null;
      error: unknown;
    };
    if (error || !data) return { ok: false, error: BANNER_GENERIC_ERROR };
    revalidatePath("/admin");
    revalidatePath("/");
    return { ok: true, banner: mapRow(data) };
  } catch {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
}

export type BannerActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Switch one banner on or off without re-validating the whole row.
 * Same gate as creating. Revalidates /admin and /.
 */
export async function setBannerActive(id: string, active: boolean): Promise<BannerActionResult> {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
  if (!isAdminConfigured()) return { ok: false, error: BANNER_GENERIC_ERROR };
  const role = await getCallerRole().catch(() => null);
  if (!canManageBanners(role)) return { ok: false, error: BANNER_NOT_ALLOWED_ERROR };
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
  try {
    const { error } = await admin
      .from("banners")
      .update({ active, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, error: BANNER_GENERIC_ERROR };
    revalidatePath("/admin");
    revalidatePath("/");
    return { ok: true };
  } catch {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
}

/**
 * Delete a banner. Same gate as creating. The Storage file is NOT
 * deleted with it — the same rule as product photos: a file may be
 * referenced elsewhere, and orphans are harmless. Revalidates
 * /admin and /.
 */
export async function deleteBanner(id: string): Promise<BannerActionResult> {
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
  if (!isAdminConfigured()) return { ok: false, error: BANNER_GENERIC_ERROR };
  const role = await getCallerRole().catch(() => null);
  if (!canManageBanners(role)) return { ok: false, error: BANNER_NOT_ALLOWED_ERROR };
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
  try {
    const { error } = await admin.from("banners").delete().eq("id", id);
    if (error) return { ok: false, error: BANNER_GENERIC_ERROR };
    revalidatePath("/admin");
    revalidatePath("/");
    return { ok: true };
  } catch {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
}

export type BannerImageUploadResult =
  | { ok: true; file: string }
  | { ok: false; error: string };

/**
 * Upload one banner photo straight to the public `product-images`
 * bucket, from the /admin Banners tab. Staff only, exactly like
 * the product photo upload: the service-role client bypasses RLS,
 * so the role check above is the enforcement point, and the
 * service-role key never leaves the server.
 *
 * The file is validated before anything is uploaded (JPEG / PNG /
 * WebP only, 5 MB max). The filename is generated server-side
 * from "banner-" + the headline slug + timestamp + random suffix —
 * the uploaded filename is never used, so it cannot traverse out
 * of the bucket or overwrite an existing file (upsert is off as
 * well). Before storing, the photo is cropped with sharp to the
 * one universal banner size (1600 x 640 wide, see
 * lib/banners/process-banner-image.ts) — a bigger or differently
 * shaped upload lands in Storage already wide, and the stored
 * content type is the processed file's type, so it always matches
 * the bytes. If the upload fails after storing, the file is
 * removed again, best-effort, so a half-finished upload leaves no
 * orphan.
 *
 * The file is uploaded immediately; the banners row is only
 * written when the banner itself is saved, so uploading without
 * saving leaves an unreferenced file in the bucket. That is
 * harmless and is never deleted automatically — a file may be
 * referenced by another banner.
 */
export async function uploadBannerImage(formData: FormData): Promise<BannerImageUploadResult> {
  const actorRole = await getCallerRole().catch(() => null);
  if (!canManageBanners(actorRole)) return { ok: false, error: BANNER_NOT_ALLOWED_ERROR };

  const admin = (() => {
    try {
      return untyped(createAdminClient());
    } catch {
      return null;
    }
  })();
  if (!admin) return { ok: false, error: BANNER_GENERIC_ERROR };

  const headline = typeof formData.get("headline") === "string" ? (formData.get("headline") as string) : "";
  const entry = formData.get("banner");
  const file = entry instanceof File && entry.size > 0 ? entry : null;
  if (!file) return { ok: false, error: "Choose a photo to upload first." };
  const problem = validateUploadFile(file);
  if (problem) return { ok: false, error: problem };

  const slug = slugify(headline.trim() === "" ? "banner" : headline);
  try {
    // Crop to the universal wide strip before storing: the raw
    // upload never reaches the bucket. The processed file keeps the
    // input format, so the path extension and content type still
    // come from file.type, as before.
    const processed = await processBannerImage(Buffer.from(await file.arrayBuffer()), file.type);
    const path = uploadStoragePath(`banner-${slug}`, processed.contentType);
    const { error } = await admin.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(path, processed.buffer, { contentType: processed.contentType, upsert: false });
    if (error) return { ok: false, error: BANNER_GENERIC_ERROR };
    return { ok: true, file: path };
  } catch {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
}
