// Order confirmation page (server component).
//
// Reads the just-placed order from the server-side in-memory store
// (lib/orders) and shows its items, price breakdown and delivery
// address, with links to track the order or keep shopping. An
// unknown order reference reports "Order not found" honestly.

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { formatBDT } from "@/lib/theme";
import ProductPlaceholder from "@/components/ProductPlaceholder";
import { getOrderRecord } from "@/lib/orders";

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export default function ConfirmationPage({
  searchParams,
}: {
  searchParams: { order?: string; id?: string };
}) {
  // Reads the order from the server-side in-memory store (lib/orders).
  // That store only lives as long as the preview server instance, so an
  // order created in a previous run will not be found here — that is
  // reported honestly below instead of inventing an order.
  const orderId = searchParams.order ?? searchParams.id ?? "";
  const order = orderId ? getOrderRecord(orderId) : null;

  if (!order) {
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
            <Link href="/" className="rounded-lg bg-ink px-5 py-3 font-semibold text-white hover:bg-inkLight">
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
        <li><Link href="/cart" className="font-medium text-ink hover:underline">Cart</Link></li>
        <li className="text-muted">›</li>
        <li><Link href="/checkout" className="font-medium text-ink hover:underline">Checkout</Link></li>
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
        <Link href={`/orders/${order.id}`} className="rounded-lg bg-ink px-5 py-3 font-semibold text-white hover:bg-inkLight">
          Track this order
        </Link>
        <Link href="/" className="rounded-lg border border-border bg-panel px-5 py-3 font-medium text-text hover:border-brand">
          Continue shopping
        </Link>
      </div>
    </main>
  );
}
