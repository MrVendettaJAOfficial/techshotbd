// Hero carousel slides — TechShot.
//
// Pure builders for the home-page hero carousel
// (components/HeroCarousel.tsx, app/page.tsx). One shared slide
// shape, two sources:
//   * admin banners (banners table, migration 0011) —
//     bannerToSlide, used when at least one banner is active;
//   * the top products — productToFallbackSlide, used when NO
//     banner is active, so the home page never shows an empty
//     hero. The fallback keeps the old hero's shape: headline +
//     subcopy + "Shop now" on the left, the product photo on the
//     right with a price chip where the old "A18 Pro chip" badge
//     sat. The old hero was static with a decorative "01 / 03"
//     pager; the fallback is a real 3-slide carousel over the same
//     top three products.
//
// The slide image is resolved through lib/storage-images.ts (a
// Storage filename / legacy path / https URL becomes its public
// URL; "" stays "" and the carousel renders the branded logo
// placeholder instead — never a blank area).

import { formatBDT } from "./theme";
import { resolveProductImageSrc } from "./storage-images";
import type { Banner } from "./banners";
import type { Product } from "./data/catalog";

/** One hero carousel slide: image + text + button + optional chip. */
export interface HeroSlide {
  /** Resolved image URL, or "" for the logo placeholder. */
  image: string;
  /** Small eyebrow above the headline (category name, or TechShot). */
  eyebrow: string;
  headline: string;
  subcopy: string;
  /** Button label; "" hides the button. */
  ctaLabel: string;
  /** Button link; always an internal path. */
  ctaHref: string;
  /** Small chip shown on the photo (fallback slides: the price). */
  priceChip?: string;
}

/** The eyebrow on admin banner slides — the brand, not a category. */
export const BANNER_SLIDE_EYEBROW = "TechShot";

/** Turn an admin banner into a carousel slide. */
export function bannerToSlide(banner: Banner, supabaseUrl?: string): HeroSlide {
  return {
    image: resolveProductImageSrc(
      banner.imagePath,
      supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    eyebrow: BANNER_SLIDE_EYEBROW,
    headline: banner.headline,
    subcopy: banner.subcopy,
    ctaLabel: banner.ctaLabel,
    ctaHref: banner.ctaHref === "" ? "/shop" : banner.ctaHref,
  };
}

/**
 * Turn a product into a fallback carousel slide. `categoryName` is
 * the product's category display name (e.g. "Smartphones") — the
 * eyebrow. The subcopy is the description's first sentence, so a
 * long description never floods the slide; a product with no
 * description falls back to the site tagline. The price chip sits
 * on the photo.
 */
export function productToFallbackSlide(product: Product, categoryName?: string): HeroSlide {
  const firstSentence = (product.description.split(/(?<=\.)\s+/)[0] ?? "").trim();
  return {
    image: product.image,
    eyebrow: categoryName ?? product.category,
    headline: product.title,
    subcopy:
      firstSentence !== ""
        ? firstSentence
        : "Flagship tech — 100% genuine, with official warranty and free delivery across Bangladesh on orders above ৳999.",
    ctaLabel: "Shop now",
    ctaHref: `/product/${product.slug}`,
    priceChip: `Starting ${formatBDT(product.price_poisha)}`,
  };
}

/**
 * The fallback slides for the home page: the top three products
 * (the same three the old static hero paged through as "01 / 03").
 * Fewer than three products still yields a slide per product —
 * the carousel handles one slide (no arrows, no dots, no timer)
 * exactly like the gallery does with one photo.
 */
export function fallbackSlides(products: Product[], categoryNameFor: (slug: string) => string): HeroSlide[] {
  return products.slice(0, 3).map((product) => productToFallbackSlide(product, categoryNameFor(product.category)));
}
