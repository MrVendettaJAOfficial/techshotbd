import Link from "next/link";
import {
  addressSchema,
  computeCheckoutTotalsFromLines,
  createOrderNumber,
  createOrderRecord,
  toAddressSnapshot,
  validateStock,
  type PlaceOrderInput,
  type PlaceOrderResult,
} from "@/lib/orders";
import { testAdapter } from "@/lib/payments/test-adapter";
import { createSupabaseOrder } from "@/lib/orders-server";
import { getPricedCartLines } from "@/lib/cart-server";
import CheckoutForm from "./CheckoutForm";

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

    // Try the live Supabase order path first for signed-in users: it
    // re-prices from live DB prices, checks stock, writes the order +
    // items and decrements stock (lib/orders-server.ts). It returns
    // useLocalFallback when Supabase is not configured or the shopper
    // is a guest — then the local path below runs unchanged. A
    // validation failure from Supabase (bad coupon, out of stock) is
    // shown instead of falling back, so the shopper sees the real
    // reason instead of being charged a stale local price.
    const supabaseResult = await createSupabaseOrder(input);
    if (supabaseResult.ok) {
      // Register the same order in the in-memory store so the
      // test-payment page, confirmation page and payment callback
      // (which read it via getOrderRecord) keep working.
      const order = createOrderRecord(supabaseResult.order);
      const isOnline = input.paymentMethod !== "cod";
      if (!isOnline) {
        return { ok: true, order, redirectTo: `/orders/${order.id}` };
      }
      const payment = await testAdapter.createPayment({
        id: order.id,
        orderNumber: order.orderNumber,
        total_poisha: order.total_poisha,
      });
      return { ok: true, order, redirectTo: payment.redirectUrl };
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
    const priced = await getPricedCartLines(input.items);
    if (priced.stockErrors.length > 0) {
      return { ok: false, errors: {}, message: priced.stockErrors.join(" ") };
    }
    const totals = computeCheckoutTotalsFromLines(
      priced.lines,
      priced.unknownSlugs,
      input.couponCode,
      input.delivery,
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
      testMode: isOnline,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    if (!isOnline) {
      return { ok: true, order, redirectTo: `/orders/${order.id}` };
    }

    // Online payments go through the test adapter, which returns the
    // redirect to the TEST payment page (with a provider reference).
    const payment = await testAdapter.createPayment({
      id: order.id,
      orderNumber: order.orderNumber,
      total_poisha: order.total_poisha,
    });
    return { ok: true, order, redirectTo: payment.redirectUrl };
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
          <Link href="/cart" className="font-medium text-brand hover:underline">Cart</Link>
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
