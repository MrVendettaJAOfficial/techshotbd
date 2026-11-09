"use server";

// Verified payment-callback order updates (lib/orders-server.ts).
// One job: updateSupabaseOrderFromCallback — append-only payment
// rows, never called from a browser-facing form or unverified request.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../supabase/server";
import { isLegalOrderTransition } from "../transitions";
import type { StoredOrder } from "../../checkout-store";
import {
  isConfigured,
  latestPaymentStatus,
  untyped,
  writeOrderAudit,
} from "./shared";

/**
 * Update an order's status + payment row from a VERIFIED payment
 * callback. Unlike updateSupabaseOrderStatus this does NOT require a
 * signed-in user session: a public callback has no user cookies. The
 * caller MUST have verified the callback signature first (see
 * app/api/payments/callback/route.ts) — that verification is the trust
 * boundary here, not a session. Never call this from a browser-facing
 * form or an unverified request.
 *
 * Payment attempts are APPEND-ONLY: every callback INSERTS a new
 * payments row for the attempt and never updates an existing row's
 * status, so a failed retry (or a replayed failed callback) can never
 * overwrite a paid record. The status move is validated like any
 * other transition (a same-status outcome, e.g. a failed payment on
 * an order still pending payment, is allowed) and written
 * conditionally on the current status, with a best-effort audit row.
 */
export async function updateSupabaseOrderFromCallback(
  orderId: string,
  patch: { status: StoredOrder["status"]; paymentStatus?: StoredOrder["paymentStatus"] },
): Promise<{ ok: true } | { ok: false; message: string }> {
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
