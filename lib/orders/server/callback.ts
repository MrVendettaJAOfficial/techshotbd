"use server";

// Verified payment-callback order updates (lib/orders-server.ts).
// One job: updateSupabaseOrderFromCallback — append-only payment
// rows, never called from a browser-facing form or unverified request.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../supabase/server";
import { verifyCallbackSignature } from "../../payments/test-adapter";
import { isLegalOrderTransition } from "../transitions";
import { restoreOrderStock } from "../stock";
import type { StoredOrder } from "../../checkout-store";
import {
  isConfigured,
  latestPaymentStatus,
  untyped,
  writeOrderAudit,
} from "./shared";

/** A signed callback proof: the payload the gateway signed, plus
 *  its HMAC signature. The nonce here is NOT consumed — replay
 *  protection stays at the public callback route, which verifies
 *  through testAdapter.verifyCallback (single-use nonce); test-pay
 *  mints a fresh nonce per click. */
export interface CallbackProof {
  payload: {
    orderId: string;
    status: string;
    timestamp: number;
    nonce: string;
  };
  signature: string;
}

/**
 * Update an order's status + payment row from a VERIFIED payment
 * callback. Unlike updateSupabaseOrderStatus this does NOT require a
 * signed-in user session: a public callback has no user cookies. The
 * trust boundary is now enforced HERE, not at the call site: the
 * caller must supply a signed callback proof, which this function
 * verifies itself (signature + freshness, via
 * verifyCallbackSignature) BEFORE any database write — an unverified
 * or unsigned call changes nothing. The nonce replay check stays at
 * the public route (testAdapter.verifyCallback consumes the nonce);
 * test-pay creates a fresh nonce per click. Never call this from a
 * browser-facing form or an unverified request.
 *
 * Payment attempts are APPEND-ONLY: every callback INSERTS a new
 * payments row for the attempt and never updates an existing row's
 * status, so a failed retry (or a replayed failed callback) can never
 * overwrite a paid record. The status move is validated like any
 * other transition (a same-status outcome, e.g. a failed payment on
 * an order still pending payment, is allowed) and written
 * conditionally on the current status, with a best-effort audit row.
 *
 * Paid-order rule (mirrors the admin path in
 * lib/orders/actions/shared.ts changeOrderStatus): a callback must
 * NEVER cancel a paid order. A late gateway cancellation of a paid
 * order is rejected with the same message the admin path uses — the
 * order stays confirmed + paid, and the refund flow (not a plain
 * cancel) is the only way the money goes back. A cancelled outcome
 * only cancels an UNPAID (pending_payment) order, and when it lands
 * the stock is restored, exactly as the admin cancel does.
 */
export async function updateSupabaseOrderFromCallback(
  orderId: string,
  patch: { status: StoredOrder["status"]; paymentStatus?: StoredOrder["paymentStatus"] },
  proof: CallbackProof,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Proof first: an unsigned, wrongly signed, stale or
  // secret-less callback writes nothing — fail closed.
  if (
    !proof ||
    proof.payload.orderId !== orderId ||
    !verifyCallbackSignature(proof.payload, proof.signature)
  ) {
    return { ok: false, message: "Invalid callback." };
  }
  if (!isConfigured()) return { ok: false, message: "Supabase is not configured." };
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, message: "Supabase is not configured." };
  }
  const { data: order } = await admin
    .from("orders")
    .select("id, status, payment_method, total_poisha")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, message: "Order not found." };
  const currentStatus = order.status as StoredOrder["status"];
  const currentPayment = await latestPaymentStatus(admin, orderId);
  if (patch.status !== currentStatus) {
    if (!isLegalOrderTransition(currentStatus, patch.status, currentPayment)) {
      return { ok: false, message: "That status change is not allowed." };
    }
  }
  // A paid order must be refunded, never cancelled (mirror the admin
  // path): cancelling would leave the customer charged with no money
  // returned, close the refund path (a 'failed' payments row would
  // bury the paid row) and never restore stock. Reject the late
  // cancellation instead of landing 'cancelled'.
  if (patch.status === "cancelled" && currentPayment === "paid") {
    return { ok: false, message: "A paid order cannot be cancelled. Refund it instead." };
  }
  const { data: updated, error } = await admin
    .from("orders")
    .update({ status: patch.status })
    .eq("id", orderId)
    .eq("status", currentStatus)
    .select("id");
  if (error) return { ok: false, message: "Could not update the order." };
  if (!Array.isArray(updated) || updated.length !== 1) {
    return { ok: false, message: "Could not update the order." };
  }
  // A cancelled outcome only cancels an unpaid order (see the guard
  // above), and the stock it claimed goes back — mirroring
  // restoreStockAfterStatusChange in the admin path. Only when the
  // order actually moved into 'cancelled': a repeated cancelled
  // callback for an already-cancelled order must not restore the
  // same stock a second time.
  if (patch.status === "cancelled" && currentStatus !== "cancelled") {
    try {
      const { restored, skipped } = await restoreOrderStock(admin, orderId);
      if (skipped > 0) {
        console.error(
          `TechShot callback stock restore for order ${orderId}: ${restored} line(s) restored, ${skipped} line(s) could not be attributed to a stock row.`,
        );
      }
    } catch (error) {
      console.error(
        `TechShot callback stock restore for order ${orderId} failed:`,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  if (patch.paymentStatus && patch.paymentStatus !== "unpaid") {
    const paymentStatus =
      patch.paymentStatus === "paid"
        ? "paid"
        : patch.paymentStatus === "failed"
          ? "failed"
          : patch.paymentStatus === "cancelled"
            ? "failed"
            : "refunded";
    try {
      const { error: insertError } = await admin.from("payments").insert({
        order_id: orderId,
        provider: order.payment_method ?? "cod",
        amount_poisha: order.total_poisha,
        status: paymentStatus,
      });
      if (insertError) {
        console.error("TechShot callback payment row insert failed:", insertError.message);
      }
    } catch (error) {
      console.error(
        "TechShot callback payment row insert failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  await writeOrderAudit(admin, null, orderId, currentStatus, patch.status, "payment-callback");
  return { ok: true };
}
