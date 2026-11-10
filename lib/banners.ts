// Banner (hero carousel slide) rules — TechShot.
//
// Pure module, no imports: the exact rules the server actions in
// lib/banners-server.ts enforce and the admin Banners tab renders,
// so tests can import this file directly (Node strips the erasable
// types, as with lib/announcements.ts). Its single value import is
// lib/storage-images.ts (pure, no imports of its own).
//
// A banner is one slide of the home-page hero carousel
// (components/HeroCarousel.tsx, app/page.tsx). It lives in the
// `banners` table (supabase/migrations/0011_banners.sql — applied
// live 2026-11-10; the `kind` column comes from migration 0013,
// written, NOT applied live yet). Staff manage banners in the
// admin panel's Banners tab; only active banners are shown on the
// home page, lowest sort_order first. When no banner is active the
// home page falls back to product slides (lib/hero-slides.ts), so
// the home page never shows an empty hero.
//
// IMAGE-ONLY since the 2026-11-10 redesign: the carousel shows
// just the banner photo — the promotion / offer text must be
// INSIDE the image. The form no longer edits headline, subcopy or
// the button: those columns stay in the database for existing rows
// (never dropped), and the server derives the stored headline from
// the kind ("Promotion banner" / "Offer banner") — it is only the
// slide's alt text, never visible.

import { resolveProductImageSrc } from "./storage-images";

export type BannerKind = "promotion" | "offer";

/** The two banner kinds the admin form offers. */
export const BANNER_KINDS = ["promotion", "offer"] as const;

/** Display labels for the admin kind select. */
export const BANNER_KIND_LABELS: Record<BannerKind, string> = {
  promotion: "Promotion",
  offer: "Offer",
};

export interface Banner {
  id: string;
  /** Storage filename, storage path or https URL; "" means no photo. */
  imagePath: string;
  /** Promotion or offer — which badge the admin list shows. */
  kind: BannerKind;
  /** Alt text for the slide (derived from the kind on write). Never rendered as visible text. */
  headline: string;
  /** Kept in the database for existing rows; unused since the image-only redesign. */
  subcopy: string;
  /** Kept in the database for existing rows; unused since the image-only redesign. */
  ctaLabel: string;
  /** Kept in the database for existing rows; unused since the image-only redesign. */
  ctaHref: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
}

/**
 * The one universal banner-image size, in pixels: every banner
 * photo is displayed as a wide 1600 x 640 cover (not the square
 * 1200 x 1200 product size — a banner is a wide strip, and a square
 * photo would crop away most of itself). Every upload is cropped to
 * exactly this size before it reaches Storage (see
 * lib/banners/process-banner-image.ts). Never hard-code 1600 or 640
 * anywhere else — import these constants, so the display size, the
 * upload crop and the admin warning can never drift apart.
 */
export const BANNER_IMAGE_WIDTH_PX = 1600;
export const BANNER_IMAGE_HEIGHT_PX = 640;

/**
 * The admin-form note about the universal banner size, built from
 * the constants above so the text and the crop always agree. Shown
 * next to the upload control in the admin Banners tab.
 */
export const BANNER_IMAGE_SIZE_NOTE = `Recommended size: ${BANNER_IMAGE_WIDTH_PX} x ${BANNER_IMAGE_HEIGHT_PX} px (wide). Larger images are cropped to this size automatically.`;

/** Default button link for a banner without one (banners.cta_href). Kept for existing rows; the form no longer edits it. */
export const BANNER_DEFAULT_CTA_HREF = "/shop";

/**
 * Validate a banner-form submission. Trims the image path; the
 * kind must be "promotion" or "offer" (missing or unknown defaults
 * to "promotion"); the sort order must be a whole number (0 or
 * more). The server action runs this same check — the browser is
 * never trusted. No headline / subcopy / button is validated any
 * more: the image-only carousel shows none of them, and the
 * server derives the stored headline from the kind. An empty
 * image path is fine: a banner with no photo shows the TechShot
 * logo placeholder, never a blank area.
 */
export function validateBannerInput(input: {
  imagePath: unknown;
  kind: unknown;
  sortOrder: unknown;
  active: unknown;
}):
  | {
      ok: true;
      value: {
        imagePath: string;
        kind: BannerKind;
        sortOrder: number;
        active: boolean;
      };
    }
  | { ok: false; error: string } {
  const imagePath = typeof input.imagePath === "string" ? input.imagePath.trim() : "";
  const kind: BannerKind = input.kind === "offer" ? "offer" : "promotion";
  const sortOrder = typeof input.sortOrder === "number" ? input.sortOrder : Number(input.sortOrder);
  const active = input.active !== false && input.active !== "false" && input.active !== 0;

  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { ok: false, error: "The sort order must be a whole number, 0 or more." };
  }
  return {
    ok: true,
    value: { imagePath, kind, sortOrder, active },
  };
}

/**
 * Sort banners the way the home page shows them: active first is
 * NOT done here (the home page only receives active ones) — this
 * orders by sort_order, lowest first, ties by created_at so the
 * order is stable and matches the database's
 * banners_active_sort_idx. Pure, so the carousel and the admin
 * list share one order.
 */
export function sortBanners(banners: Banner[]): Banner[] {
  return [...banners].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/**
 * Resolve a banner's stored image path to the URL the carousel and
 * the admin preview render (same Storage rule as product photos:
 * lib/storage-images.ts). "" stays "" — the carousel renders the
 * branded logo placeholder instead. Pure: the caller passes the
 * Supabase URL (NEXT_PUBLIC_SUPABASE_URL) or leaves it out when
 * unconfigured.
 */
export function bannerImageSrc(banner: Pick<Banner, "imagePath">, supabaseUrl?: string): string {
  return resolveProductImageSrc(
    banner.imagePath,
    supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}
