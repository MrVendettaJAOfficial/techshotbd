// TechShot marketplace — hero banner slides.
//
// SERVER ACTIONS ("use server"). One job: the server-side reads and
// writes for the `banners` table (migration 0011 — applied live
// 2026-11-10; the `kind` column comes from migration 0013 — applied
// live 2026-11-11).
//
// The home-page read (listActiveBanners) is cached across requests
// under the "banners" tag (Next.js data cache, see
// lib/storefront-cache.ts): the first visit after a banner write
// fetches once, later visits read the cache. Every banner write
// below purges the tag, so a new banner shows on the home hero
// immediately. A failed read throws inside the cached function and
// is never cached — listActiveBanners catches it and returns an
// empty list, and the home page falls back to product slides (see
// lib/hero-slides.ts). The admin list (listBanners) is NOT cached:
// it is per-staff data and reads live on every admin visit.
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
//     (kind "promotion" or "offer", sort order a whole number).
//     The stored headline is derived from the kind — the form no
//     longer edits headline / subcopy / button text (image-only
//     carousel since 2026-11-10). An uploaded photo is cropped to
//     1600 x 640 before Storage
//     (lib/banners/process-banner-image.ts), JPEG / PNG / WebP
//     only, 5 MB max, filename generated server-side from the kind.
//
//     Banner uploads are bounded in aggregate (audit run-1, finding
//     #13): one staff member may upload at most 20 banner photos a
//     day, and the bucket holds at most 100 banner photo files at
//     once — both checked in uploadBannerImage below, so one staff
//     account cannot fill the shared 1 GB Supabase Storage bucket.
//     Every successful upload is recorded in audit_log (action
//     "banner.upload"), which is what the daily count reads — no
//     new table. Deleting a banner reclaims its Storage file when
//     no other banner references it, and the staff-only
//     cleanupOrphanBannerPhotos action sweeps banner files no
//     banner references that are older than 24h.
//
// The home-page read (listActiveBanners) uses the request-scoped
// client, so the authenticated/anon SELECT policy applies — the
// honest RLS path, not the service role. Errors returned to the
// client are generic on purpose: never a stack trace, SQL, or
// table name, and never which environment variable is missing
// when Supabase is not configured.

"use server";

import { revalidatePath, unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient, createPublicClient } from "./supabase/server";
import { BANNERS_CACHE_TAG, revalidateBannersCache, revalidateCatalogCache } from "./storefront-cache";
import { getCallerRole, getCurrentUser } from "./auth-server";
import { canManageBanners, isStaff } from "./roles";
import { PRODUCT_IMAGES_BUCKET } from "./storage-images";
import {
  BANNER_DEFAULT_CTA_HREF,
  sortBanners,
  validateBannerInput,
  type Banner,
  type BannerKind,
} from "./banners";
import { processBannerImage } from "./banners/process-banner-image";
import { slugify, uploadStoragePath, validateUploadFile } from "./products/validation";

const BANNER_GENERIC_ERROR = "Something went wrong. Please try again.";
const BANNER_NOT_ALLOWED_ERROR = "Only store staff can manage banners.";

/**
 * Aggregate bounds for banner photo uploads (audit run-1, finding
 * #13): the 5 MB per-file cap alone cannot stop one staff account
 * from filling the shared 1 GB Supabase Storage bucket, so uploads
 * are bounded per staff member per day and in total.
 */
const BANNER_DAILY_UPLOAD_LIMIT = 20;
const BANNER_MAX_STORED_FILES = 100;
/** audit_log action recorded for each successful banner upload. */
const BANNER_UPLOAD_AUDIT_ACTION = "banner.upload";
/** A banner photo counts as abandoned after this long. */
const BANNER_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How many banner photos this staff member uploaded in the last
 * 24h, counted from audit_log — the table already records actor_id
 * + action + created_at (migration 0001), so no new table is
 * needed. Returns null when the count cannot be verified (the
 * caller fails closed: an unverifiable quota is not an unlimited
 * one). The rows are fetched newest-first, capped at the limit
 * plus a small margin, and filtered by created_at here instead of
 * a count=exact HEAD request, so the count keeps working against
 * the mock Supabase used in e2e, which answers plain selects.
 */
