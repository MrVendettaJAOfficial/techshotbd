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
  // Only a memory record that exists can be updated in memory: a
  // database-only order (memory miss above) has no memory copy to
  // touch, and inventing one would put a partial record in the
  // path of the confirmation page.
  if (memoryOrder) updateOrderRecordStatus(orderId, patch);
  // Keep the live Supabase order in sync too. This runs only after the
  // callback signature was verified above, which is the trust boundary —
  // and the proof is passed through so the callback function verifies
  // the signature + freshness itself before writing anything.
  await updateSupabaseOrderFromCallback(orderId, patch, {
    payload: { orderId, status: adapterStatus, timestamp, nonce },
    signature,
  });
  return NextResponse.json({ ok: true, status: adapterStatus });
}
