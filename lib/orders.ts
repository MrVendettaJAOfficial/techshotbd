// Server-side order helpers for TechShot.
//
// Wired to the real modules: prices come from lib/data/catalog
// (getProduct) and totals from lib/pricing (computeTotals). The
// browser-submitted total is NEVER trusted: the client never sends a
// total at all — the server re-prices every line from the catalog here.
// Payment verification lives in lib/payments/test-adapter and is called
// directly by the server files that need it (checkout page action,
// test-pay page, payments callback route); it is NOT imported here,
// because this module is also imported by client components and the
// adapter uses node:crypto.
//
// Persistence note: orders are kept in a module-level in-memory Map in
// this preview. Signed-in users with Supabase configured get real
// orders instead: lib/orders-server.ts createSupabaseOrder() writes to
// the Supabase `orders` / `order_items` tables (re-pricing from live
// DB prices, checking stock, decrementing it, rolling back on failure)
// and returns the same StoredOrder shape; the checkout page registers
// that order here too, so the test-pay / confirmation pages — which
// read this store — keep working. The in-memory store is the fallback
// for guests and for unconfigured Supabase.

import { z } from "zod";
import {
  FIRST2000_MIN_POISHA,
  FIRST2000_VALUE_POISHA,
} from "@/lib/theme";
import { getProductForCartSlug } from "@/lib/data/catalog";
import { variantMatchesOption } from "@/lib/catalog-rules";
import { computeTotals as pricingComputeTotals } from "@/lib/pricing";
import type {
  Address,
  DeliveryOption,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  StoredOrder,
} from "@/lib/checkout-store";

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

/** One line as the client cart holds it (lib/cart-store CartItem shape). */
export interface CheckoutCartItem {
  slug: string;
  variant?: string;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Order number
// ---------------------------------------------------------------------------

/** Format: TS-YYYYMMDD-XXXX (XXXX = random 4 digits). */
export function createOrderNumber(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const random = String(Math.floor(1000 + Math.random() * 9000));
  return `TS-${y}${m}${d}-${random}`;
}

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

export function resolveCartLines(items: CheckoutCartItem[]): {
  lines: OrderItem[];
  unknownSlugs: string[];
} {
  const lines: OrderItem[] = [];
  const unknownSlugs: string[] = [];
  for (const item of items) {
    const product = getProductForCartSlug(item.slug);
    if (!product) {
      unknownSlugs.push(item.slug);
      continue;
    }
    const option = product.storageOptions?.find(
      (o) => variantMatchesOption(item.variant, o.label),
    );
    const delta = option?.priceDeltaPoisha ?? 0;
    lines.push({
      productId: item.slug,
      title: product.title,
      variant: item.variant ?? product.variant,
      price_poisha: product.price_poisha + delta,
      mrp_poisha: product.compare_at_poisha + delta,
      image: product.image,
      quantity: Math.max(1, item.quantity),
    });
  }
  return { lines, unknownSlugs };
}

function stockFor(item: OrderItem): number | null {
  const product = getProductForCartSlug(item.productId);
  if (!product) return null;
  const option = product.storageOptions?.find(
    (o) => variantMatchesOption(item.variant, o.label),
  );
  return option?.stock ?? product.stock;
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
export function validateStock(
  items: OrderItem[],
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const item of items) {
    const stock = stockFor(item);
    if (stock !== null && item.quantity > stock) {
      errors.push(
        `${item.title}: only ${stock} in stock, you asked for ${item.quantity}.`,
      );
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Checkout address validation (shared by the server action and the client
// form so both enforce exactly the same rules).
// ---------------------------------------------------------------------------

export const addressSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  email: z.string().trim().email("Enter a valid email address."),
  mobile: z
    .string()
    .trim()
    .regex(/^(\+880|0)?1[3-9]\d{8}$/, "Enter a valid Bangladeshi mobile number, e.g. 01XXXXXXXXX."),
  address: z.string().trim().min(1, "Street address is required."),
  area: z.string().trim().min(1, "Area / locality is required."),
  division: z.string().trim().min(1, "Division is required."),
  district: z.string().trim().min(1, "District is required."),
  city: z.string().trim().min(1, "City is required."),
  billingSame: z.boolean(),
});

export type AddressInput = z.infer<typeof addressSchema>;

export interface PlaceOrderInput {
  items: CheckoutCartItem[];
  couponCode: string | null;
  delivery: DeliveryOption;
  paymentMethod: PaymentMethod;
  address: AddressInput;
}

export type PlaceOrderResult =
  | { ok: true; order: StoredOrder; redirectTo: string }
  | { ok: false; errors: Record<string, string>; message: string };

export function toAddressSnapshot(input: AddressInput, id: string): Address {
  return {
    id,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    mobile: input.mobile,
    address: input.address,
    area: input.area,
    division: input.division,
    district: input.district,
    city: input.city,
    isDefault: false,
  };
}

// ---------------------------------------------------------------------------
// In-memory order store (preview only — see header note). Production must
// use Supabase orders / cart_items in a database transaction.
// ---------------------------------------------------------------------------

const memoryOrders = new Map<string, StoredOrder>();

export function createOrderRecord(order: StoredOrder): StoredOrder {
  memoryOrders.set(order.id, order);
  return order;
}

export function getOrderRecord(id: string): StoredOrder | null {
  return memoryOrders.get(id) ?? null;
}

export function listOrderRecords(): StoredOrder[] {
  return [...memoryOrders.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function updateOrderRecordStatus(
  id: string,
  patch: Partial<Pick<StoredOrder, "status" | "paymentStatus">>,
): StoredOrder | null {
  const order = memoryOrders.get(id);
  if (!order) return null;
  const updated: StoredOrder = { ...order, ...patch, updatedAt: new Date().toISOString() };
  memoryOrders.set(id, updated);
  return updated;
}

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

/** Query-string value used after test payment: success | failed | cancelled. */
export function paymentQueryToOutcome(value: string | null): PaymentOutcome | null {
  if (value === "success" || value === "failed" || value === "cancelled") return value;
  return null;
}

// (No re-exports: theme thresholds are imported directly where needed.)
