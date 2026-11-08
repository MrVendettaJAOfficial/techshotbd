"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { formatBDT } from "@/lib/theme";
import { applyPaymentOutcome, paymentQueryToOutcome } from "@/lib/orders";
import { getOrderStatusFromServer } from "@/lib/orders-server";
import {
  ORDER_TIMELINE_STEPS,
  getOrder,
  updateOrderStatus,
  type StoredOrder,
} from "@/lib/checkout-store";

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const PAYMENT_LABELS: Record<string, string> = {
  card: "Card",
  bkash: "bKash",
  nagad: "Nagad",
  cod: "Cash on Delivery",
  emi: "EMI",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function OrderDetailInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [order, setOrder] = useState<StoredOrder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const paymentApplied = useRef(false);

  const id = params.id;

  useEffect(() => {
    const browserOrder = getOrder(id);
    setOrder(browserOrder);
    setLoaded(true);
    // Reconcile with the server: a payment completed through the public
    // callback route updates the server-side record, not this browser
    // copy — without this, an order paid by callback would say "Pending
    // payment" here forever. Only a copy that is still pending payment
    // adopts the server status; a copy that is already confirmed,
    // cancelled or further along is never downgraded from here (the
    // shopper's own cancel, for example, lives in the browser copy
    // only). A failed server payment is adopted too, so the retry
    // button below appears.
    if (browserOrder && browserOrder.status === "pending_payment") {
      let cancelled = false;
      void getOrderStatusFromServer(id).then((server) => {
        if (cancelled || !server) return;
        if (
          server.status === "pending_payment" &&
          server.paymentStatus === browserOrder.paymentStatus
        ) {
          return;
        }
        const updated = updateOrderStatus(id, {
          status: server.status,
          paymentStatus: server.paymentStatus,
        });
        if (updated) setOrder(updated);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [id]);

  // Apply the ?payment= outcome from the test-pay redirect to the
  // browser-stored order (the server-side in-memory record was already
  // updated by the test-pay action), then clean the query string.
  useEffect(() => {
    if (paymentApplied.current) return;
    const outcome = paymentQueryToOutcome(searchParams.get("payment"));
    if (!outcome) return;
    paymentApplied.current = true;
    const updated = updateOrderStatus(id, applyPaymentOutcome(outcome));
    if (updated) {
      setOrder(updated);
      setNotice(
        outcome === "success"
          ? "Test payment successful. Your order is confirmed."
          : outcome === "failed"
            ? "Test payment failed. Your order is still pending payment."
            : "Test payment cancelled. Your order has been cancelled.",
      );
    }
    router.replace(`/orders/${id}`);
  }, [id, searchParams, router]);

  function cancelOrder() {
    if (!order) return;
    const updated = updateOrderStatus(order.id, {
      status: "cancelled",
      paymentStatus: order.paymentStatus === "paid" ? "refunded" : "cancelled",
    });
    if (updated) {
      setOrder(updated);
      setNotice("Order cancelled. Stock for these items has been released back to inventory.");
    }
  }

  if (!loaded) {
    return (
      <main className="mx-auto max-w-[900px] px-4 py-10">
        <p className="text-muted">Loading order…</p>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="mx-auto max-w-[900px] px-4 py-10">
        <div className="rounded-2xl border border-border bg-panel p-10 text-center">
          <h1 className="text-2xl font-bold text-text">Order not found</h1>
          <p className="mt-2 text-muted">
            This order is not in your browser&apos;s saved orders. It may have
            been placed in a different browser or before the preview data was cleared.
          </p>
          <Link href="/orders" className="mt-6 inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 font-semibold text-white hover:bg-blue-600">
            Back to my orders
          </Link>
        </div>
      </main>
    );
  }

  const cancellable = ["pending_payment", "confirmed", "processing"].includes(order.status);
  const timelineIndex =
    order.status === "cancelled" || order.status === "refunded"
      ? -1
      : ORDER_TIMELINE_STEPS.findIndex((s) => s.key === order.status);

  return (
    <main className="mx-auto max-w-[900px] px-4 py-10">
      <Link href="/orders" className="text-sm text-brand hover:underline">← Back to my orders</Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted">Placed {formatDateTime(order.createdAt)}</p>
        </div>
        <span className="rounded-full bg-brand/20 px-3 py-1 text-sm font-semibold text-blue-300">
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      {notice && (
        <p role="status" className="mt-4 rounded-lg border border-success bg-panel px-4 py-3 text-sm text-success">
          {notice}
        </p>
      )}

      {/* Status timeline */}
      <section className="mt-6 rounded-2xl border border-border bg-panel p-5" aria-label="Order status">
        <h2 className="text-lg font-bold text-text">Status</h2>
        {timelineIndex === -1 ? (
          <p className="mt-3 rounded-lg bg-red-500/20 px-4 py-3 text-sm font-semibold text-red-300">
            This order was {order.status === "refunded" ? "cancelled and refunded" : "cancelled"}.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {ORDER_TIMELINE_STEPS.map((step, index) => {
              const done = index <= timelineIndex;
              const current = index === timelineIndex;
              return (
                <li key={step.key} className="flex items-center gap-3">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      done ? "bg-success text-ink" : "bg-surface text-muted"
                    }`}
                    aria-hidden="true"
                  >
                    {done ? <Check className="h-4 w-4" /> : index + 1}
                  </span>
                  <span className={`text-sm ${current ? "font-bold text-text" : done ? "text-text" : "text-muted"}`}>
                    {step.label}
                    {current && " — current status"}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Items */}
      <section className="mt-6 rounded-2xl border border-border bg-panel p-5" aria-label="Order items">
        <h2 className="text-lg font-bold text-text">Items</h2>
        <ul className="mt-4 space-y-3">
          {order.items.map((item) => (
            <li key={item.productId} className="flex items-center gap-3 text-sm">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface font-bold text-brand">
                {item.title.charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-text">{item.title}</span>
                <span className="text-muted">
                  Qty {item.quantity}
                  {item.variant ? ` · ${item.variant}` : ""}
                </span>
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
            <dt className="text-muted">Delivery ({order.delivery === "express" ? "Express" : "Standard"})</dt>
            <dd className="text-text">{order.deliveryFee_poisha === 0 ? "FREE" : formatBDT(order.deliveryFee_poisha)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
            <dt className="text-text">Total</dt>
            <dd className="text-text">{formatBDT(order.total_poisha)}</dd>
          </div>
        </dl>
      </section>

      {/* Address + payment */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <section className="rounded-2xl border border-border bg-panel p-5" aria-label="Delivery address">
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
        </section>
        <section className="rounded-2xl border border-border bg-panel p-5" aria-label="Payment">
          <h2 className="text-lg font-bold text-text">Payment</h2>
          <p className="mt-2 text-sm text-text">
            {PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}
            {order.testMode && (
              <span className="ml-2 rounded bg-accent px-2 py-0.5 text-xs font-bold text-white">TEST MODE</span>
            )}
          </p>
          <p className="mt-1 text-sm text-muted">
            Payment status: {PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}
          </p>
          {order.testMode && (
            <p className="mt-2 text-xs text-muted">Paid through the test gateway — no real money moved.</p>
          )}
          {order.status === "pending_payment" &&
            order.paymentMethod !== "cod" &&
            (order.paymentStatus === "failed" || order.paymentStatus === "unpaid") && (
              <div className="mt-4">
                <p className="text-sm text-muted">
                  This order is still unpaid. You can try the test payment again — nothing is charged twice.
                </p>
                <Link
                  href={`/checkout/test-pay?order=${order.id}&ref=test-ref-${order.orderNumber}`}
                  className="mt-3 inline-flex items-center justify-center rounded-lg bg-accent px-5 py-2.5 font-semibold text-white hover:bg-orange-600"
                >
                  Retry payment
                </Link>
              </div>
            )}
        </section>
      </div>

      {cancellable && (
        <div className="mt-6 rounded-2xl border border-border bg-panel p-5">
          <h2 className="text-lg font-bold text-text">Cancel this order</h2>
          <p className="mt-1 text-sm text-muted">
            Cancelling releases the stock for these items back to inventory.
            {order.paymentStatus === "paid" ? " Because this order was paid, the payment will be marked as refunded." : ""}
          </p>
          <button
            type="button"
            onClick={cancelOrder}
            className="mt-4 rounded-lg border border-red-400 px-5 py-2 font-semibold text-red-400 hover:bg-red-500/10"
          >
            Cancel order
          </button>
        </div>
      )}

      <div className="mt-6">
        <Link href="/orders" className="text-sm text-brand hover:underline">Back to my orders</Link>
      </div>
    </main>
  );
}

export default function OrderDetailPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-[900px] px-4 py-10"><p className="text-muted">Loading order…</p></main>}>
      <OrderDetailInner />
    </Suspense>
  );
}
