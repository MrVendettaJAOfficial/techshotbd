// Order detail page (client component).
//
// Shows one order: status timeline, items and totals, delivery
// address, payment, and cancel (pending payment / confirmed only).
// The browser copy is reconciled with the server record, so a
// payment completed through the callback route or an admin move
// shows up here. A payment outcome is NEVER taken from the query
// string (audit low 4, 2026-11-18): the payment query parameter
// used to rewrite the browser copy to confirmed/paid with no check
// that any payment happened, and the forgery survived reloads. The
// test-pay redirect now lands here with no query parameter, and
// the page only ever adopts a payment the server itself reports
// (see the reconciliation below) — the "payment successful"
// notice is shown only after the server returns paymentStatus
// "paid" for this order. Guests have no session, so the signed-in
// read returns null for them; the reconciliation falls back to the
// buyerToken proof (getGuestOrderStatusFromServer), the token the
// guest's own copy carries. A browser copy that claims
// paid/delivered with no server record behind it is labelled
// unverified instead (audit low 5).
//
// The presentational sections live in components/order-detail/
// (summary, timeline, items); this page keeps the order loading,
// reconciliation, payment-outcome and cancel logic.

"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getOrderStatusFromServer, listSupabaseOrders } from "@/lib/orders-server";
import { getGuestOrderStatusFromServer } from "@/lib/orders/server/guest-status";
import { cancelMyOrder } from "@/lib/orders/actions";
import { getSession } from "@/lib/auth";
import {
  getOrder,
  saveOrder,
  updateOrderStatus,
  type StoredOrder,
} from "@/lib/checkout-store";
import OrderSummary from "@/components/order-detail/summary";
import OrderTimeline from "@/components/order-detail/timeline";
import OrderItems from "@/components/order-detail/items";

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