async function countBannerUploadsLast24h(
  admin: SupabaseClient,
  actorId: string,
  now: Date = new Date(),
): Promise<number | null> {
  try {
    const { data, error } = await admin
      .from("audit_log")
      .select("id, created_at")
      .eq("actor_id", actorId)
      .eq("action", BANNER_UPLOAD_AUDIT_ACTION)
      .order("created_at", { ascending: false })
      .limit(BANNER_DAILY_UPLOAD_LIMIT + 5);
    if (error || !data) return null;
    const since = new Date(now.getTime() - BANNER_ORPHAN_AGE_MS).toISOString();
    return (data as Array<{ created_at?: unknown }>)
      .filter((row) => typeof row.created_at === "string" && row.created_at >= since)
      .length;
  } catch {
    return null;
  }
}

/**
 * How many banner photo files are stored in the shared bucket
 * right now (names starting with "banner-" at the bucket root).
 * Returns null when Storage will not list: the caller treats that
 * as "cannot verify" and lets the upload go ahead, because the
 * daily cap above is the hard bound (at most 20 new files per
 * staff member per day) and refusing every upload over a
 * read-only introspection failure would break banner management
 * outright. The failure is logged so it is not silent.
 */
async function countStoredBannerFiles(admin: SupabaseClient): Promise<number | null> {
  try {
    const { data, error } = await admin.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .list("", { limit: 1000, search: "banner-" });
    if (error || !data) {
      console.warn("TechShot: could not list banner files to check the storage cap.");
      return null;
    }
    return data.filter(
      (file) => typeof file.name === "string" && file.name.startsWith("banner-"),
    ).length;
  } catch {
    console.warn("TechShot: could not list banner files to check the storage cap.");
    return null;
  }
}

/**
 * Record a successful banner upload in audit_log, so the daily
 * cap in countBannerUploadsLast24h can count it. Returns false
 * when the record fails: the caller then removes the uploaded
 * file and fails the upload, so an upload can never be invisible
 * to the quota and repeated without limit. entity_id is null —
 * the banners row does not exist yet when the photo is uploaded.
 */
