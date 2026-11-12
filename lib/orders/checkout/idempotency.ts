// Checkout idempotency (lib/orders.ts). One job: find the order a
// checkout attempt already created, and reload it as a StoredOrder.
//
// The client generates one UUID per checkout attempt
// (components/checkout/checkout-form.tsx) and the server stores it
// on the orders row (migration 0014). A repeat submission with the
// same key — double-click, network retry, replayed server action —
// returns the ORIGINAL order instead of inserting a second one and
// decrementing stock twice. The database backstop is the unique
// index on (user_id, idempotency_key) plus the guest partial index;
// this module is the pre-insert lookup and the re-read after a
// unique-violation, so the order is returned even when the
// constraint, not the lookup, caught the duplicate.
//
// Guests have user_id NULL, and Postgres treats NULLs as distinct
// in a UNIQUE constraint, so the guest lookup uses IS NULL (an
// `= NULL` filter would match nothing).
//
// The reload maps a row to the StoredOrder shape the same way
// lib/orders/server/list.ts does (snapshot name split, delivery
// inferred from the delivery charge, discount from the stored
// amount); savings and coupon code are not stored on the row, so
// they read back as 0 / null, exactly as the admin list does. The
// guest buyerToken is NOT stored in the database (there is no
// buyer_token column — it lives in the in-memory order record the
// checkout registers), so a reloaded guest order has buyerToken
// null; app/checkout/page.tsx keeps the in-memory record when one
// exists so a duplicate submission does not lose the key.

import type { SupabaseClient } from "@supabase/supabase-js";
import { EXPRESS_DELIVERY_POISHA } from "../../theme";
import type { OrderItem, StoredOrder } from "../../checkout-store";

const ORDER_RELOAD_COLUMNS =
  "id, order_number, user_id, status, subtotal_poisha, delivery_poisha, discount_poisha, total_poisha, address_snapshot, payment_method, created_at, updated_at, order_items(id, title, price_poisha, quantity, products(slug))";

/** True when a Supabase/PostgREST error is a unique-violation (23505). */
export function isUniqueViolationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "23505") return true;
  return typeof message === "string" && /duplicate key/i.test(message);
}

/**
 * The id of the order already placed for (userId, idempotencyKey),
 * or null. userId null means a guest order — the lookup uses
 * IS NULL, because `eq("user_id", null)` would match nothing.
 */
export async function findOrderByIdempotencyKey(
  admin: SupabaseClient,
  userId: string | null,
  idempotencyKey: string,
): Promise<string | null> {
  if (!idempotencyKey) return null;
  const query = admin
    .from("orders")
    .select("id")
    .eq("idempotency_key", idempotencyKey);
  const { data } = userId
    ? await query.eq("user_id", userId).maybeSingle()
    : await query.is("user_id", null).maybeSingle();
  if (!data) return null;
  return (data as { id: string }).id;
}

/** Latest payments-row status for an order ("unpaid" when there is none). */
async function latestPaymentStatus(
  admin: SupabaseClient,
  orderId: string,
): Promise<StoredOrder["paymentStatus"]> {
  try {
    const { data: payment } = await admin
      .from("payments")
      .select("status")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (payment?.status === "paid") return "paid";
    if (payment?.status === "failed") return "failed";
    if (payment?.status === "refunded") return "refunded";
    return "unpaid";
  } catch {
    return "unpaid";
  }
}

/**
 * Reload one order row (plus its items and latest payment status)
 * as the StoredOrder shape the checkout / order pages use, or null
 * when the row does not exist.
 */
export async function loadStoredOrder(
  admin: SupabaseClient,
  orderId: string,
): Promise<StoredOrder | null> {
  const { data: row } = await admin
    .from("orders")
    .select(ORDER_RELOAD_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (!row) return null;
  const typed = row as unknown as Record<string, unknown>;
  const snapshot = (typed.address_snapshot ?? {}) as Record<string, unknown>;
  const name = typeof snapshot.name === "string" ? snapshot.name : "";
  const [firstName = "", ...rest] = name.split(" ");
  const items = Array.isArray(typed.order_items)
    ? (typed.order_items as Array<Record<string, unknown>>).map((it) => {
        const products = it.products as { slug?: string } | null;
        return {
          productId: products?.slug ?? "",
          title: typeof it.title === "string" ? it.title : "Item",
          price_poisha: typeof it.price_poisha === "number" ? it.price_poisha : 0,
          mrp_poisha: typeof it.price_poisha === "number" ? it.price_poisha : 0,
          quantity: typeof it.quantity === "number" ? it.quantity : 1,
        } as OrderItem;
      })
    : [];
  const paymentMethod = (typeof typed.payment_method === "string"
    ? typed.payment_method
    : "cod") as StoredOrder["paymentMethod"];
  return {
    id: String(typed.id),
    orderNumber: typeof typed.order_number === "string" ? typed.order_number : "",
    items,
    address: {
      id: `addr_${String(typed.id)}`,
      firstName,
      lastName: rest.join(" "),
      email: "",
      mobile: typeof snapshot.phone === "string" ? snapshot.phone : "",
      address: typeof snapshot.full_address === "string" ? snapshot.full_address : "",
      area: "",
      division: typeof snapshot.division === "string" ? snapshot.division : "",
      district: typeof snapshot.district === "string" ? snapshot.district : "",
      city: typeof snapshot.city === "string" ? snapshot.city : "",
      isDefault: false,
    },
    // Delivery is inferred from the delivery charge (there is no
    // delivery_method column): Express is the flat ৳499 charge.
    delivery:
      typeof typed.delivery_poisha === "number" &&
      typed.delivery_poisha === EXPRESS_DELIVERY_POISHA
        ? ("express" as const)
        : ("standard" as const),
    paymentMethod,
    subtotal_poisha: typeof typed.subtotal_poisha === "number" ? typed.subtotal_poisha : 0,
    savings_poisha: 0,
    couponCode: null,
    couponDiscount_poisha:
      typeof typed.discount_poisha === "number" ? typed.discount_poisha : 0,
    deliveryFee_poisha:
      typeof typed.delivery_poisha === "number" ? typed.delivery_poisha : 0,
    total_poisha: typeof typed.total_poisha === "number" ? typed.total_poisha : 0,
    status: typed.status as StoredOrder["status"],
    paymentStatus: await latestPaymentStatus(admin, orderId),
    userId: typeof typed.user_id === "string" ? typed.user_id : null,
    // No buyer_token column on orders: a reloaded guest order has
    // no key (see the header note).
    buyerToken: null,
    testMode: paymentMethod !== "cod",
    createdAt: typeof typed.created_at === "string" ? typed.created_at : new Date().toISOString(),
    updatedAt: typeof typed.updated_at === "string" ? typed.updated_at : new Date().toISOString(),
  };
}
