// TechShot marketplace — the shared storefront data-cache contract.
//
// One job: the tag names and revalidation helpers for the public
// catalogue + banners cache (Next.js data cache, unstable_cache).
// Both tags live here and nowhere else, so a reader and a writer
// can never disagree on the spelling — a typo'd tag would silently
// serve stale prices forever.
//
//   * "catalog" — the live catalogue (products, categories,
//     subscriptions, flash end, real review aggregates), read by
//     lib/supabase/catalog.ts getCatalog() and refreshed by every
//     write that changes catalogue-visible data:
//       - product create / update / pause / delete
//         (lib/products/actions/shared.ts revalidateProductPages)
//       - order placement — stock is decremented
//         (lib/orders/server/create.ts createSupabaseOrder)
//       - order status changes — cancel / refund / returned restore
//         stock (lib/orders/actions/shared.ts revalidateOrderPages)
//       - a review is submitted — the rating aggregate changes
//         (lib/reviews.ts submitReview)
//   * "banners" — the active hero banners, read by
//     lib/banners-server.ts listActiveBanners() and refreshed by
//     every banner write (create / update / hide / show / delete).
//
// Per-user data is NEVER cached here: cart, checkout, account,
// orders, inbox, admin lists and the review-write eligibility check
// all read live, every visit. Only public, signed-out-readable data
// goes through these tags.
//
// The helpers are plain functions around revalidateTag: they only
// work in a Server Action or Route Handler (every caller above is
// one), and they throw outside one — never call them from a Client
// Component.

import { revalidateTag } from "next/cache";

/** Data-cache tag for the live storefront catalogue. */
export const CATALOG_CACHE_TAG = "catalog";

/** Data-cache tag for the active hero banners. */
export const BANNERS_CACHE_TAG = "banners";

/** Purge the cached catalogue, so the next storefront visit re-reads it once. */
export function revalidateCatalogCache(): void {
  revalidateTag(CATALOG_CACHE_TAG);
}

/** Purge the cached active banners, so the home hero re-reads them. */
export function revalidateBannersCache(): void {
  revalidateTag(BANNERS_CACHE_TAG);
}
