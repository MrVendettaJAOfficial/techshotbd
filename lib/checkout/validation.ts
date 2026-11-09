// Stored-order validation (lib/checkout-store.ts). One job: the
// zod schemas that prove a browser-stored order is really an order
// — crafted localStorage entries that fail validation are dropped.

import { z } from "zod";
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
  cancelNotice: z.enum(["live", "local"]).optional(),
  testMode: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
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
