// Test-gateway payment callback route (POST /api/payments/callback).
//
// Verifies the signed callback, applies the payment outcome to the
// order and appends a payments attempt row. Verification fails
// closed when the signing secret is not configured.

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  adapterStatusToOutcome,
  applyPaymentOutcome,
  getOrderRecord,
  updateOrderRecordStatus,
} from "@/lib/orders";
import { checkCallbackOutcome } from "@/lib/orders/checkout/totals";
import { testAdapter } from "@/lib/payments/test-adapter";
import { loadSupabaseOrderForCallback, updateSupabaseOrderFromCallback } from "@/lib/orders-server";

// POST /api/payments/callback — test-gateway callback endpoint.
// Body: { orderId, status, timestamp, nonce, signature }. "status" is
// "paid" (the adapter's word) or "success" (the checkout UI's word)
// for a paid order, or "failed" / "cancelled". The signature is
// verified with the test adapter's HMAC check
// (testAdapter.verifyCallback), which also rejects stale timestamps
// and reused nonces — a replayed callback is rejected, so a failed
// retry can never overwrite a paid record. Errors are deliberately
// generic — no internals are leaked.
//
// The order is resolved memory-first, then from Supabase: the
// in-memory record lives only in the server process that took the
// checkout, so a callback that lands on a different instance (or
// after a restart) would otherwise 400 and leave a real paid order
// "pending payment" in the database. The database load is read-only
// and proves nothing — the signed callback proof below is still the
// trust check, and the Supabase leg re-verifies it itself before
// writing anything.
//
// NOTE: verification fails closed when TEST_PAYMENT_SIGNING_SECRET is not
// configured (see .env.example). Set it in .env.local before exercising
// this endpoint, or every callback returns 400 "Invalid callback".
const callbackSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["success", "paid", "failed", "cancelled"]),
  timestamp: z.number().int(),
  nonce: z.string().min(8).max(64),
  signature: z.string().min(1),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid callback" }, { status: 400 });
  }

  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid callback" }, { status: 400 });
  }

  const { orderId, signature, timestamp, nonce } = parsed.data;
  const adapterStatus = parsed.data.status === "success" ? "paid" : parsed.data.status;

  const memoryOrder = getOrderRecord(orderId);
  // Memory miss: the order may still be a real database row — the
  // callback can land on a different server than the checkout, or
  // the process may have restarted since. Load it from Supabase
  // and continue the same flow; the signed proof verified below
  // is the trust check, not the memory record. Only when neither
  // store has the order is it an invalid callback.
  const dbOrder = memoryOrder ? null : await loadSupabaseOrderForCallback(orderId);
  const order = memoryOrder ?? dbOrder;
  if (!order) {
    // Same generic response whether the order exists or not.
    return NextResponse.json({ ok: false, error: "Invalid callback" }, { status: 400 });
  }

  const verified = await testAdapter.verifyCallback(
    { orderId, status: adapterStatus, timestamp, nonce },
    signature,
  );
  if (!verified.valid) {
    return NextResponse.json({ ok: false, error: "Invalid callback" }, { status: 400 });
  }

  const outcome = adapterStatusToOutcome(adapterStatus);
  const patch = applyPaymentOutcome(outcome);
  // Validate the move ONCE, against the order's CURRENT status and
  // latest payment status, BEFORE either store is touched (audit
  // low 3, 2026-11-18): a signed-but-late outcome must never flip
  // a record the database would refuse. The check runs on `order`
  // — the memory record when one exists, else the database row
  // loaded above — so both stores are judged by the same state.
  // A duplicate outcome (it already landed) is acknowledged
  // without writing anything; an illegal one is refused with
  // nothing written. See checkCallbackOutcome() in
  // lib/orders/checkout/totals.ts for the exact rules.
  const verdict = checkCallbackOutcome(order, outcome);
  if (verdict === "duplicate") {
    return NextResponse.json({ ok: true, status: adapterStatus });
  }
  if (verdict === "illegal") {
    return NextResponse.json(
      { ok: false, error: "That status change is not allowed." },
      { status: 400 },
    );
  }
  // A verified-but-late cancellation of a paid order is refused
  // BEFORE any record is touched: a paid order is refunded,
  // never cancelled (the database callback enforces the same rule
  // below), and the memory copy must not flip to cancelled while
  // the database still says confirmed + paid. `order` here is the
  // memory record when one exists, else the database row loaded
  // above — either way its payment status is the guard.
  if (patch.status === "cancelled" && order.paymentStatus === "paid") {
    return NextResponse.json(
      { ok: false, error: "A paid order cannot be cancelled. Refund it instead." },
      { status: 400 },
    );
  }
  // Database leg FIRST, memory only on its success. The Supabase
  // leg re-verifies the signed proof itself before writing
  // anything (see lib/orders/server/callback.ts), and its result
  // is no longer discarded: a real rejection — an illegal
  // transition, a paid-order cancel, a lost race — returns the
  // failure instead of { ok: true } and the memory record is left
  // untouched, so the two stores can never diverge. Two results
  // are NOT rejections, they only mean there is no database row to
  // sync: Supabase unconfigured, or a memory-only (guest/local)
  // order with no database row — for those the memory record IS
  // the order, so the validated patch above is the whole update.
  // Only a memory record that exists can be updated in memory: a
  // database-only order (memory miss above) has no memory copy to
  // touch, and inventing one would put a partial record in the
  // path of the confirmation page.
  const synced = await updateSupabaseOrderFromCallback(orderId, patch, {
    payload: { orderId, status: adapterStatus, timestamp, nonce },
    signature,
  });
  if (!synced.ok) {
    if (
      synced.message === "Supabase is not configured." ||
      synced.message === "Order not found."
    ) {
      // No database row to sync: the memory record IS the order,
      // so the validated patch above is the whole update. When
      // there is no memory record either (the database row the
      // load above found vanished before the write), there is
      // nothing to update — that is a failure, not a success.
      if (memoryOrder) {
        updateOrderRecordStatus(orderId, patch);
        return NextResponse.json({ ok: true, status: adapterStatus });
      }
    }
    return NextResponse.json({ ok: false, error: synced.message }, { status: 400 });
  }
  if (memoryOrder) updateOrderRecordStatus(orderId, patch);
  return NextResponse.json({ ok: true, status: adapterStatus });
}
