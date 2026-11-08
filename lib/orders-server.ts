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

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "./supabase/server";
import { getProduct } from "./data/catalog";
import { computeTotals as pricingComputeTotals } from "./pricing";
import {
  addressSchema,
  createOrderNumber,
  toAddressSnapshot,
  validateCoupon,
  type AddressInput,
  type PlaceOrderInput,
} from "./orders";
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

async function getSignedInUserId(): Promise<string | null> {
  try {
    const supabase = untyped(createClient());
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
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
    const local = getProduct(item.slug);
    // Storage-option delta from the server-side catalogue (never from
    // the browser). The DB has no seeded variant rows, so a variant
    // price override is applied when one exists.
    const option = local?.storageOptions?.find(
      (o) => item.variant != null && item.variant.startsWith(o.label),
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
      const match = rows.find(
        (v) => item.variant!.startsWith(v.name) || v.name.startsWith(item.variant!),
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

  const rollback = async (restored: ResolvedDbLine[]): Promise<void> => {
    for (const line of restored) {
      try {
        if (line.variantId) {
          await admin
            .from("product_variants")
            .update({ stock: line.stock })
            .eq("id", line.variantId);
        } else {
          await admin.from("products").update({ stock: line.stock }).eq("id", line.productId);
        }
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

  const decremented: ResolvedDbLine[] = [];
  for (const line of dbLines) {
    const newStock = line.stock - line.quantity;
    const result = line.variantId
      ? await admin
          .from("product_variants")
          .update({ stock: newStock })
          .eq("id", line.variantId)
      : await admin.from("products").update({ stock: newStock }).eq("id", line.productId);
    if (result.error) {
      await rollback(decremented);
      return genericFailure;
    }
    decremented.push(line);
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

/**
 * The signed-in user's Supabase orders, newest first, in the same
 * StoredOrder shape the browser order list uses. Empty when Supabase
 * is not configured or nobody is signed in. (Read with the
 * request-scoped client, so RLS limits it to the caller's own orders.)
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
    .select(
      "id, order_number, status, subtotal_poisha, delivery_poisha, discount_poisha, total_poisha, address_snapshot, payment_method, created_at, updated_at, order_items(id, title, price_poisha, quantity, products(slug))",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error || !rows) return [];
  return (rows as unknown as Array<Record<string, unknown>>).map((row) => {
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
      delivery: "standard" as const,
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
      paymentStatus: "unpaid" as const,
      testMode: false,
      createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
    } as StoredOrder;
  });
}

/**
 * Sync a Supabase order's status after the test-payment outcome (or a
 * cancellation). Only the order's owner or an admin may do this. The
 * `payments` table has no direct payment-status column on `orders`, so
 * a paid/failed/cancelled outcome is also recorded as a payments row
 * for the order. Best effort: returns ok:false (generic) on failure
 * and the caller keeps the local order state.
 */
export async function updateSupabaseOrderStatus(
  orderId: string,
  patch: { status: StoredOrder["status"]; paymentStatus?: StoredOrder["paymentStatus"] },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isConfigured()) return { ok: false, message: "Supabase is not configured." };
  const userId = await getSignedInUserId();
  if (!userId) return { ok: false, message: "Not allowed." };
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, message: "Supabase is not configured." };
  }
  const { data: order } = await admin
    .from("orders")
    .select("id, user_id, payment_method, total_poisha")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, message: "Order not found." };
  const { data: caller } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (order.user_id !== userId && caller?.role !== "admin") {
    return { ok: false, message: "Not allowed." };
  }
  const { error } = await admin
    .from("orders")
    .update({ status: patch.status })
    .eq("id", orderId);
  if (error) return { ok: false, message: "Could not update the order." };
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
      const { data: existing } = await admin
        .from("payments")
        .select("id")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        await admin.from("payments").update({ status: paymentStatus }).eq("id", existing.id);
      } else {
        await admin.from("payments").insert({
          order_id: orderId,
          provider: order.payment_method ?? "cod",
          amount_poisha: order.total_poisha,
          status: paymentStatus,
        });
      }
    } catch {
      // Order status already updated; payment row is best effort.
    }
  }
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
    .select("id, payment_method, total_poisha")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, message: "Order not found." };
  const { error } = await admin
    .from("orders")
    .update({ status: patch.status })
    .eq("id", orderId);
  if (error) return { ok: false, message: "Could not update the order." };
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
      const { data: existing } = await admin
        .from("payments")
        .select("id")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        await admin.from("payments").update({ status: paymentStatus }).eq("id", existing.id);
      } else {
        await admin.from("payments").insert({
          order_id: orderId,
          provider: order.payment_method ?? "cod",
          amount_poisha: order.total_poisha,
          status: paymentStatus,
        });
      }
    } catch {
      // Order status already updated; payment row is best effort.
    }
  }
  return { ok: true };
}

/**
 * Write a review — only when the caller owns a DELIVERED order that
 * contains the product. The RLS policy (reviews_insert_own) enforces
 * authorship as well; this check enforces the delivered-order rule.
 */
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
