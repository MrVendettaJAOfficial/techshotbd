// Server-side Supabase orders for TechShot.
//
// SERVER ONLY. Creates real orders in the `orders` / `order_items`
// tables for signed-in users. The browser never supplies a price or a
// total: every line is re-priced from the live `products` table, the
// coupon is re-read from `coupons`, and totals come from lib/pricing
// (computeTotals) — exactly like the local fallback path in
// lib/orders.ts, which stays the fallback when Supabase is not
// configured or the shopper is a guest.
//
// Writes use the service-role client (they must: stock is decremented
// and the order is created atomically from the server's point of view),
// but the caller is always the signed-in user from the request cookies
// and the order is created with that user's id — never an id from the
// browser.
//
// Rollback: if any step fails after the order row is inserted, the
// order row is deleted (order_items cascade) and any stock already
// decremented is restored, so there are no partial orders.
//
// Slug note: the live database uses longer slugs than the local seed
// catalogue for some products (e.g. local `apple-iphone-16-pro` vs DB
// `apple-iphone-16-pro-256gb-natural-titanium`). Resolution tries the
// exact slug first, then the `<slug>-…` prefix. The returned
// StoredOrder keeps the *local* slug as productId so the existing
// confirmation / order-detail pages (which resolve display data from
// the local catalogue) keep working unchanged.
//
// Reviews: submitSupabaseReview only accepts a review when the caller
// owns a DELIVERED order containing the product.

"use server";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "./supabase/server";
import { isStaff } from "./roles";
import { getProductForCartSlug } from "./data/catalog";
import { normalizeVariantLabel, variantMatchesOption } from "./catalog-rules";
import { computeTotals as pricingComputeTotals } from "./pricing";
import {
  addressSchema,
  createOrderNumber,
  getOrderRecord,
  toAddressSnapshot,
  validateCoupon,
  type AddressInput,
  type PlaceOrderInput,
} from "./orders";
import { adjustStockRow, decrementStockGuarded } from "./orders/stock";
import { isLegalOrderTransition } from "./orders/transitions";
import { EXPRESS_DELIVERY_POISHA } from "./theme";
import type { OrderItem, StoredOrder } from "./checkout-store";

interface DbProductRow {
  id: string;
  seller_id: string | null;
  title: string;
  slug: string;
  price_poisha: number;
  compare_at_poisha: number | null;
  stock: number;
  status: string;
}

interface DbVariantRow {
  id: string;
  name: string;
  price_override_poisha: number | null;
  stock: number;
}

interface ResolvedDbLine {
  productId: string;
  variantId: string | null;
  sellerId: string | null;
  title: string;
  price_poisha: number;
  quantity: number;
  stock: number;
}

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * The Supabase Database generic resolves query results to `never`
 * with the installed supabase-js version (see lib/auth-server.ts),
 * so this file talks to the untyped client and casts rows to the
 * local interfaces below. Runtime behaviour is unchanged.
 */
function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

