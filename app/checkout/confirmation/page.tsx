// Order confirmation page (server component).
//
// Reads the just-placed order from the server-side in-memory store
// (lib/orders) and shows its items, price breakdown and delivery
// address, with links to track the order or keep shopping.
//
// The order is shown ONLY to the buyer who placed it (audit #8):
// a signed-in order renders only when the session user is the
// order's owner (order.userId), and a guest order renders only when
// the ?key= query value matches the order's per-order buyerToken
// (constant-time compare). Anyone else — anonymous, another
// account, a guest with no key or the wrong key — gets the same
// "Order not found" branch as an unknown order, with no reason
// shown. Staff view orders through the admin order page, not here.
// The owner fields come from the order creation sites
// (createSupabaseOrder and the local checkout path), which already
// carry userId + buyerToken on every StoredOrder — no creation-site
// change was needed.

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { formatBDT } from "@/lib/theme";
import ProductPlaceholder from "@/components/ProductPlaceholder";
import { getOrderRecord } from "@/lib/orders";
import { getCurrentUser } from "@/lib/auth-server";
import { canViewConfirmationOrder } from "@/lib/account-rules";

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: { order?: string; id?: string; key?: string };
}) {
  // Reads the order from the server-side in-memory store (lib/orders).
  // That store only lives as long as the preview server instance, so an
  // order created in a previous run will not be found here — that is
  // reported honestly below instead of inventing an order.
  const orderId = searchParams.order ?? searchParams.id ?? "";
  const order = orderId ? getOrderRecord(orderId) : null;
  // Owner gate: the order renders only for its buyer. A signed-in
  // order needs the owner's session; a guest order needs its
  // per-order key (?key=, carried by the checkout redirect). The
  // not-found branch below is the same for every denial, on purpose.
  const user = await getCurrentUser().catch(() => null);
  const allowed =
    order !== null &&
    canViewConfirmationOrder(order, user?.id ?? null, searchParams.key ?? null);

  if (!order || !allowed) {
    return (
      <main className="mx-auto max-w-[720px] px-4 py-10">
        <div className="rounded-2xl border border-border bg-panel p-8 text-center">
          <h1 className="text-2xl font-bold text-text">Order not found</h1>
          <p className="mt-2 text-muted">
            We could not find an order with that reference. It may have been
            placed in a previous preview session, or the link may be
            incomplete. Your browser-saved orders are listed on the Orders page.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/" className="rounded-lg bg-brandDark px-5 py-3 font-semibold text-white hover:bg-brandDarker">
              Back to home
            </Link>
            <Link href="/orders" className="rounded-lg border border-border bg-panel px-5 py-3 font-medium text-text hover:border-brand">
              View my orders
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[720px] px-4 py-10">
      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Checkout progress">
        <li><Link href="/cart" className="font-medium text-brandDark hover:underline">Cart</Link></li>
        <li className="text-muted">›</li>
        <li><Link href="/checkout" className="font-medium text-brandDark hover:underline">Checkout</Link></li>
        <li className="text-muted">›</li>
        <li className="font-semibold text-text" aria-current="step">Confirmation</li>
      </ol>

      <div className="mt-6 rounded-2xl border border-success bg-panel p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden="true" />
        <h1 className="mt-2 text-2xl font-bold text-text">Thank you — your order is placed</h1>
        <p className="mt-2 text-muted">
          Order number <span className="font-semibold text-text">{order.orderNumber}</span>
        </p>
        <p className="mt-1 text-sm text-muted">
          Status: <span className="font-semibold text-text">{STATUS_LABELS[order.status] ?? order.status}</span>
          {order.testMode && <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-700">TEST MODE</span>}
        </p>
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-panel p-6" aria-label="Order items">
        <h2 className="text-lg font-bold text-text">Items</h2>
        <ul className="mt-4 space-y-3">
          {order.items.map((item) => (
            <li key={item.productId} className="flex items-center gap-3 text-sm">
              <ProductPlaceholder compact label={item.title} className="h-10 w-10 shrink-0 rounded-lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-text">{item.title}</span>
                <span className="text-muted">Qty {item.quantity}</span>
              </span>
              <span className="font-semibold text-text">{formatBDT(item.price_poisha * item.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd className="text-text">{formatBDT(order.subtotal_poisha)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Product savings</dt>
            <dd className="text-success">− {formatBDT(order.savings_poisha)}</dd>
          </div>
          {order.couponCode && (
            <div className="flex justify-between">
              <dt className="text-muted">Coupon ({order.couponCode})</dt>
              <dd className="text-success">− {formatBDT(order.couponDiscount_poisha)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted">Delivery</dt>
            <dd className="text-text">{order.deliveryFee_poisha === 0 ? "FREE" : formatBDT(order.deliveryFee_poisha)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
            <dt className="text-text">Total paid</dt>
            <dd className="text-text">{formatBDT(order.total_poisha)}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-panel p-6" aria-label="Delivery address">
        <h2 className="text-lg font-bold text-text">Delivering to</h2>
        <p className="mt-2 text-sm text-text">
          {order.address.firstName} {order.address.lastName}
          <br />
          {order.address.address}, {order.address.area}
          <br />
          {order.address.city}, {order.address.district}, {order.address.division}
          <br />
          {order.address.mobile} · {order.address.email}
        </p>
        <p className="mt-2 text-sm text-muted">
          Delivery: {order.delivery === "express" ? "Express (1–2 working days)" : "Standard (2–4 working days)"}
        </p>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href={`/orders/${order.id}`} className="rounded-lg bg-brandDark px-5 py-3 font-semibold text-white hover:bg-brandDarker">
          Track this order
        </Link>
        <Link href="/" className="rounded-lg border border-border bg-panel px-5 py-3 font-medium text-text hover:border-brand">
          Continue shopping
        </Link>
      </div>
    </main>
  );
}