function OrderDetailInner() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [order, setOrder] = useState<StoredOrder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeHandled = useRef(false);
  // Whether the server has a record for this order (audit low 5):
  // null while the server check has not resolved yet, true when
  // getOrderStatusFromServer() returned a record, false when it
  // resolved with nothing. A browser copy that claims paid or
  // delivered while this is false is labelled unverified below —
  // the claim comes from this browser only, not from the shop.
  const [serverCorroborated, setServerCorroborated] = useState<boolean | null>(null);

  const id = params.id;

  // Who is looking? Resolved once here so the browser-local copy
  // below is scoped to that viewer (a signed-in user id, or null
  // for a guest): another account's local order never renders here
  // (audit #9). `undefined` means "not resolved yet" — the load
  // below waits for it.
  const [viewerId, setViewerId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void getSession()
      .catch(() => null)
      .then((session) => {
        if (!cancelled) setViewerId(session?.user?.id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Wait for the viewer: reading the browser copy before the
    // session resolves would read it unscoped.
    if (viewerId === undefined) return;
    const browserOrder = getOrder(id, viewerId);
    if (!browserOrder) {
      // No browser copy (new device/browser, or cleared data): load the
      // live order the same way /orders does. Without this, clicking an
      // order from the (now live) /orders list on a fresh browser landed
      // on "Order not found". The live copy is registered in the browser
      // store so cancel / retry / status flows below, which work on the
      // browser copy, behave exactly as before. listSupabaseOrders
      // returns [] when Supabase is not configured or nobody is signed
      // in, so guests keep the "Order not found" page as before.
      let cancelled = false;
      void (async () => {
        let live: StoredOrder | null = null;
        try {
          const orders = await listSupabaseOrders();
          live = orders.find((o) => o.id === id) ?? null;
        } catch {
          live = null;
        }
        if (cancelled) return;
        if (live) {
          saveOrder(live);
          setOrder(live);
          // The live order came from the server, so its paid /
          // delivered state is corroborated by definition.
          setServerCorroborated(true);
        } else {
          setServerCorroborated(false);
        }
        setLoaded(true);
      })();
      return () => {
        cancelled = true;
      };
    }
    setOrder(browserOrder);
    setLoaded(true);
    // Reconcile with the server: a payment completed through the
    // public callback route updates the server-side record, not this
    // browser copy — without this, an order paid by callback would
    // say "Pending payment" here forever. The same is true of admin
    // moves (advance, return, refund, cancel): they update the
    // server record, so without this an order the admin advanced
    // would say "Confirmed" here forever, even though /orders (live
    // wins in the merge) already shows the new status. Only forward
    // moves are adopted: the server status must be later in the flow
    // than the browser copy, or a terminal exit (cancelled /
    // refunded / returned) while the copy is still in-flow. A copy
    // that is already terminal is never overwritten, and the server
    // is never allowed to move the copy backwards (the shopper's own
    // cancel, for example, lives in the browser copy only). A failed
    // server payment is adopted too while the copy is still pending
    // payment, so the retry button below appears.
    if (browserOrder) {
      let cancelled = false;
      void (async () => {
        let server = await getOrderStatusFromServer(id);
        // Guests have no session, so the signed-in read above
        // always returns null for them — a guest's own order could
        // never adopt a server payment, and after the ?payment=
        // removal (audit low 4) a guest who paid saw "Pending
        // payment" forever. Fall back to the buyerToken proof: the
        // token the guest's own copy carries, checked against the
        // in-memory record (same proof as the cancel flow). The
        // fallback returns the server's status, never the copy's
        // claims, so a forged copy still cannot corroborate itself.
        if (!server && browserOrder.buyerToken) {
          server = await getGuestOrderStatusFromServer(id, browserOrder.buyerToken);
        }
        if (cancelled) return;
        // No server record: the browser copy stands uncorroborated
        // (see the unverified label below). A record means the
        // server has this order — the claims below adopt it.
        setServerCorroborated(server !== null);
        if (!server) return;
        const flow = ["pending_payment", "confirmed", "processing", "shipped", "delivered"];
        const terminal = ["cancelled", "refunded", "returned"];
        const serverAhead = flow.indexOf(server.status) > flow.indexOf(browserOrder.status);
        const serverTerminal =
          terminal.includes(server.status) && !terminal.includes(browserOrder.status);
        const paymentChanged =
          browserOrder.status === "pending_payment" &&
          server.paymentStatus !== browserOrder.paymentStatus;
        // A payment the server reports as paid is adopted even
        // when the browser copy already left pending_payment (an
        // admin advance of an unpaid order, paid afterwards): the
        // server is the corroboration, and the copy must not keep
        // saying "unpaid" once the shop's record says paid.
        const serverPaid =
          server.paymentStatus === "paid" && browserOrder.paymentStatus !== "paid";
        if (!serverAhead && !serverTerminal && !paymentChanged && !serverPaid) return;
        if (
          server.status === browserOrder.status &&
          server.paymentStatus === browserOrder.paymentStatus
        ) {
          return;
        }
        const updated = updateOrderStatus(
          id,
          {
            status: server.status,
            paymentStatus: server.paymentStatus,
          },
          undefined,
          { corroborated: true },
        );
        if (updated) {
          setOrder(updated);
          // The success notice is shown ONLY here — after the
          // server itself returned paymentStatus "paid" for this
          // order, never from a query string (audit low 4).
          if (serverPaid) {
            setNotice("Test payment successful. Your order is confirmed.");
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [id, viewerId]);

  // A refund direction the test-pay page carries for the owner only
  // (?notice=refund): a paid order refused a cancel there. It shows
  // the direction and applies nothing to the order — the value is a
  // fixed key, never rendered raw. There is deliberately NO
  // ?payment= handling here any more (audit low 4): a query string
  // is not proof of payment, so the page never applies an outcome
  // from it. The test-pay redirect lands with no query parameter,
  // and a paid order shows as paid only once the server says so
  // (see the reconciliation above).
  useEffect(() => {
    if (noticeHandled.current) return;
    if (searchParams.get("notice") === "refund") {
      noticeHandled.current = true;
      setNotice(
        "This order was already paid, so it can't be cancelled here. Please contact us for a refund.",
      );
      router.replace(`/orders/${id}`);
    }
  }, [id, searchParams, router]);

  const [cancelling, setCancelling] = useState(false);

  // Cancel through the server: the live order is cancelled in
  // Supabase (owner-checked, stock restored, audit row written) and
  // the admin sees it. The "stock released" message is shown ONLY
  // after the server confirms. When there is no live order to cancel
  // (guest / browser-only order), the browser copy is cancelled
  // instead and the notice says so honestly — no stock claim.
  //
  // The browser copy's buyerToken is passed through so a guest
  // whose order IS a live database row can be told, honestly, to
  // contact us instead of seeing a fake browser-only cancel: the
  // server proves guest ownership against the token and refuses
  // the cancel with a contact-us error, leaving the live order
  // (and its stock) untouched.
  //
  // The outcome is persisted ON THE STORED ORDER (cancelNotice),
  // not only in component state: the cancel server action
  // revalidates the order pages, and that refresh remounts this
  // page — wiping a transient notice even though the cancel
  // succeeded (proven 2026-11-08: live cancel + stock restore +
  // audit row all landed, yet no notice showed). Deriving the
  // notice from the stored order below survives the remount,
  // because the remounted page reloads the order from storage.
  async function cancelOrder() {
    if (!order || cancelling) return;
    setCancelling(true);
    try {
      const result = await cancelMyOrder(order.id, order.buyerToken ?? null);
      if (result.ok) {
        const updated = updateOrderStatus(order.id, {
          status: "cancelled",
          paymentStatus: order.paymentStatus,
          cancelNotice: "live",
        });
        if (updated) setOrder(updated);
        setNotice("Order cancelled. Stock for these items has been released back to inventory.");
        return;
      }
      if (result.localOnly) {
        const updated = updateOrderStatus(order.id, {
          status: "cancelled",
          paymentStatus: order.paymentStatus === "paid" ? "refunded" : "cancelled",
          cancelNotice: "local",
        });
        if (updated) setOrder(updated);
        setNotice("Order cancelled in this browser. This order was not saved to your account.");
        return;
      }
      setNotice(result.error);
    } finally {
      setCancelling(false);
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
          <Link href="/orders" className="mt-6 inline-flex items-center justify-center rounded-lg bg-brandDark px-5 py-3 font-semibold text-white hover:bg-brandDarker">
            Back to my orders
          </Link>
        </div>
      </main>
    );
  }

  const cancellable = ["pending_payment", "confirmed"].includes(order.status);
  // The notice to show: the transient one (payment outcomes, server
  // errors) first, otherwise the persisted cancel outcome — the
  // remount after a server-action refresh wipes the transient state,
  // but the stored order reloads with cancelNotice intact (see
  // cancelOrder above), so a confirmed live cancel still shows its
  // stock-released message after the refresh. Last, a failed test
  // payment: the order itself records paymentStatus "failed" while
  // still pending_payment (written by the test-pay action, or
  // adopted from the server by the reconciliation above), so the
  // "still pending" guidance is derived from the order's own state
  // — never from a query string (audit low 4). Claiming "failed"
  // grants nothing (no paid state, no goods), so this one needs no
  // server corroboration; the success notice above it still does.
  const shownNotice =
    notice ??
    (order.cancelNotice === "live"
      ? "Order cancelled. Stock for these items has been released back to inventory."
      : order.cancelNotice === "local"
        ? "Order cancelled in this browser. This order was not saved to your account."
        : order.status === "pending_payment" && order.paymentStatus === "failed"
          ? "Test payment failed. Your order is still pending payment."
          : null);

  return (
    <main className="mx-auto max-w-[900px] px-4 py-10">
      <Link href="/orders" className="text-sm text-brandDark hover:underline">← Back to my orders</Link>
      <OrderSummary order={order} notice={shownNotice} />

      {/* Unverified browser copy (audit low 5): this order claims
          paid or delivered, but the server has no record of it —
          the claim comes from this browser's saved copy only, not
          from the shop. It is labelled, not hidden: a guest's own
          legitimately placed order is still listed, but nobody can
          mistake an uncorroborated copy for a confirmed payment. */}
      {serverCorroborated === false &&
        (order.paymentStatus === "paid" || order.status === "delivered") && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-3 text-sm font-bold text-amber-700" role="status">
            Unverified copy — this order is saved in this browser only and has not been confirmed by the shop.
          </div>
        )}

      <OrderTimeline order={order} />

      <OrderItems order={order} />

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
              <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-700">TEST MODE</span>
            )}
          </p>
          <p className="mt-1 text-sm text-muted">
            Payment status: {PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}
            {serverCorroborated === false && order.paymentStatus === "paid" && " (unverified)"}
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
                  href={`/checkout/test-pay?order=${order.id}&ref=test-ref-${order.orderNumber}${order.buyerToken ? `&key=${encodeURIComponent(order.buyerToken)}` : ""}`}
                  className="mt-3 inline-flex items-center justify-center rounded-lg bg-[#b91c1c] px-5 py-2.5 font-semibold text-white transition hover:bg-[#991b1b]"
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
            disabled={cancelling}
            className="mt-4 rounded-lg border border-red-700 px-5 py-2 font-semibold text-red-700 hover:bg-red-500/10 disabled:opacity-50"
          >
            {cancelling ? "Cancelling…" : "Cancel order"}
          </button>
        </div>
      )}

      <div className="mt-6">
        <Link href="/orders" className="text-sm text-brandDark hover:underline">Back to my orders</Link>
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
