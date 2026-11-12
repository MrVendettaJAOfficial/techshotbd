// Order totals for TechShot (lib/orders.ts). One job: subtotal /
// savings / delivery / total from priced lines, order numbers,
// order summaries, and the test-payment outcome translation.

import { computeTotals as pricingComputeTotals } from "@/lib/pricing";
import type { DeliveryOption, OrderItem, OrderStatus, PaymentMethod, PaymentStatus, StoredOrder } from "@/lib/checkout-store";
import { validateCoupon } from "./coupons";
import { resolveCartLines, type CheckoutCartItem } from "./validation";

/** Standard delivery fee when the order is below the free-delivery threshold (৳60). */
export const STANDARD_DELIVERY_POISHA = 6000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrderSummary {
  orderNumber: string;
  items: OrderItem[];
  subtotal_poisha: number;
  savings_poisha: number;
  couponCode: string | null;
  couponDiscount_poisha: number;
  deliveryFee_poisha: number;
  total_poisha: number;
  delivery: DeliveryOption;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  testMode: boolean;
}

export interface CheckoutTotals {
  items: OrderItem[];
  subtotal_poisha: number;
  savings_poisha: number;
  couponCode: string | null;
  couponDiscount_poisha: number;
  couponError?: string;
  /** Slugs that are not in the catalog (stale cart lines). */
  errors?: string[];
  deliveryFee_poisha: number;
  total_poisha: number;
}

// ---------------------------------------------------------------------------
// Order number
// ---------------------------------------------------------------------------

/** Format: TS-YYYYMMDD-XXXX (XXXX = random 4 digits). */

/** Format: TS-YYYYMMDD-XXXX (XXXX = random 4 digits). */
export function createOrderNumber(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const random = String(Math.floor(1000 + Math.random() * 9000));
  return `TS-${y}${m}${d}-${random}`;
}

// ---------------------------------------------------------------------------
// Totals. computeTotals is the synchronous pricing wrapper used for
// display: lib/pricing computeTotals does subtotal / discount / delivery
// / total, and savings against compare-at prices are computed here from
// the resolved lines. computeCheckoutTotals is the async server-side
// recompute used at checkout: it re-prices every line from the catalog
// via resolveCartLines() — never from a total submitted by the browser.
// ---------------------------------------------------------------------------
export function computeTotals(
  items: OrderItem[],
  delivery: DeliveryOption,
  couponDiscount_poisha: number,
): {
  subtotal_poisha: number;
  savings_poisha: number;
  deliveryFee_poisha: number;
  total_poisha: number;
} {
  const priced = pricingComputeTotals(
    items,
    couponDiscount_poisha > 0
      ? { value_poisha: couponDiscount_poisha, min_spend_poisha: 0 }
      : null,
    delivery,
  );
  const savings_poisha = items.reduce(
    (sum, i) => sum + (i.mrp_poisha - i.price_poisha) * i.quantity,
    0,
  );
  return {
    subtotal_poisha: priced.subtotal,
    savings_poisha,
    deliveryFee_poisha: priced.delivery,
    total_poisha: priced.total,
  };
}

export async function computeCheckoutTotals(
  cartItems: CheckoutCartItem[],
  couponCode: string | null | undefined,
  delivery: DeliveryOption,
): Promise<CheckoutTotals> {
  const { lines: items, unknownSlugs } = resolveCartLines(cartItems);
  return computeCheckoutTotalsFromLines(items, unknownSlugs, couponCode, delivery);
}

/**
 * The same totals, from already-priced lines. The checkout action
 * uses this with the live-resolved lines from getPricedCartLines
 * (lib/cart-server.ts) so a guest checking out while Supabase is
 * configured is priced from the live database, not the seed catalogue.
 * `unknownSlugs` are the slugs the resolver could not price.
 */
