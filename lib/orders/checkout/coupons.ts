// Coupons for TechShot orders (lib/orders.ts). One job: the
// FIRST2000 coupon rule — validate a code against a subtotal.

import { FIRST2000_MIN_POISHA, FIRST2000_VALUE_POISHA } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Coupons — FIRST2000 only.
// ---------------------------------------------------------------------------

export function validateCoupon(
  code: string | null | undefined,
  subtotal_poisha: number,
): { discount_poisha: number } | { error: string } {
  const normalized = (code ?? "").trim().toUpperCase();
  if (!normalized) return { discount_poisha: 0 };
  if (normalized !== "FIRST2000") return { error: "This coupon code is not valid." };
  if (subtotal_poisha < FIRST2000_MIN_POISHA) {
    return { error: "First order above ৳50,000 only" };
  }
  return { discount_poisha: FIRST2000_VALUE_POISHA };
}

// ---------------------------------------------------------------------------
// Catalog price resolution.
//
// resolveCartLines() turns client cart lines ({slug, variant, quantity})
// into priced order lines. A cart slug is resolved with
// getProductForCartSlug(): the live storefront sells products under
// their Supabase slugs, which are longer than the local seed slugs for
// some products (live `apple-iphone-16-pro-256gb-natural-titanium` vs
// seed `apple-iphone-16-pro`), so an exact match is tried first and then
// the local slug that is a `<slug>-…` prefix of the cart slug. Without
// that step a live product's line was reported as "no longer available"
// and priced at ৳0, which made the cart unusable whenever Supabase was
// configured — the line was in the cart, the badge counted it, but the
// cart page showed it as unavailable and checkout refused it.
//
// The returned line keeps the ORIGINAL cart slug as productId (the live
// slug when Supabase is configured, the seed slug otherwise), so the
// cart page can match lines back to cart items and the server-side
// checkout can re-resolve the same slug against the live database.
// Prices come from the seed product; a variant that matches a storage
// option (compared space- and case-insensitively, so "256GB Natural
// Titanium" matches the "256 GB" option) applies that option's price
// delta and stock. Lines whose slug matches no product at all are
// reported in unknownSlugs and dropped — they must never be charged.
// A product that exists only in the live database (added in the admin,
// no seed counterpart) is NOT resolved here: it is priced from the live
// database by getPricedCartLines in lib/cart-server.ts, which the cart
// page, checkout form and checkout action use when Supabase is
// configured.
// ---------------------------------------------------------------------------
