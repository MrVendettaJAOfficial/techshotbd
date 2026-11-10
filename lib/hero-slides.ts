// Hero carousel slides — TechShot.
//
// Pure builders for the home-page hero carousel
// (components/HeroCarousel.tsx, app/page.tsx). One shared slide
// shape, two sources:
//   * admin banners (banners table, migration 0011) —
//     bannerToSlide, used when at least one banner is active;
//   * the top products — productToFallbackSlide, used when NO
//     banner is active, so the home page never shows an empty
//     hero.
//
// IMAGE-ONLY since the 2026-11-10 redesign: a slide is just an
// image plus its alt text. The carousel shows the photo and
// nothing else — no headline, subcopy, button or price text.
// The banner headline survives only as the alt text (banner
// slides), the product title as the alt text (fallback slides).
//
// The slide image is resolved through lib/storage-images.ts (a
// Storage filename / legacy path / https URL becomes its public
// URL; "" stays "" and the carousel renders the branded logo
// placeholder instead — never a blank area).

import { resolveProductImageSrc } from "./storage-images";
import type { Banner } from "./banners";
import type { Product } from "./data/catalog";

/** One hero carousel slide: an image and its alt text, nothing else. */
export interface HeroSlide {
  /** Resolved image URL, or "" for the logo placeholder. */
  image: string;
  /** Alt text: the banner headline, or the product title. Never rendered as visible text. */
  alt: string;
}

/** Turn an admin banner into a carousel slide. */
export function bannerToSlide(banner: Banner, supabaseUrl?: string): HeroSlide {
  return {
    image: resolveProductImageSrc(
      banner.imagePath,
      supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    alt: banner.headline === "" ? "Promotion banner" : banner.headline,
  };
}

/**
 * Turn a product into a fallback carousel slide: the product
 * photo, alt text the product title.
 */
export function productToFallbackSlide(product: Product): HeroSlide {
  return {
    image: product.image,
    alt: product.title,
  };
}

/**
 * The fallback slides for the home page: the top three products.
 * Fewer than three products still yields a slide per product —
 * the carousel handles one slide (no arrows, no dots, no timer)
 * exactly like the gallery does with one photo.
 * `categoryNameFor` is kept for the caller's shape but no longer
 * used — nothing of a product's category is shown any more.
 */
export function fallbackSlides(
  products: Product[],
  _categoryNameFor?: (slug: string) => string,
): HeroSlide[] {
  return products.slice(0, 3).map((product) => productToFallbackSlide(product));
}
