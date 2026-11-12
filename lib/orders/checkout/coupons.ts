// Coupons for TechShot orders (lib/orders.ts). One job: the
// FIRST2000 coupon rule — validate a code against a subtotal — plus
// the database coupon helpers the checkout server action uses.
//
// Two rules live here, and they must not be confused:
//
//   * validateCoupon() — the LOCAL, hardcoded FIRST2000 rule. It is
//     DISPLAY ONLY now: the cart page and the checkout form use it
//     to show the discount before the order is placed. It never
//     decides what a customer is charged.
//   * validateCouponFromDb() — the server-side check. The coupons
//     table is the single source of truth: a code with no DB row is
//     invalid, and a deactivated, expired, over-limit or
//     below-minimum-spend row is invalid, on EVERY checkout path
//     (signed-in and guest alike). The claim helpers below make a
//     limited coupon redeemable at most usage_limit times, even
//     under concurrent checkouts.

import type { SupabaseClient } from "@supabase/supabase-js";
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
// Database coupon check + atomic claim (server only — the caller
// passes its service-role client in, so this module stays free of
// server imports and unit-testable with a fake client).
// ---------------------------------------------------------------------------

/** The coupons-table row a checkout needs, after validation. */
export interface DbCoupon {
  id: string;
  value_poisha: number;
  min_spend_poisha: number;
  /** used_count at read time — the claim below must match it exactly. */
  used_count: number;
}

export type CouponCheckResult =
  | { ok: true; coupon: DbCoupon }
  | { ok: false; error: string };

const INVALID_COUPON = "This coupon code is not valid.";

/**
 * Validate a coupon code against the coupons TABLE (active,
 * unexpired, within its usage limit, minimum spend reached). A code
 * with no row is invalid — there is no hardcoded fallback, so
 * deleting (or deactivating / expiring) the row retires the coupon
 * for every checkout path, guest included.
 */
export async function validateCouponFromDb(
  admin: SupabaseClient,
  code: string | null | undefined,
  subtotal_poisha: number,
): Promise<CouponCheckResult> {
  const normalized = (code ?? "").trim().toUpperCase();
  if (!normalized) return { ok: false, error: INVALID_COUPON };
  const { data: coupon } = await admin
    .from("coupons")
    .select("id, value_poisha, min_spend_poisha, is_active, expires_at, usage_limit, used_count")
    .eq("code", normalized)
    .maybeSingle();
  if (!coupon) return { ok: false, error: INVALID_COUPON };
  const usable =
    coupon.is_active &&
    (!coupon.expires_at || new Date(coupon.expires_at) > new Date()) &&
    (coupon.usage_limit == null || (coupon.used_count ?? 0) < coupon.usage_limit) &&
    subtotal_poisha >= coupon.min_spend_poisha;
  if (!usable) return { ok: false, error: INVALID_COUPON };
  return {
    ok: true,
    coupon: {
      id: coupon.id as string,
      value_poisha: coupon.value_poisha as number,
      min_spend_poisha: coupon.min_spend_poisha as number,
      used_count: (coupon.used_count ?? 0) as number,
    },
  };
}

/**
 * Claim one redemption of a coupon ATOMICALLY, before the order is
 * inserted: a single conditional update that only lands when the row
 * still holds the used_count the reader saw. Two concurrent
 * checkouts for a usage_limit=1 coupon cannot both claim it — the
 * loser sees 0 rows affected and the order fails instead of
 * double-redeeming. (The database CHECK from migration 0014,
 * used_count <= usage_limit, is the backstop.) Returns true only
 * when exactly one row was claimed.
 */
export async function claimCouponAtomically(
  admin: SupabaseClient,
  couponId: string,
  expectedUsedCount: number,
): Promise<boolean> {
  const { data, error } = await admin
    .from("coupons")
    .update({ used_count: expectedUsedCount + 1 })
    .eq("id", couponId)
    .eq("used_count", expectedUsedCount)
    .select("id");
  if (error) return false;
  return Array.isArray(data) && data.length === 1;
}

/**
 * Give a claim back: decrement used_count by one, again
 * conditionally on the value just read, so a concurrent checkout's
 * claim is never clobbered. Called when the order fails AFTER the
 * claim (insert / items / stock failure) — the rollback path in
 * lib/orders/server/create.ts. Best effort: false means the count
 * may be one high (the coupon, not the order, is affected).
 */
export async function releaseCouponClaim(
  admin: SupabaseClient,
  couponId: string,
): Promise<boolean> {
  const { data: row } = await admin
    .from("coupons")
    .select("id, used_count")
    .eq("id", couponId)
    .maybeSingle();
  if (!row || typeof row.used_count !== "number" || row.used_count <= 0) return false;
  const current = row.used_count as number;
  const { data, error } = await admin
    .from("coupons")
    .update({ used_count: current - 1 })
    .eq("id", couponId)
    .eq("used_count", current)
    .select("id");
  if (error) return false;
  return Array.isArray(data) && data.length === 1;
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
