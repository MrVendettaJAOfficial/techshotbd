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
// `banners` table (supabase/migrations/0011_banners.sql — NOT
// applied live yet; see that file). Staff manage banners in the
// admin panel's Banners tab; only active banners are shown on the
// home page, lowest sort_order first. When no banner is active the
// home page falls back to product slides (lib/hero-slides.ts), so
// the home page never shows an empty hero.

import { resolveProductImageSrc } from "./storage-images";

export interface Banner {
  id: string;
  /** Storage filename, storage path or https URL; "" means no photo. */
  imagePath: string;
  headline: string;
  subcopy: string;
  ctaLabel: string;
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

/** Longest banner headline, in characters (banners.headline). */
export const BANNER_HEADLINE_MAX = 120;
/** Longest banner subcopy, in characters (banners.subcopy). */
export const BANNER_SUBCOPY_MAX = 300;
/** Longest banner button label, in characters (banners.cta_label). */
export const BANNER_CTA_LABEL_MAX = 40;

/** Default button link for a banner without one (banners.cta_href). */
export const BANNER_DEFAULT_CTA_HREF = "/shop";

/**
 * True for a safe banner button link: an internal path starting
 * with a single "/" (e.g. /shop, /shop?category=gaming,
 * /product/<slug>). Protocol-relative ("//evil.com") and absolute
 * URLs are rejected — a banner button never leaves the site, so a
 * mistyped link cannot send shoppers elsewhere.
 */
export function isSafeBannerHref(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

/**
 * Validate a banner-form submission. Trims the text fields; the
 * headline must be 1–120 characters, the subcopy 0–300, the button
 * label 0–40, and the link an internal path (see isSafeBannerHref).
 * The sort order must be a whole number (0 or more). The server
 * action runs this same check — the browser is never trusted.
 * An empty image path is fine: a banner with no photo shows the
 * TechShot logo placeholder, never a blank area.
 */
export function validateBannerInput(input: {
  imagePath: unknown;
  headline: unknown;
  subcopy: unknown;
  ctaLabel: unknown;
  ctaHref: unknown;
  sortOrder: unknown;
  active: unknown;
}):
  | {
      ok: true;
      value: {
        imagePath: string;
        headline: string;
        subcopy: string;
        ctaLabel: string;
        ctaHref: string;
        sortOrder: number;
        active: boolean;
      };
    }
  | { ok: false; error: string } {
  const imagePath = typeof input.imagePath === "string" ? input.imagePath.trim() : "";
  const headline = typeof input.headline === "string" ? input.headline.trim() : "";
  const subcopy = typeof input.subcopy === "string" ? input.subcopy.trim() : "";
  const ctaLabel = typeof input.ctaLabel === "string" ? input.ctaLabel.trim() : "";
  const ctaHrefRaw = typeof input.ctaHref === "string" ? input.ctaHref.trim() : "";
  const ctaHref = ctaHrefRaw === "" ? BANNER_DEFAULT_CTA_HREF : ctaHrefRaw;
  const sortOrder = typeof input.sortOrder === "number" ? input.sortOrder : Number(input.sortOrder);
  const active = input.active !== false && input.active !== "false" && input.active !== 0;

  if (headline.length === 0) return { ok: false, error: "Please enter a headline." };
  if (headline.length > BANNER_HEADLINE_MAX) {
    return {
      ok: false,
      error: `The headline must be ${BANNER_HEADLINE_MAX} characters or fewer.`,
    };
  }
  if (subcopy.length > BANNER_SUBCOPY_MAX) {
    return {
      ok: false,
      error: `The subcopy must be ${BANNER_SUBCOPY_MAX} characters or fewer.`,
    };
  }
  if (ctaLabel.length > BANNER_CTA_LABEL_MAX) {
    return {
      ok: false,
      error: `The button label must be ${BANNER_CTA_LABEL_MAX} characters or fewer.`,
    };
  }
  if (!isSafeBannerHref(ctaHref)) {
    return {
      ok: false,
      error: "The button link must be a page on this site, starting with \"/\" (e.g. /shop).",
    };
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { ok: false, error: "The sort order must be a whole number, 0 or more." };
  }
  return {
    ok: true,
    value: { imagePath, headline, subcopy, ctaLabel, ctaHref, sortOrder, active },
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
