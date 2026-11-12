// Test payment page (server component).
//
// Simulates the test gateway for an unpaid order: choose success,
// failed or cancelled and the outcome is applied to the order. No
// real money moves and no card or wallet details are ever collected
// here.
//
// This simulation is SECURED, not open (security audit 2026-11-12,
// all 3 HIGHs fixed):
//   * Ownership — only the order's owner may pay it: the signed-in
//     owner (checked against orders.user_id, falling back to the
//     memory record's userId) or, for a guest order, the browser
//     that placed it, presenting the order's random buyerToken
//     (carried as ?key= on the redirect URL and as a hidden form
//     field). An anonymous or non-owner request is redirected to
//     /orders with nothing applied.
//   * State — an outcome is legal only out of pending_payment (see
//     isLegalTestPaymentOutcome): a paid order can never be
//     cancelled or double-paid, a cancelled order can never be
//     resurrected, and a COD order can never gain a paid row. A
//     refused paid-order cancel carries a refund direction to the
//     order page (?notice=refund, owner only — ownership already
//     passed); every other refusal stays generic.
//   * Fail closed — without TEST_PAYMENT_SIGNING_SECRET the page
//     renders no pay buttons and the action applies nothing.
//   * Proof — the outcome is signed server-side and the Supabase
//     leg verifies that proof itself before writing (see
//     lib/orders/server/callback.ts); the memory record is only
//     updated after the Supabase leg succeeds, so the two stores
//     can never diverge the way they did before.
// Redirects are deliberately generic: they never say which check
// failed.

import Link from "next/link";
import { redirect } from "next/navigation";
import { formatBDT } from "@/lib/theme";
import {
  applyPaymentOutcome,
  getOrderRecord,
  isLegalTestPaymentOutcome,
  outcomeToAdapterStatus,
  updateOrderRecordStatus,
  type PaymentOutcome,
} from "@/lib/orders";
import type { StoredOrder } from "@/lib/checkout-store";
import {
  buyerTokenMatches,
  createTestCallbackPayload,
  isTestPaymentSigningConfigured,
  signTestCallback,
  verifyCallbackSignature,
} from "@/lib/payments/test-adapter";
import { updateSupabaseOrderFromCallback } from "@/lib/orders-server";
import { getCurrentUser } from "@/lib/auth-server";
import { adminClient, loadOrder } from "@/lib/orders/actions/shared";
import { isConfigured } from "@/lib/orders/server/shared";

/**
 * Ownership against the in-memory record: a signed-in order needs
 * the caller's session id to match its userId; a guest order needs
 * the submitted buyer token to match the order's key, compared in
 * constant time. Either side missing its proof fails.
 */
async function memoryOrderBelongsToCaller(
  order: StoredOrder,
  formData: FormData,
): Promise<boolean> {
  if (order.userId) {
    const user = await getCurrentUser();
    return user?.id === order.userId;
  }
  const submitted = formData.get("buyerToken");
  return buyerTokenMatches(
    order.buyerToken,
    typeof submitted === "string" ? submitted : null,
  );
}

// Server action: runs the test-payment outcome for the order's owner
// only (see the header) and redirects to the order page with the
// outcome in the query string. No real card details are ever
// collected on this page. Every failure path redirects without
// applying anything — a verification error is never treated as a
// successful verification.
async function testPayAction(formData: FormData) {
  "use server";
  const orderId = String(formData.get("orderId") ?? "");
  const outcome = String(formData.get("outcome") ?? "") as PaymentOutcome;
  if (!["success", "failed", "cancelled"].includes(outcome) || !orderId) {
    redirect("/orders");
  }
  // Fail closed without the signing secret: no outcome is ever
  // applied, and the page renders no pay buttons either.
  if (!isTestPaymentSigningConfigured()) {
    redirect(`/orders/${orderId}?payment=failed`);
  }
  const order = getOrderRecord(orderId);
  if (!order) redirect("/orders");

  // Ownership — the database row wins when one exists, else the
  // memory record. A signed-in order needs the caller's session;
  // a guest order needs its buyer token (see
  // memoryOrderBelongsToCaller). Any failure redirects to /orders.
  let dbOrder: Awaited<ReturnType<typeof loadOrder>> = null;
  if (isConfigured()) {
    const admin = adminClient();
    if (admin) dbOrder = await loadOrder(admin, orderId);
  }
  let owns = false;
  if (dbOrder) {
    if (dbOrder.userId) {
      const user = await getCurrentUser();
      owns = user?.id === dbOrder.userId;
    } else {
      // Defensive: a database order should always carry a user id.
      owns = await memoryOrderBelongsToCaller(order, formData);
    }
  } else {
    owns = await memoryOrderBelongsToCaller(order, formData);
  }
  if (!owns) redirect("/orders");

  // State guard — against the database status when a database row
  // exists (the source of truth), else the memory record. On a
  // refusal the redirect carries no ?payment=, so no misleading
  // banner is shown and nothing is applied. One exception, for the
  // owner only (ownership already passed): a paid order refused a
  // cancel is directed to a refund, like the customer-cancel rule —
  // the order page renders that direction and applies nothing.
  const guardStatus = dbOrder?.status ?? order.status;
  const guardPayment = dbOrder?.paymentStatus ?? order.paymentStatus;
  if (
    !isLegalTestPaymentOutcome(
      guardStatus,
      guardPayment,
      order.paymentMethod,
      outcome,
    )
  ) {
    if (outcome === "cancelled" && guardPayment === "paid") {
      redirect(`/orders/${orderId}?notice=refund`);
    }
    redirect(`/orders/${orderId}`);
  }

  // Sign, then verify through the pure signature + freshness check.
  // The nonce is fresh per click and is NOT consumed here — replay
  // protection stays at the public callback route. Any failure
  // fails CLOSED: nothing is applied.
  const adapterStatus = outcomeToAdapterStatus(outcome);
  let payload: ReturnType<typeof createTestCallbackPayload>;
  let signature: string;
  try {
    payload = createTestCallbackPayload(orderId, adapterStatus);
    signature = signTestCallback(
      payload.orderId,
      payload.status,
      payload.timestamp,
      payload.nonce,
    );
  } catch {
    redirect(`/orders/${orderId}?payment=failed`);
  }
  if (!verifyCallbackSignature(payload, signature)) {
    redirect(`/orders/${orderId}?payment=failed`);
  }

  // Supabase leg FIRST, memory only on success — when a database
  // row exists. If the database refuses the move, the memory record
  // is left untouched, so the two stores never diverge. A local
  // (guest) order has no database row: there is no database leg to
  // diverge from, so the memory patch is the whole update — the
  // Supabase leg is skipped, not failed, for it. The callback
  // function verifies the signed proof itself before writing
  // anything.
  const patch = applyPaymentOutcome(outcome);
  if (dbOrder) {
    const synced = await updateSupabaseOrderFromCallback(orderId, patch, {
      payload,
      signature,
    });
    if (!synced.ok) {
      redirect(`/orders/${orderId}?payment=failed`);
    }
  }
  updateOrderRecordStatus(orderId, patch);
  redirect(`/orders/${orderId}?payment=${outcome}`);
}

