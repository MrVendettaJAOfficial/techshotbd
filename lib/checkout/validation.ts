// Stored-order validation (lib/checkout-store.ts). One job: the
// zod schemas that prove a browser-stored order is really an order
// — crafted localStorage entries that fail validation are dropped.

import { z } from "zod";
import { deliveryFee } from "../pricing";
import type { StoredOrder } from "./types";

// ---------------------------------------------------------------------------
// Orders (browser copy of the orders created at checkout)
//
// A crafted localStorage entry must never render as a fake order:
// stored orders are validated against this schema when read, and
// entries that fail validation are dropped (and the stored list is
// repaired) before anything renders. Live Supabase orders are
// unaffected — mergeOrders() lets the live copy win over the browser
// copy, and listSupabaseOrders() never goes through this schema.
// ---------------------------------------------------------------------------

const orderItemSchema = z.object({
  productId: z.string().min(1),
  title: z.string().min(1),
  variant: z.string().optional(),
  price_poisha: z.number().int().nonnegative(),
  mrp_poisha: z.number().int().nonnegative(),
  image: z.string().optional(),
  quantity: z.number().int().positive(),
});

const addressSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  mobile: z.string(),
  address: z.string(),
  area: z.string(),
  division: z.string(),
  district: z.string(),
  city: z.string(),
  isDefault: z.boolean(),
});

/** A stored order as written by saveOrder(); anything else is not an order. */
export const storedOrderSchema = z.object({
  id: z.string().min(1),
  orderNumber: z.string().min(1),
  items: z.array(orderItemSchema),
  address: addressSchema,
  delivery: z.enum(["standard", "express"]),
  paymentMethod: z.enum(["card", "bkash", "nagad", "cod", "emi"]),
  subtotal_poisha: z.number().int().nonnegative(),
  savings_poisha: z.number().int().nonnegative(),
  couponCode: z.string().nullable(),
  couponDiscount_poisha: z.number().int().nonnegative(),
  deliveryFee_poisha: z.number().int().nonnegative(),
  total_poisha: z.number().int().nonnegative(),
  status: z.enum([
    "pending_payment",
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
    "refunded",
    "returned",
  ]),
  paymentStatus: z.enum(["unpaid", "paid", "failed", "cancelled", "refunded"]),
  // Ownership (test-pay security, 2026-11-12): optional + default
  // null so browser orders saved before these fields existed still
  // validate — they read back as guest orders with no key, exactly
  // as they were placed.
  userId: z.string().nullable().optional().default(null),
  buyerToken: z.string().nullable().optional().default(null),
  cancelNotice: z.enum(["live", "local"]).optional(),
  testMode: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((order, ctx) => {
  // Cross-field consistency (audit low 5, 2026-11-18): per-field
  // shape alone let a crafted localStorage entry claim any totals
  // — items worth ৳119,900 with a subtotal of 100 poisha and a
  // ৳50,000 coupon discount, marked delivered + paid. The totals
  // must reconcile exactly the way checkout computes them
  // (lib/orders/checkout/totals.ts via lib/pricing):
  //   * the lines sum to the subtotal;
  //   * the savings are the compare-at savings on those lines;
  //   * the delivery fee is the pricing rule for the subtotal and
  //     the delivery method (standard ৳60, free at/above ৳999,
  //     express a flat ৳499, nothing for an empty order);
  //   * the total is subtotal minus the discount actually applied
  //     plus the delivery fee, never negative. The stored discount
  //     is the coupon's face value, which may exceed the subtotal
  //     (a database coupon with a low minimum spend) — checkout
  //     clamps what is actually taken off to the subtotal, so the
  //     check clamps the same way instead of rejecting the order.
  // Live Supabase orders mapped by lib/orders/server/list.ts also
  // satisfy these rules: their items carry mrp = price (so their
  // savings are 0, matching the stored 0) and their discount is the
  // clamped amount stored at creation. An entry that fails any
  // check is dropped, exactly like a shape-invalid entry.
  const itemsSum = order.items.reduce((sum, i) => sum + i.price_poisha * i.quantity, 0);
  if (itemsSum !== order.subtotal_poisha) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "items do not sum to the subtotal",
      path: ["subtotal_poisha"],
    });
  }
  const savings = order.items.reduce(
    (sum, i) => sum + (i.mrp_poisha - i.price_poisha) * i.quantity,
    0,
  );
  if (savings !== order.savings_poisha) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "savings do not match the items",
      path: ["savings_poisha"],
    });
  }
  if (deliveryFee(order.subtotal_poisha, order.delivery) !== order.deliveryFee_poisha) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "delivery fee does not match the subtotal and delivery method",
      path: ["deliveryFee_poisha"],
    });
  }
  const appliedDiscount = Math.min(order.couponDiscount_poisha, order.subtotal_poisha);
  const expectedTotal = Math.max(0, order.subtotal_poisha - appliedDiscount + order.deliveryFee_poisha);
  if (expectedTotal !== order.total_poisha) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "total does not match subtotal minus discount plus delivery fee",
      path: ["total_poisha"],
    });
  }
});

/**
 * Validate an unknown value as a list of stored orders. Entries that
 * fail validation are dropped; the caller (listOrders) repairs the
 * stored list so a bad entry cannot reappear on the next read.
 */
export function validateStoredOrders(value: unknown): StoredOrder[] {
  if (!Array.isArray(value)) return [];
  const valid: StoredOrder[] = [];
  for (const entry of value) {
    const parsed = storedOrderSchema.safeParse(entry);
    if (parsed.success) valid.push(parsed.data as StoredOrder);
  }
  return valid;
}
