"use server";

// Create a Supabase order for the signed-in user (lib/orders-server.ts).
// One job: re-price lines from live DB prices, validate the coupon,
// insert the order + items, decrement stock with rollback on failure.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../supabase/server";
import { revalidateCatalogCache } from "../../storefront-cache";
import { getProductForCartSlug } from "../../data/catalog";
import { normalizeVariantLabel, variantMatchesOption } from "../../catalog-rules";
import { computeTotals as pricingComputeTotals } from "../../pricing";
import {
  addressSchema,
  createOrderNumber,
  toAddressSnapshot,
  validateCoupon,
  type AddressInput,
  type PlaceOrderInput,
} from "../../orders";
import { adjustStockRow, decrementStockGuarded } from "../stock";
import { EXPRESS_DELIVERY_POISHA } from "../../theme";
import type { OrderItem, StoredOrder } from "../../checkout-store";
import {
  getSignedInUserId,
  isConfigured,
  resolveDbProduct,
  untyped,
  type DbVariantRow,
  type ResolvedDbLine,
} from "./shared";

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
    // Signed-in order: the session proves ownership, so there is no
    // guest key. userId is the same id stored as orders.user_id.
    userId,
    buyerToken: null,
    testMode: isOnline,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  // Stock was decremented above, and stock is catalogue-visible data:
  // purge the "catalog" tag so the storefront shows the new stock on
  // the next visit instead of the cached pre-order figure.
  revalidateCatalogCache();
  return { ok: true, order };
}
