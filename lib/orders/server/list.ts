"use server";

// List Supabase orders (lib/orders-server.ts). One job: map live
// order rows to the StoredOrder shape the order pages use — the
// admin list (staff only) and the signed-in customer's own list.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "../../supabase/server";
import { getCallerRole } from "../../auth-server/session";
import { isStaff } from "../../roles";
import { EXPRESS_DELIVERY_POISHA } from "../../theme";
import type { OrderItem, StoredOrder } from "../../checkout-store";
import { getSignedInUserId, isConfigured, untyped } from "./shared";

const ORDER_COLUMNS =
  "id, order_number, user_id, status, subtotal_poisha, delivery_poisha, discount_poisha, total_poisha, address_snapshot, payment_method, created_at, updated_at, order_items(id, title, price_poisha, quantity, products(slug))";

/** Map one Supabase orders row to the StoredOrder shape the order pages use. */
function toStoredOrder(
  row: Record<string, unknown>,
  paymentStatus: StoredOrder["paymentStatus"],
): StoredOrder {
  const snapshot = (row.address_snapshot ?? {}) as Record<string, unknown>;
  const name = typeof snapshot.name === "string" ? snapshot.name : "";
  const [firstName = "", ...rest] = name.split(" ");
  const items = Array.isArray(row.order_items)
    ? (row.order_items as Array<Record<string, unknown>>).map((it) => {
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
  return {
    id: String(row.id),
    orderNumber: typeof row.order_number === "string" ? row.order_number : "",
    items,
    address: {
      id: `addr_${String(row.id)}`,
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
    // Delivery method is NOT stored on the orders table (there is no
    // delivery_method column — see ORDER_COLUMNS): it is inferred from
    // the delivery charge. Express is a flat ৳499 (49900 poisha,
    // lib/theme.ts); standard is ৳60 or free over ৳999, so any other
    // charge is standard. Savings and coupon code are likewise not
    // stored (order_items keeps price only, no compare-at price, and
    // orders keeps the discount amount only, no code): savings stays 0
    // and couponCode stays null rather than inventing values, while
    // couponDiscount_poisha below is the real stored discount.
    delivery:
      typeof row.delivery_poisha === "number" && row.delivery_poisha === EXPRESS_DELIVERY_POISHA
        ? ("express" as const)
        : ("standard" as const),
    paymentMethod: (typeof row.payment_method === "string"
      ? row.payment_method
      : "cod") as StoredOrder["paymentMethod"],
    subtotal_poisha: typeof row.subtotal_poisha === "number" ? row.subtotal_poisha : 0,
    savings_poisha: 0,
    couponCode: null,
    couponDiscount_poisha:
      typeof row.discount_poisha === "number" ? row.discount_poisha : 0,
    deliveryFee_poisha:
      typeof row.delivery_poisha === "number" ? row.delivery_poisha : 0,
    total_poisha: typeof row.total_poisha === "number" ? row.total_poisha : 0,
    status: row.status as StoredOrder["status"],
    paymentStatus,
    // The database keeps no guest key (there is no buyer_token
    // column): a live order always belongs to a signed-in user, so
    // the session proves ownership and the key stays null. userId
    // comes from the row so callers can tell whose order this is.
    userId: typeof row.user_id === "string" ? row.user_id : null,
    buyerToken: null,
    testMode: false,
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
  } as StoredOrder;
}

/**
 * Every Supabase order, newest first, for the admin dashboard. Staff
 * only: the caller must be signed in with a staff role (owner,
 * co-admin or manager — lib/roles.ts isStaff), otherwise this
 * returns []. Managers are read-only on orders, but they still need
 * to SEE them: the change gate lives in lib/orders/actions.ts, not
 * here. Empty when Supabase is not configured. The
 * payment status comes from each order's latest payments row, so the
 * admin page can offer a refund only for paid orders.
 */
export async function listAdminOrders(): Promise<StoredOrder[]> {
  if (!isConfigured()) return [];
  // Staff check reuses getCallerRole() — the same per-request
  // cached profiles read the admin page already did — instead of
  // a second profiles query. The role is still re-read from the
  // database on every request (React cache() is per-request only);
  // the gate itself is unchanged.
  const role = await getCallerRole();
  if (!isStaff(role)) return [];
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return [];
  }
  const { data: rows, error } = await admin
    .from("orders")
    .select(ORDER_COLUMNS)
    .order("created_at", { ascending: false });
  if (error || !rows) return [];
  const typedRows = rows as unknown as Array<Record<string, unknown>>;
  const orderIds = typedRows.map((row) => String(row.id));
  const paymentByOrder = new Map<string, StoredOrder["paymentStatus"]>();
  if (orderIds.length > 0) {
    try {
      const { data: payments } = await admin
        .from("payments")
        .select("order_id, status, created_at")
        .in("order_id", orderIds)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      for (const payment of (payments ?? []) as Array<Record<string, unknown>>) {
        const orderId = String(payment.order_id);
        if (paymentByOrder.has(orderId)) continue;
        if (payment.status === "paid") paymentByOrder.set(orderId, "paid");
        else if (payment.status === "failed") paymentByOrder.set(orderId, "failed");
        else if (payment.status === "refunded") paymentByOrder.set(orderId, "refunded");
      }
    } catch {
      // No payment rows readable: every order reads as unpaid.
    }
  }
  return typedRows.map((row) =>
    toStoredOrder(row, paymentByOrder.get(String(row.id)) ?? "unpaid"),
  );
}

/**
 * The signed-in user's Supabase orders, newest first, in the same
 * StoredOrder shape the browser order list uses. Empty when Supabase
 * is not configured or nobody is signed in. (Read with the
 * request-scoped client, so RLS limits it to the caller's own orders.)
 * The payment status comes from each order's latest payments row,
 * exactly as listAdminOrders does — never a hardcoded "unpaid".
 */
export async function listSupabaseOrders(): Promise<StoredOrder[]> {
  if (!isConfigured()) return [];
  const userId = await getSignedInUserId();
  if (!userId) return [];
  let supabase: SupabaseClient;
  try {
    supabase = untyped(createClient());
  } catch {
    return [];
  }
  const { data: rows, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error || !rows) return [];
  const typedRows = rows as unknown as Array<Record<string, unknown>>;
  const orderIds = typedRows.map((row) => String(row.id));
  const paymentByOrder = new Map<string, StoredOrder["paymentStatus"]>();
  if (orderIds.length > 0) {
    try {
      const { data: payments } = await supabase
        .from("payments")
        .select("order_id, status, created_at")
        .in("order_id", orderIds)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      for (const payment of (payments ?? []) as Array<Record<string, unknown>>) {
        const orderId = String(payment.order_id);
        if (paymentByOrder.has(orderId)) continue;
        if (payment.status === "paid") paymentByOrder.set(orderId, "paid");
        else if (payment.status === "failed") paymentByOrder.set(orderId, "failed");
        else if (payment.status === "refunded") paymentByOrder.set(orderId, "refunded");
      }
    } catch {
      // No payment rows readable: every order reads as unpaid.
    }
  }
  return typedRows.map((row) =>
    toStoredOrder(row, paymentByOrder.get(String(row.id)) ?? "unpaid"),
  );
}
