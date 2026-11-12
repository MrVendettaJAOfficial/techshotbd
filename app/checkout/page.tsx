// Checkout page (server component).
//
// Renders the checkout form (./CheckoutForm) with the placeOrder
// server action: validates the address, recomputes totals from the
// catalogue, validates stock and creates the order, then sends
// online payments to the test payment page and COD orders straight
// to the order page. Orders are created in Supabase whenever it is
// configured — signed-in and guest alike (a guest order is a real
// row with user_id NULL and a buyerToken, and it decrements stock
// like any other order) — and only fall back to the in-memory
// record when Supabase is not configured.

import Link from "next/link";
import { randomUUID } from "node:crypto";
import {
  addressSchema,
  computeCheckoutTotalsFromLines,
  createOrderNumber,
  createOrderRecord,
  getOrderRecord,
  toAddressSnapshot,
  validateStock,
  type PlaceOrderInput,
  type PlaceOrderResult,
} from "@/lib/orders";
import { testAdapter } from "@/lib/payments/test-adapter";
import { createSupabaseOrder } from "@/lib/orders-server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSignedInUserId, isConfigured, untyped } from "@/lib/orders/server/shared";
import { validateCouponFromDb } from "@/lib/orders/checkout/coupons";
import { getPricedCartLines } from "@/lib/cart-server";
import type { StoredOrder } from "@/lib/checkout-store";
import CheckoutForm from "./CheckoutForm";

// Idempotency for the LOCAL (unconfigured-Supabase) order path, which
// has no database row to dedup on: key -> the order already created
// for it, per buyer, in this server process. The Supabase path dedups
// in lib/orders/server/create.ts instead (orders row + migration
// 0014), so this map is only consulted below, in the local fallback.
const localCheckoutByKey = new Map<string, StoredOrder>();

/**
 * Where checkout sends the buyer after the order exists. COD goes
 * straight to the order page; online payments go to the TEST payment
 * page. A guest order carries its buyerToken as ?key= on the COD
 * redirect (the confirmation page enforces it) — the test adapter
 * already appends the same key to the online-payment redirect.
 */
async function redirectForOrder(order: StoredOrder): Promise<PlaceOrderResult> {
  const isOnline = order.paymentMethod !== "cod";
  if (!isOnline) {
    const key = order.buyerToken ? `?key=${encodeURIComponent(order.buyerToken)}` : "";
    return { ok: true, order, redirectTo: `/orders/${order.id}${key}` };
  }
  const payment = await testAdapter.createPayment({
    id: order.id,
    orderNumber: order.orderNumber,
    total_poisha: order.total_poisha,
    buyerToken: order.buyerToken ?? undefined,
  });
  return { ok: true, order, redirectTo: payment.redirectUrl };
}