// Per-request cached (React cache()): listSupabaseOrders and the
// account page both ask for the signed-in user during one request,
// and each call was a separate Auth round trip. The cache is
// per-request only — the next request re-validates the session.
const fetchSignedInUserId = cache(async (): Promise<string | null> => {
  try {
    const supabase = untyped(createClient());
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
});

async function getSignedInUserId(): Promise<string | null> {
  return fetchSignedInUserId();
}

/** Signed-in user with email + profile role, or null. Per-request cached — see fetchSignedInUserId above. */
const fetchSignedInUser = cache(async (): Promise<{
  id: string;
  email: string;
  role: string | null;
} | null> => {
  let supabase: SupabaseClient;
  try {
    supabase = untyped(createClient());
  } catch {
    return null;
  }
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    let role: string | null = null;
    try {
      const admin = untyped(createAdminClient());
      const { data: profile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      role = (profile?.role as string | null) ?? null;
    } catch {
      role = null;
    }
    return { id: user.id, email: (user.email ?? "").toLowerCase(), role };
  } catch {
    return null;
  }
});

async function getSignedInUser(): Promise<{
  id: string;
  email: string;
  role: string | null;
} | null> {
  return fetchSignedInUser();
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
 * Best-effort audit row for a status change made outside the admin
 * server actions (payment sync / callback). A failure is logged
 * server-side and never fails the order write or reaches the client.
 */
async function writeOrderAudit(
  admin: SupabaseClient,
  actorId: string | null,
  orderId: string,
  oldStatus: StoredOrder["status"],
  newStatus: StoredOrder["status"],
  source: string,
): Promise<void> {
  try {
    const { error } = await admin.from("audit_log").insert({
      actor_id: actorId,
      action: `order.status:${oldStatus}->${newStatus} (${source})`,
      entity_type: "order",
      entity_id: orderId,
    });
    if (error) {
      console.error("TechShot audit_log insert failed:", error.message);
    }
  } catch (error) {
    console.error(
      "TechShot audit_log insert failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

/** Live product for a local cart slug: exact match, then `<slug>-…`. */
async function resolveDbProduct(
  admin: SupabaseClient,
  slug: string,
): Promise<DbProductRow | null> {
  const exact = await admin
    .from("products")
    .select("id, seller_id, title, slug, price_poisha, compare_at_poisha, stock, status")
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (exact.data) return exact.data as DbProductRow;
  const prefixed = await admin
    .from("products")
    .select("id, seller_id, title, slug, price_poisha, compare_at_poisha, stock, status")
    .like("slug", `${slug}-%`)
    .eq("status", "active")
    .order("slug")
    .limit(1)
    .maybeSingle();
  return (prefixed.data as DbProductRow | null) ?? null;
}

export type CreateSupabaseOrderResult =
  | { ok: true; order: StoredOrder }
  | { ok: false; message: string; useLocalFallback: boolean };

/**
 * Create an order in Supabase for the signed-in user. Returns
 * `useLocalFallback: true` when the caller should use the local
 * in-memory order path instead (Supabase not configured, or guest
 * checkout); `useLocalFallback: false` means a real validation error
 * (bad address, out of stock, invalid coupon) that the caller should
 * show. On success the returned StoredOrder has the same shape as the
 * local path, so the test-payment + COD flow runs on top of it
 * unchanged — the caller must also register it with
 * createOrderRecord() so the test-pay / confirmation pages find it.
 */
export async function createSupabaseOrder(
  input: PlaceOrderInput,
): Promise<CreateSupabaseOrderResult> {
  const genericFailure = {
    ok: false as const,
    message: "Could not place your order. Please try again.",
    useLocalFallback: false,
  };
  if (!isConfigured()) {
    return { ok: false, message: "Supabase is not configured.", useLocalFallback: true };
  }
  const userId = await getSignedInUserId();
  if (!userId) {
    return {
      ok: false,
      message: "Sign in to place an order with your account.",
      useLocalFallback: true,
    };
  }
  const parsedAddress = addressSchema.safeParse(input.address);
  if (!parsedAddress.success) {
    return {
      ok: false,
      message: "Please fix the highlighted address fields.",
      useLocalFallback: false,
    };
  }
  if (!input.items || input.items.length === 0) {
    return { ok: false, message: "Your cart is empty.", useLocalFallback: false };
  }
  if (!["card", "bkash", "nagad", "cod", "emi"].includes(input.paymentMethod)) {
    return { ok: false, message: "Choose a payment method.", useLocalFallback: false };
  }
  if (!["standard", "express"].includes(input.delivery)) {
    return { ok: false, message: "Choose a delivery option.", useLocalFallback: false };
  }

  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, message: "Supabase is not configured.", useLocalFallback: true };
  }

  // 1. Re-price every line from LIVE database prices.
  const lines: OrderItem[] = [];
  const dbLines: ResolvedDbLine[] = [];
  const errors: string[] = [];
  for (const item of input.items) {
    const dbProduct = await resolveDbProduct(admin, item.slug);
    if (!dbProduct) {
      errors.push(`Product "${item.slug}" is no longer available.`);
      continue;
    }
    const local = getProductForCartSlug(item.slug);
    // Storage-option delta from the server-side catalogue (never from
    // the browser). Variant labels are compared space- and
    // case-insensitively, so a live label like "512GB Natural Titanium"
    // matches the seed option "512 GB". The DB has no seeded variant
    // rows, so a variant price override is applied when one exists.
    const option = local?.storageOptions?.find(
      (o) => variantMatchesOption(item.variant, o.label),
    );
    let unitPrice = dbProduct.price_poisha + (option?.priceDeltaPoisha ?? 0);
    let stock = dbProduct.stock;
    let variantId: string | null = null;
    if (item.variant) {
      const { data: variants } = await admin
        .from("product_variants")
        .select("id, name, price_override_poisha, stock")
        .eq("product_id", dbProduct.id);
      const rows = (variants ?? []) as DbVariantRow[];
      const wanted = normalizeVariantLabel(item.variant);
      const match = rows.find(
        (v) =>
          wanted.startsWith(normalizeVariantLabel(v.name)) ||
          normalizeVariantLabel(v.name).startsWith(wanted),
      );
      if (match) {
        variantId = match.id;
        if (match.price_override_poisha != null) {
          unitPrice = match.price_override_poisha + (option?.priceDeltaPoisha ?? 0);
        }
        stock = match.stock;
      }
    }
    const quantity = Math.max(1, item.quantity);
    if (quantity > stock) {
      errors.push(
        `${dbProduct.title}: only ${stock} in stock, you asked for ${quantity}.`,
      );
      continue;
    }
    lines.push({
      productId: item.slug,
      title: dbProduct.title,
      variant: item.variant ?? local?.variant,
      price_poisha: unitPrice,
      mrp_poisha: (dbProduct.compare_at_poisha ?? unitPrice) + (option?.priceDeltaPoisha ?? 0),
      image: local?.image,
      quantity,
    });
    dbLines.push({
      productId: dbProduct.id,
      variantId,
      sellerId: dbProduct.seller_id,
      title: dbProduct.title,
      price_poisha: unitPrice,
      quantity,
      stock,
    });
  }
  if (errors.length > 0) {
    return { ok: false, message: errors.join(" "), useLocalFallback: false };
  }
  if (lines.length === 0) {
    return { ok: false, message: "Your cart is empty.", useLocalFallback: false };
  }

  // 2. Coupon: re-read from the DB; fall back to the local FIRST2000
  // rule only when the code has no DB row at all.
  const subtotal_poisha = lines.reduce((sum, l) => sum + l.price_poisha * l.quantity, 0);
  const normalizedCode = (input.couponCode ?? "").trim().toUpperCase() || null;
  let couponInput: { value_poisha: number; min_spend_poisha: number } | null = null;
  if (normalizedCode) {
    const { data: coupon } = await admin
      .from("coupons")
      .select("value_poisha, min_spend_poisha, is_active, expires_at, usage_limit, used_count")
      .eq("code", normalizedCode)
      .maybeSingle();
    if (coupon) {
      const usable =
        coupon.is_active &&
        (!coupon.expires_at || new Date(coupon.expires_at) > new Date()) &&
        (coupon.usage_limit == null || coupon.used_count < coupon.usage_limit) &&
        subtotal_poisha >= coupon.min_spend_poisha;
      if (!usable) {
        return { ok: false, message: "This coupon code is not valid.", useLocalFallback: false };
      }
      couponInput = {
        value_poisha: coupon.value_poisha,
        min_spend_poisha: coupon.min_spend_poisha,
      };
    } else {
      const result = validateCoupon(normalizedCode, subtotal_poisha);
      if ("error" in result) {
        return { ok: false, message: result.error, useLocalFallback: false };
      }
      couponInput = {
        value_poisha: result.discount_poisha,
        min_spend_poisha: 0,
      };
    }
  }

  // 3. Totals from live prices via lib/pricing (never browser totals).
  const priced = pricingComputeTotals(lines, couponInput, input.delivery);
  const savings_poisha = lines.reduce(
    (sum, i) => sum + (i.mrp_poisha - i.price_poisha) * i.quantity,
    0,
  );
  const discount_poisha = priced.discount;
  const deliveryFee_poisha = priced.delivery;
  const total_poisha = priced.total;

  // 4. Insert the order + items, then decrement stock. Roll back on
  // any failure: delete the order (items cascade) and restore stock.
  const now = new Date();
  const orderNumber = createOrderNumber(now);
  const isOnline = input.paymentMethod !== "cod";
  const address: AddressInput = parsedAddress.data;
  const addressSnapshot = {
    name: `${address.firstName} ${address.lastName}`.trim(),
    phone: address.mobile,
    division: address.division,
    district: address.district,
    city: address.city,
    full_address: `${address.address}, ${address.area}`,
  };
  const { data: orderRow, error: orderError } = await admin
    .from("orders")
    .insert({
      order_number: orderNumber,
      user_id: userId,
      status: isOnline ? "pending_payment" : "confirmed",
      subtotal_poisha,
      delivery_poisha: deliveryFee_poisha,
      discount_poisha,
      total_poisha,
      address_snapshot: addressSnapshot,
      payment_method: input.paymentMethod,
    })
    .select("id")
    .single();
  if (orderError || !orderRow) return genericFailure;
  const orderId = orderRow.id as string;

  // Rollback restores stock by ADDING each decremented quantity back
  // through the guarded helper (never by writing an absolute stock
  // value, which could clobber a concurrent checkout's decrement),
  // then deletes the order row (items cascade).
  const rollback = async (restored: ResolvedDbLine[]): Promise<void> => {
    for (const line of restored) {
      try {
        await adjustStockRow(
          admin,
          line.variantId ? "product_variants" : "products",
          line.variantId ?? line.productId,
          line.quantity,
        );
      } catch {
        // Best effort — the order row is still deleted below.
      }
    }
    try {
      await admin.from("orders").delete().eq("id", orderId);
    } catch {
      // Nothing more can be done from here; the failure is reported.
    }
  };

  const { error: itemsError } = await admin.from("order_items").insert(
    dbLines.map((l) => ({
      order_id: orderId,
      product_id: l.productId,
      seller_id: l.sellerId,
      title: l.title,
      price_poisha: l.price_poisha,
      quantity: l.quantity,
    })),
  );
  if (itemsError) {
    await rollback([]);
    return genericFailure;
  }

  // Conditional decrement: the update only lands when the row still
  // holds the stock we checked against. Two concurrent checkouts for
  // the last item cannot both succeed — the loser sees 0 rows
  // affected, rolls back and the order fails instead of overselling
  // into negative stock.
  const decremented: ResolvedDbLine[] = [];
  for (const line of dbLines) {
    const ok = await decrementStockGuarded(
      admin,
      line.variantId ? "product_variants" : "products",
      line.variantId ?? line.productId,
      line.stock,
      line.quantity,
    );
    if (!ok) {
      await rollback(decremented);
      return genericFailure;
    }
    decremented.push(line);
  }

  // Record which variant row each order line decremented, so a later
  // cancel / refund restores exactly that row (migration 0003 adds
  // order_items.variant_id). Best effort: a database that has not
  // applied the migration yet must not fail the order.
  try {
    const { data: itemRows } = await admin
      .from("order_items")
      .select("id, product_id")
      .eq("order_id", orderId);
    for (const line of dbLines) {
      if (!line.variantId) continue;
      const itemRow = ((itemRows ?? []) as Array<{ id: string; product_id: string }>).find(
        (r) => r.product_id === line.productId,
      );
      if (!itemRow) continue;
      await admin
        .from("order_items")
        .update({ variant_id: line.variantId })
        .eq("id", itemRow.id);
    }
  } catch {
    // Variant attribution is best effort; the order is already placed.
  }

  // Coupon usage count (best effort — a failure here does not fail
  // the order, which is already placed).
  if (normalizedCode && couponInput) {
    try {
      const { data: coupon } = await admin
        .from("coupons")
        .select("id, used_count")
        .eq("code", normalizedCode)
        .maybeSingle();
      if (coupon) {
        await admin
          .from("coupons")
          .update({ used_count: (coupon.used_count ?? 0) + 1 })
          .eq("id", coupon.id);
      }
    } catch {
      // Ignore.
    }
  }

  const order: StoredOrder = {
    id: orderId,
    orderNumber,
    items: lines,
    address: toAddressSnapshot(address, `addr_${now.getTime()}`),
    delivery: input.delivery,
    paymentMethod: input.paymentMethod,
    subtotal_poisha,
    savings_poisha,
    couponCode: normalizedCode,
    couponDiscount_poisha: discount_poisha,
    deliveryFee_poisha,
    total_poisha,
    status: isOnline ? "pending_payment" : "confirmed",
    paymentStatus: "unpaid",
    testMode: isOnline,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  return { ok: true, order };
}

const ORDER_COLUMNS =
  "id, order_number, status, subtotal_poisha, delivery_poisha, discount_poisha, total_poisha, address_snapshot, payment_method, created_at, updated_at, order_items(id, title, price_poisha, quantity, products(slug))";

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
  const userId = await getSignedInUserId();
  if (!userId) return [];
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return [];
  }
  const { data: caller } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (!isStaff(caller?.role)) return [];
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

/**
 * Sync a Supabase order's status after a payment outcome (or a
 * cancellation). Only the order's owner or an admin may do this.
 *
 * Guardrails (review fixes):
 *   - patch.status is validated with isLegalOrderTransition() against
 *     the order's CURRENT status and latest payment status — a
 *     customer can no longer self-mark their own order "delivered"
 *     (unlocking reviews) or "refunded". Delivered / refunded moves
 *     are admin-only.
 *   - patch.paymentStatus is REJECTED from this path entirely:
 *     payment status may only change via the verified callback
 *     (updateSupabaseOrderFromCallback), which appends a new attempt
 *     row. Callers that used to pass a payment status here (the
 *     test-pay page) now use the callback path instead.
 *   - The update is conditional on the current status, and an audit
 *     row is written best-effort for the change.
 */
export async function updateSupabaseOrderStatus(
  orderId: string,
  patch: { status: StoredOrder["status"]; paymentStatus?: StoredOrder["paymentStatus"] },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isConfigured()) return { ok: false, message: "Supabase is not configured." };
  const userId = await getSignedInUserId();
  if (!userId) return { ok: false, message: "Not allowed." };
  if (patch.paymentStatus !== undefined && patch.paymentStatus !== "unpaid") {
    return { ok: false, message: "Not allowed." };
  }
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, message: "Supabase is not configured." };
  }
  const { data: order } = await admin
    .from("orders")
    .select("id, user_id, status, payment_method, total_poisha")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, message: "Order not found." };
  const { data: caller } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const isAdmin = caller?.role === "admin";
  if (order.user_id !== userId && !isAdmin) {
    return { ok: false, message: "Not allowed." };
  }
  const currentStatus = order.status as StoredOrder["status"];
  const currentPayment = await latestPaymentStatus(admin, orderId);
  if (!isLegalOrderTransition(currentStatus, patch.status, currentPayment)) {
    return { ok: false, message: "That status change is not allowed." };
  }
  if ((patch.status === "delivered" || patch.status === "refunded") && !isAdmin) {
    return { ok: false, message: "Not allowed." };
  }
  const { data: updated, error } = await admin
    .from("orders")
    .update({ status: patch.status })
    .eq("id", orderId)
    .eq("status", currentStatus)
    .select("id");
  if (error) return { ok: false, message: "Could not update the order." };
  if (!Array.isArray(updated) || updated.length !== 1) {
    return { ok: false, message: "Could not update the order." };
  }
  await writeOrderAudit(admin, userId, orderId, currentStatus, patch.status, "status-sync");
  return { ok: true };
}