export function computeCheckoutTotalsFromLines(
  items: OrderItem[],
  unknownSlugs: string[],
  couponCode: string | null | undefined,
  delivery: DeliveryOption,
): CheckoutTotals {
  const subtotal_poisha = items.reduce((sum, i) => sum + i.price_poisha * i.quantity, 0);
  const normalizedCode = (couponCode ?? "").trim().toUpperCase() || null;
  let couponDiscount_poisha = 0;
  let couponError: string | undefined;
  if (normalizedCode) {
    const result = validateCoupon(normalizedCode, subtotal_poisha);
    if ("discount_poisha" in result) couponDiscount_poisha = result.discount_poisha;
    else couponError = result.error;
  }
  const { savings_poisha, deliveryFee_poisha, total_poisha } = computeTotals(
    items,
    delivery,
    couponDiscount_poisha,
  );
  return {
    items,
    subtotal_poisha,
    savings_poisha,
    couponCode: normalizedCode,
    couponDiscount_poisha,
    couponError,
    errors:
      unknownSlugs.length > 0
        ? unknownSlugs.map((slug) => `Product “${slug}” is no longer available.`)
        : undefined,
    deliveryFee_poisha,
    total_poisha,
  };
}

/** Stock check against the catalog. Unknown products pass (no stock data). */

export function toOrderSummary(order: StoredOrder): OrderSummary {
  return {
    orderNumber: order.orderNumber,
    items: order.items,
    subtotal_poisha: order.subtotal_poisha,
    savings_poisha: order.savings_poisha,
    couponCode: order.couponCode,
    couponDiscount_poisha: order.couponDiscount_poisha,
    deliveryFee_poisha: order.deliveryFee_poisha,
    total_poisha: order.total_poisha,
    delivery: order.delivery,
    paymentMethod: order.paymentMethod,
    status: order.status,
    paymentStatus: order.paymentStatus,
    testMode: order.testMode,
  };
}

// ---------------------------------------------------------------------------
// Test payment outcomes. The test adapter's status vocabulary is
// "paid" | "failed" | "cancelled"; the checkout UI uses
// "success" | "failed" | "cancelled". These helpers translate between
// the two — verification itself is done by lib/payments/test-adapter
// (testAdapter.verifyCallback) in the server files, never here, so this
// module stays importable from client components.
// ---------------------------------------------------------------------------

export type PaymentOutcome = "success" | "failed" | "cancelled";
export type AdapterPaymentStatus = "paid" | "failed" | "cancelled";

export function outcomeToAdapterStatus(outcome: PaymentOutcome): AdapterPaymentStatus {
  return outcome === "success" ? "paid" : outcome;
}

export function adapterStatusToOutcome(status: AdapterPaymentStatus): PaymentOutcome {
  return status === "paid" ? "success" : status;
}

/** Order status patch for a verified test-payment outcome. */
export function applyPaymentOutcome(
  outcome: PaymentOutcome,
): Pick<StoredOrder, "status" | "paymentStatus"> {
  if (outcome === "success") return { status: "confirmed", paymentStatus: "paid" };
  if (outcome === "failed") return { status: "pending_payment", paymentStatus: "failed" };
  return { status: "cancelled", paymentStatus: "cancelled" };
}

/**
 * Whether a test-payment outcome may be applied to an order in its
 * CURRENT state. The only legal moves from a payment page are out of
 * pending_payment: success confirms + pays (never a COD order — COD
 * is confirmed + unpaid by design and never gains a paid row, and
 * never an already-paid order), failed leaves it pending (retryable),
 * cancelled cancels it (never a paid order — a paid order is
 * refunded through the admin / cancel path, never cancelled here).
 * A COD order takes no payment step at all: every outcome is
 * refused for it, so a COD order can never be flipped to
 * pending_payment or gain any payments row. Every other combination
 * is refused and nothing is applied, so a cancelled order can never
 * be resurrected, a paid order can never be cancelled or double-paid,
 * and the memory record can never diverge from the database. Pure
 * and unit-tested (see tests/test-pay-security.test.mjs).
 */
export function isLegalTestPaymentOutcome(
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  paymentMethod: PaymentMethod,
  outcome: PaymentOutcome,
): boolean {
  if (paymentMethod === "cod") return false;
  if (status !== "pending_payment") return false;
  if (outcome === "success") {
    // COD is already refused above, so only the paid check remains.
    return paymentStatus !== "paid";
  }
  if (outcome === "failed") return true;
  return paymentStatus !== "paid";
}

/** Query-string value used after test payment: success | failed | cancelled. */
export function paymentQueryToOutcome(value: string | null): PaymentOutcome | null {
  if (value === "success" || value === "failed" || value === "cancelled") return value;
  return null;
}

