// TechShot marketplace — pricing.
// Pure functions, no I/O. All money is integer poisha (100 poisha = 1 BDT).
// Totals are always computed here, on the server, from database prices —
// never trust a total sent by the browser (see the checkout route).
// Delivery and coupon rules come from lib/theme.ts so the storefront and
// the server can never disagree about them.

import {
  EXPRESS_DELIVERY_POISHA,
  FREE_DELIVERY_THRESHOLD_POISHA,
} from "./theme";

export type DeliveryMethod = "standard" | "express";

/** One priced line: the price the server looked up, times the quantity. */
export interface PricingItem {
  price_poisha: number;
  quantity: number;
}

/** The only coupon shape pricing needs: a fixed amount off, with a
 *  minimum subtotal. Look the coupon up in the database first and pass
 *  its stored value / minimum spend in — never trust client input. */
export interface CouponInput {
  value_poisha: number;
  min_spend_poisha: number;
}

export interface Totals {
  /** Sum of price x quantity, before discount and delivery. */
  subtotal: number;
  /** Savings against compare-at prices. Always 0 here: this input has no
   *  compare-at price, so a caller that wants the "you save" figure must
   *  compute it from compare_at_poisha separately. */
  savings: number;
  /** Coupon discount actually applied (0 when no coupon qualifies). */
  discount: number;
  /** Delivery charge. */
  delivery: number;
  /** subtotal - discount + delivery. Never negative. */
  total: number;
}

/** Standard delivery is ৳60 (6000 poisha), free at or above the
 *  threshold in lib/theme.ts. Express is a flat ৳499. An empty cart
 *  costs no delivery. */
export function deliveryFee(
  subtotalPoisha: number,
  method: DeliveryMethod,
): number {
  if (subtotalPoisha <= 0) return 0;
  if (method === "express") return EXPRESS_DELIVERY_POISHA;
  return subtotalPoisha >= FREE_DELIVERY_THRESHOLD_POISHA ? 0 : 6000;
}

export function computeTotals(
  items: PricingItem[],
  coupon: CouponInput | null | undefined,
  delivery: DeliveryMethod,
): Totals {
  const subtotal = items.reduce(
    (sum, item) =>
      sum + Math.max(0, item.price_poisha) * Math.max(0, item.quantity),
    0,
  );

  // A fixed coupon applies only when the pre-discount subtotal reaches
  // its minimum spend, and it can never discount more than the subtotal.
  const discount =
    coupon && subtotal >= coupon.min_spend_poisha
      ? Math.min(Math.max(0, coupon.value_poisha), subtotal)
      : 0;

  const deliveryCharge = deliveryFee(subtotal, delivery);

  return {
    subtotal,
    savings: 0,
    discount,
    delivery: deliveryCharge,
    total: Math.max(0, subtotal - discount + deliveryCharge),
  };
}