/**
 * Update an order's status + payment row from a VERIFIED payment
 * callback. Unlike updateSupabaseOrderStatus this does NOT require a
 * signed-in user session: a public callback has no user cookies. The
 * caller MUST have verified the callback signature first (see
 * app/api/payments/callback/route.ts) — that verification is the trust
 * boundary here, not a session. Never call this from a browser-facing
 * form or an unverified request.
 *
 * Payment attempts are APPEND-ONLY: every callback INSERTS a new
 * payments row for the attempt and never updates an existing row's
 * status, so a failed retry (or a replayed failed callback) can never
 * overwrite a paid record. The status move is validated like any
 * other transition (a same-status outcome, e.g. a failed payment on
 * an order still pending payment, is allowed) and written
 * conditionally on the current status, with a best-effort audit row.
 */
export async function updateSupabaseOrderFromCallback(
  orderId: string,
  patch: { status: StoredOrder["status"]; paymentStatus?: StoredOrder["paymentStatus"] },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isConfigured()) return { ok: false, message: "Supabase is not configured." };
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, message: "Supabase is not configured." };
  }
  const { data: order } = await admin
    .from("orders")
    .select("id, status, payment_method, total_poisha")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, message: "Order not found." };
  const currentStatus = order.status as StoredOrder["status"];
  const currentPayment = await latestPaymentStatus(admin, orderId);
  if (patch.status !== currentStatus) {
    if (!isLegalOrderTransition(currentStatus, patch.status, currentPayment)) {
      return { ok: false, message: "That status change is not allowed." };
    }
  }
  const { data: updated, error } = await admin
    .from("orders")
    .update({ status: patch.status })
    .eq("id", orderId)
    .eq("status", currentStatus)
    .select("id");
  if (error) return { ok: false, message: "Could not update the order." };
  if (!Array.isArray(updated) || updated.length !== 1) {
    return { ok: false, message: "Could not update the order." };
  }
  if (patch.paymentStatus && patch.paymentStatus !== "unpaid") {
    const paymentStatus =
      patch.paymentStatus === "paid"
        ? "paid"
        : patch.paymentStatus === "failed"
          ? "failed"
          : patch.paymentStatus === "cancelled"
            ? "failed"
            : "refunded";
    try {
      const { error: insertError } = await admin.from("payments").insert({
        order_id: orderId,
        provider: order.payment_method ?? "cod",
        amount_poisha: order.total_poisha,
        status: paymentStatus,
      });
      if (insertError) {
        console.error("TechShot callback payment row insert failed:", insertError.message);
      }
    } catch (error) {
      console.error(
        "TechShot callback payment row insert failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  await writeOrderAudit(admin, null, orderId, currentStatus, patch.status, "payment-callback");
  return { ok: true };
}

/**
 * The current status of an order, from the server side, for the order
 * pages to reconcile against.
 *
 * The shopper's browser keeps its own copy of every order
 * (localStorage, lib/checkout-store), and the test-pay page updates
 * that copy through the ?payment= redirect — but a payment completed
 * through the PUBLIC callback route (POST /api/payments/callback) has
 * no browser redirect: the callback updates the server-side record
 * (in-memory, plus Supabase) and the browser copy would otherwise say
 * "Pending payment" forever, even though the order is paid. The order
 * detail page calls this after loading the browser copy and adopts the
 * server status when the browser copy is still pending payment.
 *
 * Order of sources: the Supabase row first (it is the source of
 * truth — admin moves such as advance, return, refund and cancel
 * write the database, never the in-memory record — so returning the
 * in-memory snapshot first would freeze the order at its checkout
 * status in the browser that placed it, even though /orders, where
 * the live copy wins the merge, already shows the new status), then
 * the in-memory record (same server process — checkout, test-pay
 * and the callback all register there) for orders with no database
 * row. Returns null when the order is not found anywhere the caller
 * may see it. BOTH branches require a signed-in session and the same
 * owner-or-admin check: the in-memory record carries no owner id, so
 * ownership there is the checkout email on the record matching the
 * signed-in user's email (admins may see any order). A guest's
 * browser copy is unaffected — this only gates the server-side
 * status read.
 */
export async function getOrderStatusFromServer(
  orderId: string,
): Promise<{
  status: StoredOrder["status"];
  paymentStatus: StoredOrder["paymentStatus"];
} | null> {
  // The database row first, when Supabase is configured: it is the
  // only copy admin moves ever update. A row the caller may see
  // answers the question outright; a row that exists but belongs to
  // someone else answers it with null (no falling through to the
  // in-memory record for an order the caller may not see). Only when
  // there is no database row at all does the in-memory record below
  // get a say.
  if (isConfigured()) {
    const userId = await getSignedInUserId();
    if (userId) {
      let admin: SupabaseClient | null = null;
      try {
        admin = untyped(createAdminClient());
      } catch {
        admin = null;
      }
      if (admin) {
        const { data: order } = await admin
          .from("orders")
          .select("id, user_id, status, payment_method")
          .eq("id", orderId)
          .maybeSingle();
        if (order) {
          const { data: caller } = await admin
            .from("profiles")
            .select("role")
            .eq("id", userId)
            .maybeSingle();
          if (order.user_id !== userId && caller?.role !== "admin") return null;
          let paymentStatus: StoredOrder["paymentStatus"] = "unpaid";
          const { data: payment } = await admin
            .from("payments")
            .select("status")
            .eq("order_id", orderId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (payment?.status === "paid") paymentStatus = "paid";
          else if (payment?.status === "failed") paymentStatus = "failed";
          else if (payment?.status === "refunded") paymentStatus = "refunded";
          return {
            status: order.status as StoredOrder["status"],
            paymentStatus,
          };
        }
      }
    }
  }
  const local = getOrderRecord(orderId);
  if (local) {
    const user = await getSignedInUser();
    if (!user) return null;
    const ownerEmail = (local.address?.email ?? "").toLowerCase();
    if (user.role !== "admin" && (!ownerEmail || ownerEmail !== user.email)) {
      return null;
    }
    return { status: local.status, paymentStatus: local.paymentStatus };
  }
  return null;
}
export async function submitSupabaseReview(input: {
  productSlug: string;
  orderId: string;
  rating: number;
  text?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isConfigured()) return { ok: false, message: "Reviews are not available right now." };
  const userId = await getSignedInUserId();
  if (!userId) return { ok: false, message: "Sign in to write a review." };
  const rating = Math.floor(input.rating);
  if (rating < 1 || rating > 5) {
    return { ok: false, message: "Rating must be between 1 and 5." };
  }
  const text = (input.text ?? "").trim().slice(0, 1000);
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  try {
    supabase = untyped(createClient());
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, message: "Reviews are not available right now." };
  }
  const product = await resolveDbProduct(admin, input.productSlug);
  if (!product) return { ok: false, message: "Product not found." };
  // The order must be the caller's, delivered, and contain the product.
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_items(product_id)")
    .eq("id", input.orderId)
    .eq("user_id", userId)
    .eq("status", "delivered")
    .maybeSingle();
  const items = (order as unknown as { order_items?: Array<{ product_id: string }> } | null)
    ?.order_items;
  if (!order || !(items ?? []).some((it) => it.product_id === product.id)) {
    return {
      ok: false,
      message: "You can only review products from a delivered order.",
    };
  }
  const { error } = await supabase.from("reviews").insert({
    user_id: userId,
    product_id: product.id,
    order_id: input.orderId,
    rating,
    text: text || null,
  });
  if (error) {
    return { ok: false, message: "Could not save your review. Please try again." };
  }
  return { ok: true };
}
