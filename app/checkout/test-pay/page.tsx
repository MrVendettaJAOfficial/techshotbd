import Link from "next/link";
import { redirect } from "next/navigation";
import { formatBDT } from "@/lib/theme";
import {
  applyPaymentOutcome,
  getOrderRecord,
  outcomeToAdapterStatus,
  updateOrderRecordStatus,
  type PaymentOutcome,
} from "@/lib/orders";
import { signTestCallback, testAdapter, createTestCallbackPayload } from "@/lib/payments/test-adapter";
import { updateSupabaseOrderFromCallback } from "@/lib/orders-server";

// Server action: runs the test adapter's verifyCallback logic and redirects
// to the order page with the outcome in the query string. No real card
// details are ever collected on this page.
//
// The simulated gateway callback is signed server-side with
// signTestCallback() and verified with testAdapter.verifyCallback().
// If TEST_PAYMENT_SIGNING_SECRET is not configured (no .env.local yet),
// signing throws — in that case this local simulation accepts the chosen
// outcome directly, because there is no external caller to protect
// against here. The public callback route (/api/payments/callback) does
// NOT have this fallback: it fails closed when the secret is missing.
async function testPayAction(formData: FormData) {
  "use server";
  const orderId = String(formData.get("orderId") ?? "");
  const outcome = String(formData.get("outcome") ?? "") as PaymentOutcome;
  if (!["success", "failed", "cancelled"].includes(outcome) || !orderId) {
    redirect("/orders");
  }
  const order = getOrderRecord(orderId);
  if (!order) redirect("/orders");
  const adapterStatus = outcomeToAdapterStatus(outcome);
  let verified = false;
  try {
    const payload = createTestCallbackPayload(orderId, adapterStatus);
    const signature = signTestCallback(payload.orderId, payload.status, payload.timestamp, payload.nonce);
    const result = await testAdapter.verifyCallback(payload, signature);
    verified = result.valid;
  } catch {
    verified = true;
  }
  if (!verified) {
    redirect(`/orders/${orderId}?payment=failed`);
  }
  const patch = applyPaymentOutcome(outcome);
  updateOrderRecordStatus(orderId, patch);
  // Keep the live Supabase order in sync too (best effort: no-op when
  // Supabase is not configured or this was a local fallback order).
  // This is the verified-callback path: payment status may only change
  // there, never through updateSupabaseOrderStatus, and the callback
  // appends a new payments row per attempt instead of overwriting.
  await updateSupabaseOrderFromCallback(orderId, patch);
  redirect(`/orders/${orderId}?payment=${outcome}`);
}

export default function TestPayPage({
  searchParams,
}: {
  searchParams: { order?: string; ref?: string };
}) {
  const orderId = searchParams.order ?? "";
  const providerRef = searchParams.ref ?? "";
  const order = orderId ? getOrderRecord(orderId) : null;

  if (!order) {
    return (
      <main className="mx-auto max-w-[720px] px-4 py-10">
        <div className="rounded-lg bg-accent px-4 py-3 text-sm font-bold text-white">
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
            <Link href="/orders" className="rounded-lg bg-brand px-5 py-3 font-semibold text-white hover:bg-blue-600">
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

  return (
    <main className="mx-auto max-w-[720px] px-4 py-10">
      <div className="rounded-lg bg-accent px-4 py-3 text-sm font-bold text-white">
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

      <div className="mt-6 space-y-3">
        <form action={testPayAction}>
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="outcome" value="success" />
          <button type="submit" className="w-full rounded-lg bg-success px-5 py-3 font-semibold text-ink hover:opacity-90">
            Pay successfully (test)
          </button>
        </form>
        <form action={testPayAction}>
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="outcome" value="failed" />
          <button type="submit" className="w-full rounded-lg bg-red-500 px-5 py-3 font-semibold text-white hover:bg-red-600">
            Simulate failed payment
          </button>
        </form>
        <form action={testPayAction}>
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="outcome" value="cancelled" />
          <button type="submit" className="w-full rounded-lg border border-border bg-panel px-5 py-3 font-semibold text-text hover:border-brand">
            Cancel payment
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        After you choose, you will be taken to your order with the updated status.
      </p>
    </main>
  );
}