export default function TestPayPage({
  searchParams,
}: {
  searchParams: { order?: string; ref?: string; key?: string };
}) {
  const orderId = searchParams.order ?? "";
  const providerRef = searchParams.ref ?? "";
  const buyerKey = searchParams.key ?? "";
  const order = orderId ? getOrderRecord(orderId) : null;

  if (!order) {
    return (
      <main className="mx-auto max-w-[720px] px-4 py-10">
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-3 text-sm font-bold text-amber-700">
          TEST MODE — no real payment is processed on this site.
        </div>
        <div className="mt-6 rounded-2xl border border-border bg-panel p-8 text-center">
          <h1 className="text-2xl font-bold text-text">Order not found</h1>
          <p className="mt-2 text-muted">
            We could not find a test payment for this order. It may have been
            created in your browser only, or the preview server may have
            restarted. Check your orders list, which is stored in your browser.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/orders" className="rounded-lg bg-brandDark px-5 py-3 font-semibold text-white hover:bg-brandDarker">
              View my orders
            </Link>
            <Link href="/" className="rounded-lg border border-border bg-panel px-5 py-3 font-medium text-text hover:border-brand">
              Back to home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // The action is the enforcement point; the page only hides the
  // buttons when the signing secret is unset, so a missing secret
  // is visible instead of silently accepted.
  const signingConfigured = isTestPaymentSigningConfigured();

  return (
    <main className="mx-auto max-w-[720px] px-4 py-10">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-3 text-sm font-bold text-amber-700">
        TEST MODE — no real payment is processed. Choose an outcome below to simulate the test gateway.
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-panel p-6">
        <h1 className="text-2xl font-bold text-text">Test payment</h1>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Order number</dt>
            <dd className="font-semibold text-text">{order.orderNumber}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Payment method</dt>
            <dd className="text-text">
              {order.paymentMethod === "card" && "Card"}
              {order.paymentMethod === "bkash" && "bKash"}
              {order.paymentMethod === "nagad" && "Nagad"}
              {order.paymentMethod === "emi" && "EMI"}
              {order.paymentMethod === "cod" && "Cash on Delivery"}
              {" · TEST MODE"}
            </dd>
          </div>
          {providerRef && (
            <div className="flex justify-between">
              <dt className="text-muted">Provider reference</dt>
              <dd className="text-text">{providerRef}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
            <dt className="text-text">Amount to pay</dt>
            <dd className="text-text">{formatBDT(order.total_poisha)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted">
          No card or wallet details are collected here. The buttons below only simulate what a test gateway would return.
        </p>
      </div>

      {!signingConfigured ? (
        <div className="mt-6 rounded-2xl border border-border bg-panel p-6 text-center">
          <h2 className="text-xl font-bold text-text">Test payments unavailable</h2>
          <p className="mt-2 text-sm text-muted">
            Test payments are unavailable right now. The test payment signing secret is not configured.
          </p>
          <Link href="/orders" className="mt-5 inline-flex items-center justify-center rounded-lg bg-brandDark px-5 py-3 font-semibold text-white hover:bg-brandDarker">
            View my orders
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <form action={testPayAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="outcome" value="success" />
            {buyerKey && <input type="hidden" name="buyerToken" value={buyerKey} />}
            <button type="submit" className="w-full rounded-lg bg-success px-5 py-3 font-semibold text-white hover:opacity-90">
              Pay successfully (test)
            </button>
          </form>
          <form action={testPayAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="outcome" value="failed" />
            {buyerKey && <input type="hidden" name="buyerToken" value={buyerKey} />}
            <button type="submit" className="w-full rounded-lg bg-[#b91c1c] px-5 py-3 font-semibold text-white hover:bg-[#991b1b]">
              Simulate failed payment
            </button>
          </form>
          <form action={testPayAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="outcome" value="cancelled" />
            {buyerKey && <input type="hidden" name="buyerToken" value={buyerKey} />}
            <button type="submit" className="w-full rounded-lg border border-border bg-panel px-5 py-3 font-semibold text-text hover:border-brand">
              Cancel payment
            </button>
          </form>
        </div>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        After you choose, you will be taken to your order with the updated status.
      </p>
    </main>
  );
}