async function recordBannerUpload(admin: SupabaseClient, actorId: string): Promise<boolean> {
  try {
    const { error } = await admin.from("audit_log").insert({
      actor_id: actorId,
      action: BANNER_UPLOAD_AUDIT_ACTION,
      entity_type: "banner",
      entity_id: null,
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * True when a stored path is a banner photo file in Storage: a
 * bare filename at the bucket root starting with "banner-"
 * (uploadBannerImage generates "banner-<kind>-<ts>-<rand>.png").
 * Legacy / local paths ("/images/...") and URLs are not Storage
 * objects and must never be passed to Storage remove.
 */
function isBareStorageFilename(path: string): boolean {
  const value = (path ?? "").trim();
  if (value === "") return false;
  if (value.includes("/") || value.includes("\\") || value.includes("://")) return false;
  return value.startsWith("banner-");
}

/**
 * True when another banner row still references this Storage
 * file. On a read failure returns true (fail closed): a file that
 * might still be referenced is kept, and the orphan sweep
 * reclaims it later if it really is unreferenced.
 */
async function isBannerImageReferenced(
  admin: SupabaseClient,
  imagePath: string,
  excludeId: string,
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("banners")
      .select("id")
      .eq("image_path", imagePath)
      .neq("id", excludeId)
      .limit(1);
    if (error || !data) return true;
    return (data as Array<unknown>).length > 0;
  } catch {
    return true;
  }
}

/**
 * Best-effort Storage removal: a failed removal never fails the
 * caller's action — the row is already gone and the orphan sweep
 * (cleanupOrphanBannerPhotos) reclaims the file later.
 */
async function removeStorageFileBestEffort(admin: SupabaseClient, path: string): Promise<void> {
  try {
    await admin.storage.from(PRODUCT_IMAGES_BUCKET).remove([path]);
  } catch {
    // Best effort only — see above.
  }
}

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
    kind: row.kind === "offer" ? "offer" : "promotion",
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

const BANNER_COLUMNS = "id, image_path, kind, headline, subcopy, cta_label, cta_href, sort_order, active, created_at";

/**
 * Active banners, lowest sort_order first, for the home-page hero
 * carousel. Anyone may read them (anon SELECT policy on active
 * rows); the home page is public. Throws when the query fails, so
 * the shared cache below never caches a failure — listActiveBanners
 * catches it and returns an empty list instead. The rows are the
 * same through either client: banners are public data under the
 * anon RLS policy.
 */
async function fetchActiveBanners(supabase: SupabaseClient): Promise<Banner[]> {
  const { data, error } = await supabase
    .from("banners")
    .select(BANNER_COLUMNS)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !data) throw new Error("Failed to load banners.");
  return sortBanners((data as unknown as Array<Record<string, unknown>>).map(mapRow));
}

/**
 * The active banners, cached across requests under the "banners" tag
 * (see lib/storefront-cache.ts). The fetch runs through the
 * cookie-less public client: the data cache forbids dynamic APIs,
 * so the request-scoped client — which reads cookies — cannot run
 * inside it. Every banner write below purges the tag.
 */
const fetchActiveBannersCached = unstable_cache(
  async (): Promise<Banner[]> => fetchActiveBanners(untyped(createPublicClient())),
  ["techshot-banners"],
  { tags: [BANNERS_CACHE_TAG] },
);

/**
 * Active banners, lowest sort_order first, for the home-page hero
 * carousel. Empty when Supabase is not configured or a read fails —
 * the home page then falls back to product slides.
 */
export async function listActiveBanners(): Promise<Banner[]> {
  if (!isConfigured()) return [];
  try {
    return await fetchActiveBannersCached();
  } catch {
    return [];
  }
}

/**
 * Every banner, lowest sort_order first, for the admin Banners tab.
 * Staff only (Owner, co-admin, manager): anyone else gets an empty
 * list. Empty when Supabase is not configured or migration 0013 has
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

/** What the admin form sends: the photo, the kind, the order, the flag. */
export interface SaveBannerInput {
  imagePath: string;
  kind: BannerKind;
  sortOrder: number;
  active: boolean;
}

/**
 * The stored headline for a kind: the slide's alt text only, never
 * visible — the image-only carousel shows the photo alone. The
 * subcopy / button columns are cleared on write (they are unused
 * since the redesign); the link keeps its /shop default for
 * existing rows that still carry it.
 */
function headlineForKind(kind: BannerKind): string {
  return kind === "offer" ? "Offer banner" : "Promotion banner";
}

/**
 * Add a banner. Any staff role — a manager is staff, the same rule
 * as managing products. Revalidates /admin and / so the slide
 * appears at once.
 */
export async function createBanner(input: SaveBannerInput): Promise<SaveBannerResult> {
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
        kind: validated.value.kind,
        headline: headlineForKind(validated.value.kind),
        subcopy: "",
        cta_label: "",
        cta_href: BANNER_DEFAULT_CTA_HREF,
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
    revalidateBannersCache();
    revalidateCatalogCache();
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
  input: SaveBannerInput,
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
        kind: validated.value.kind,
        headline: headlineForKind(validated.value.kind),
        subcopy: "",
        cta_label: "",
        cta_href: BANNER_DEFAULT_CTA_HREF,
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
    revalidateBannersCache();
    revalidateCatalogCache();
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
    revalidateBannersCache();
    revalidateCatalogCache();
    return { ok: true };
  } catch {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
}

/**
 * Delete a banner. Same gate as creating. The banner's Storage
 * file is reclaimed with it — when the stored path is a bare
 * Storage filename (see isBareStorageFilename) and no other banner
 * row references the same file, the object is removed, best
 * effort, after the row delete succeeds. A removal failure never
 * fails the delete: the row is gone and the orphan sweep
 * (cleanupOrphanBannerPhotos) reclaims the file later. Legacy
 * paths ("/images/...") are not Storage objects and are never
 * touched. Deleting a banner that does not exist returns an
 * error, instead of a silent success. Revalidates /admin and /,
 * and purges the banners tag and the catalog tag (a banner write
 * refreshes the catalogue too — audit run-1, finding #14).
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
    // The row is read first: only it knows the Storage path, and a
    // missing row is an error, not a silent success.
    const { data, error: loadError } = (await admin
      .from("banners")
      .select("image_path")
      .eq("id", id)
      .maybeSingle()) as {
      data: { image_path?: unknown } | null;
      error: unknown;
    };
    if (loadError || !data) return { ok: false, error: BANNER_GENERIC_ERROR };
    const imagePath = typeof data.image_path === "string" ? data.image_path : "";
    const { error } = await admin.from("banners").delete().eq("id", id);
    if (error) return { ok: false, error: BANNER_GENERIC_ERROR };
    if (isBareStorageFilename(imagePath)) {
      const stillReferenced = await isBannerImageReferenced(admin, imagePath, id);
      if (!stillReferenced) {
        await removeStorageFileBestEffort(admin, imagePath);
      }
    }
    revalidatePath("/admin");
    revalidatePath("/");
    revalidateBannersCache();
    revalidateCatalogCache();
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
 * from "banner-" + the kind ("promotion" / "offer") + timestamp +
 * random suffix — the uploaded filename is never used, so it
 * cannot traverse out of the bucket or overwrite an existing file
 * (upsert is off as well). Before storing, the photo is cropped
 * with sharp to the one universal banner size (1600 x 640 wide,
 * see lib/banners/process-banner-image.ts) — a bigger or
 * differently shaped upload lands in Storage already wide, and
 * the stored content type is the processed file's type, so it
 * always matches the bytes. If the upload fails after storing, the
 * file is removed again, best-effort, so a half-finished upload
 * leaves no orphan.
 *
 * The file is uploaded immediately; the banners row is only
 * written when the banner itself is saved, so uploading without
 * saving leaves an unreferenced file in the bucket. That file is
 * bounded, not permanent: uploads are capped per staff member per
 * day and in total (see the checks below), and the staff-only
 * cleanupOrphanBannerPhotos action sweeps unreferenced banner
 * files older than 24h.
 *
 * Aggregate bounds (audit run-1, finding #13): before storing,
 * the caller's successful uploads in the last 24h are counted
 * from audit_log (cap 20/day) and the stored banner files are
 * counted via Storage list (cap 100 files). The daily count is
 * fail-closed — when it cannot be verified the upload is
 * rejected — while the total count is fail-open on a list failure
 * (the daily cap is the hard bound, and refusing every upload
 * over a read-only introspection failure would break banner
 * management). A successful upload is recorded in audit_log, so
 * the daily cap can count it; if that record fails the file is
 * removed again and the upload fails, so no upload is ever
 * invisible to the quota.
 */
export async function uploadBannerImage(formData: FormData): Promise<BannerImageUploadResult> {
  const actorRole = await getCallerRole().catch(() => null);
  if (!canManageBanners(actorRole)) return { ok: false, error: BANNER_NOT_ALLOWED_ERROR };
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { ok: false, error: BANNER_NOT_ALLOWED_ERROR };

  const admin = (() => {
    try {
      return untyped(createAdminClient());
    } catch {
      return null;
    }
  })();
  if (!admin) return { ok: false, error: BANNER_GENERIC_ERROR };

  const kindValue = formData.get("kind");
  const kind: BannerKind =
    kindValue === "offer" ? "offer" : "promotion";
  const entry = formData.get("banner");
  const file = entry instanceof File && entry.size > 0 ? entry : null;
  if (!file) return { ok: false, error: "Choose a photo to upload first." };
  const problem = validateUploadFile(file);
  if (problem) return { ok: false, error: problem };

  // Aggregate bounds, before anything is stored: a per-staff
  // daily cap, then a cap on total stored banner files.
  const dailyCount = await countBannerUploadsLast24h(admin, user.id);
  if (dailyCount === null) return { ok: false, error: BANNER_GENERIC_ERROR };
  if (dailyCount >= BANNER_DAILY_UPLOAD_LIMIT) {
    return { ok: false, error: `You have reached today's banner upload limit (${BANNER_DAILY_UPLOAD_LIMIT} photos). Try again tomorrow.` };
  }
  const storedCount = await countStoredBannerFiles(admin);
  if (storedCount !== null && storedCount >= BANNER_MAX_STORED_FILES) {
    return { ok: false, error: `The banner photo store is full (${BANNER_MAX_STORED_FILES} photos). Delete an unused banner photo first.` };
  }

  const slug = slugify(kind);
  let path = "";
  try {
    // Crop to the universal wide strip before storing: the raw
    // upload never reaches the bucket. The processed file keeps the
    // input format, so the path extension and content type still
    // come from file.type, as before.
    const processed = await processBannerImage(Buffer.from(await file.arrayBuffer()), file.type);
    path = uploadStoragePath(`banner-${slug}`, processed.contentType);
    const { error } = await admin.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(path, processed.buffer, { contentType: processed.contentType, upsert: false });
    if (error) return { ok: false, error: BANNER_GENERIC_ERROR };
    // Record the upload, so the daily cap counts it. A failed
    // record removes the file again and fails the upload — an
    // unrecorded upload would be invisible to the quota.
    if (!(await recordBannerUpload(admin, user.id))) {
      await removeStorageFileBestEffort(admin, path);
      return { ok: false, error: BANNER_GENERIC_ERROR };
    }
    return { ok: true, file: path };
  } catch {
    // A half-finished upload leaves no orphan: if the file was
    // stored before the failure, remove it again, best effort.
    if (path !== "") await removeStorageFileBestEffort(admin, path);
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
}

export type BannerCleanupResult =
  | { ok: true; removed: number; kept: number }
  | { ok: false; error: string };

/**
 * Sweep banner photo files in Storage that no banner row
 * references and that are older than 24h (audit run-1, finding
 * #13). Staff only, run by hand from the admin Banners tab
 * ("Clean up unused banner photos") — there is no cron, and
 * nothing here runs on a schedule.
 *
 * Only files at the bucket root whose name starts with "banner-"
 * are considered, and a file is removed only when no banners row
 * references its name AND its Storage created_at is older than
 * 24h — a photo uploaded moments ago for a banner still being
 * composed is never swept. A missing or unparseable created_at
 * is never swept either: keeping a file is safer than deleting
 * a fresh one. `removed` counts the files deleted, `kept` the
 * banner files left in place (referenced, too new, or both).
 * A failed list, read or removal returns an error and removes
 * nothing silently.
 */
export async function cleanupOrphanBannerPhotos(): Promise<BannerCleanupResult> {
  const role = await getCallerRole().catch(() => null);
  if (!canManageBanners(role)) return { ok: false, error: BANNER_NOT_ALLOWED_ERROR };
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
  try {
    const { data: files, error: listError } = await admin.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .list("", { limit: 1000, search: "banner-" });
    if (listError || !files) return { ok: false, error: BANNER_GENERIC_ERROR };
    const bannerFiles = files.filter(
      (file) => typeof file.name === "string" && file.name.startsWith("banner-"),
    );
    const { data: rows, error: rowsError } = await admin.from("banners").select("image_path");
    if (rowsError || !rows) return { ok: false, error: BANNER_GENERIC_ERROR };
    const referenced = new Set(
      (rows as Array<{ image_path?: unknown }>)
        .map((row) => row.image_path)
        .filter((value): value is string => typeof value === "string"),
    );
    const cutoff = new Date(Date.now() - BANNER_ORPHAN_AGE_MS).toISOString();
    const orphans = bannerFiles.filter((file) => {
      if (referenced.has(file.name)) return false;
      // Only files old enough to be abandoned. A missing or
      // unparseable timestamp is never swept.
      if (typeof file.created_at !== "string" || file.created_at === "") return false;
      return file.created_at < cutoff;
    });
    if (orphans.length === 0) {
      return { ok: true, removed: 0, kept: bannerFiles.length };
    }
    const names = orphans.map((file) => file.name);
    const { error: removeError } = await admin.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .remove(names);
    if (removeError) return { ok: false, error: BANNER_GENERIC_ERROR };
    return { ok: true, removed: names.length, kept: bannerFiles.length - names.length };
  } catch {
    return { ok: false, error: BANNER_GENERIC_ERROR };
  }
}