export default function CheckoutPage() {
  // Server action (defined inside this server component, so the page
  // module exports only the component itself): validates the address
  // server-side with zod, recomputes totals from the catalog (never
  // trusting browser totals), validates stock, creates the order
  // (in Supabase via lib/orders-server.ts for signed-in users when
  // configured, otherwise the in-memory record in lib/orders.ts) and
  // tells the client where to go next: online payments go to the TEST
  // payment page, COD goes to the order page.
  async function placeOrderAction(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    "use server";
    const parsedAddress = addressSchema.safeParse(input.address);
    if (!parsedAddress.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsedAddress.error.issues) {
        const field = String(issue.path[0] ?? "form");
        if (!errors[field]) errors[field] = issue.message;
      }
      return { ok: false, errors, message: "Please fix the highlighted address fields." };
    }
    if (!input.items || input.items.length === 0) {
      return { ok: false, errors: {}, message: "Your cart is empty." };
    }
    if (!["card", "bkash", "nagad", "cod", "emi"].includes(input.paymentMethod)) {
      return { ok: false, errors: {}, message: "Choose a payment method." };
    }
    if (!["standard", "express"].includes(input.delivery)) {
      return { ok: false, errors: {}, message: "Choose a delivery option." };
    }

    // Try the live Supabase order path first: it re-prices from live
    // DB prices, checks stock, writes the order + items and
    // decrements stock (lib/orders-server.ts) — for signed-in users
    // AND guests (a guest order is a real row with user_id NULL and
    // a fresh buyerToken). It returns useLocalFallback only when
    // Supabase is not configured — then the local path below runs
    // unchanged. A validation failure from Supabase (bad coupon, out
    // of stock) is shown instead of falling back, so the shopper
    // sees the real reason instead of being charged a stale local
    // price.
    const supabaseResult = await createSupabaseOrder(input);
    if (supabaseResult.ok) {
      // Register the same order in the in-memory store so the
      // test-payment page, confirmation page and payment callback
      // (which read it via getOrderRecord) keep working — unless it
      // is already there. A repeat submission returns the ORIGINAL
      // order from the database (no buyerToken is stored on the
      // row), and re-registering it here would overwrite the
      // in-memory copy that still carries the guest key.
      const existing = getOrderRecord(supabaseResult.order.id);
      const order = existing ?? createOrderRecord(supabaseResult.order);
      return redirectForOrder(order);
    }
    if (!supabaseResult.useLocalFallback) {
      return { ok: false, errors: {}, message: supabaseResult.message };
    }

    // Recompute everything server-side from live prices (seed catalogue
    // when Supabase is not configured). getPricedCartLines resolves each
    // cart slug against the live database first, so a guest checking out
    // while Supabase is configured is priced from live prices — pricing
    // from the seed catalogue alone would drop live slugs as "no longer
    // available" and block checkout entirely.
    //
    // This path only runs when Supabase is NOT configured (the
    // Supabase path above handles every configured checkout, guest
    // included). The coupon is still validated against the database
    // whenever one is reachable, with the same helper the Supabase
    // path uses — a deactivated or expired coupon must be rejected
    // here exactly as there, never priced from the local rule alone.
    // When no database is reachable the local rule prices the order
    // (display-only behaviour, unchanged from before).
    const priced = await getPricedCartLines(input.items);
    if (priced.stockErrors.length > 0) {
      return { ok: false, errors: {}, message: priced.stockErrors.join(" ") };
    }
    const localSubtotal = priced.lines.reduce(
      (sum, l) => sum + l.price_poisha * l.quantity,
      0,
    );
    const normalizedCode = (input.couponCode ?? "").trim().toUpperCase() || null;
    let dbCoupon: { discount_poisha: number } | { error: string } | undefined;
    if (isConfigured() && normalizedCode) {
      try {
        const admin = untyped(createAdminClient());
        const checked = await validateCouponFromDb(admin, normalizedCode, localSubtotal);
        dbCoupon = checked.ok
          ? { discount_poisha: checked.coupon.value_poisha }
          : { error: checked.error };
      } catch {
        // No database to ask: fall through to the local rule.
        dbCoupon = undefined;
      }
    }
    const totals = computeCheckoutTotalsFromLines(
      priced.lines,
      priced.unknownSlugs,
      input.couponCode,
      input.delivery,
      dbCoupon,
    );
    if (totals.errors && totals.errors.length > 0) {
      return { ok: false, errors: {}, message: totals.errors.join(" ") };
    }
    if (totals.couponError) {
      return { ok: false, errors: { coupon: totals.couponError }, message: totals.couponError };
    }
    const stock = validateStock(totals.items);
    if (!stock.ok) {
      return { ok: false, errors: {}, message: stock.errors.join(" ") };
    }

    // Local-path idempotency: a repeat submission with the same key
    // returns the order already created for it (same buyer, same
    // key), instead of a second in-memory order.
    const localUserId = await getSignedInUserId();
    const dedupKey = (input.idempotencyKey ?? "").trim();
    const localKey = dedupKey ? `${localUserId ?? "guest"}:${dedupKey}` : "";
    if (localKey) {
      const prior = localCheckoutByKey.get(localKey);
      if (prior) return redirectForOrder(prior);
    }

    const now = new Date();
    const orderId = `order_${now.getTime()}_${Math.floor(Math.random() * 100000)}`;
    const isOnline = input.paymentMethod !== "cod";
    const order = createOrderRecord({
      id: orderId,
      orderNumber: createOrderNumber(now),
      items: totals.items,
      address: toAddressSnapshot(parsedAddress.data, `addr_${now.getTime()}`),
      delivery: input.delivery,
      paymentMethod: input.paymentMethod,
      subtotal_poisha: totals.subtotal_poisha,
      savings_poisha: totals.savings_poisha,
      couponCode: totals.couponCode,
      couponDiscount_poisha: totals.couponDiscount_poisha,
      deliveryFee_poisha: totals.deliveryFee_poisha,
      total_poisha: totals.total_poisha,
      status: isOnline ? "pending_payment" : "confirmed",
      paymentStatus: "unpaid",
      // Guest (local) order: the session id when there is one,
      // otherwise null — and a fresh random key the guest proves
      // ownership with at the test-pay page. In unconfigured mode
      // getSignedInUserId() returns null, so this path is
      // effectively guest-only; the key is what the guest has.
      userId: localUserId,
      buyerToken: randomUUID(),
      testMode: isOnline,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    if (localKey) localCheckoutByKey.set(localKey, order);

    return redirectForOrder(order);
  }

  return (
    <main className="mx-auto max-w-[1312px] px-4 py-8">
      <nav className="text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-text">Home</Link>
        <span className="mx-2">›</span>
        <Link href="/cart" className="hover:text-text">Your cart</Link>
        <span className="mx-2">›</span>
        <span className="text-text">Checkout</span>
      </nav>

      <ol className="mt-4 flex flex-wrap items-center gap-2 text-sm" aria-label="Checkout progress">
        <li>
          <Link href="/cart" className="font-medium text-brandDark hover:underline">Cart</Link>
        </li>
        <li className="text-muted">›</li>
        <li className="font-semibold text-text" aria-current="step">Checkout</li>
        <li className="text-muted">›</li>
        <li className="text-muted">Confirmation</li>
      </ol>

      <h1 className="mt-4 text-3xl font-bold text-text">Checkout</h1>
      <p className="mt-1 text-muted">Almost there — address, delivery and payment, then you are done.</p>

      <CheckoutForm placeOrder={placeOrderAction} />
    </main>
  );
}
