"use server";

// Order status reads and owner/admin status syncs (lib/orders-server.ts).
// One job: updateSupabaseOrderStatus (guarded, audited) and
// getOrderStatusFromServer (DB row first, in-memory record fallback).

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../supabase/server";
import { getOrderRecord } from "../../orders";
import { isLegalOrderTransition } from "../transitions";
import type { StoredOrder } from "../../checkout-store";
import {
  getSignedInUser,
  getSignedInUserId,
  isConfigured,
  latestPaymentStatus,
  untyped,
  writeOrderAudit,
} from "./shared";

/**
 * Sync a Supabase order's status after a payment outcome (or a
 * cancellation). Only the order's owner or an admin may do this.
 *
 * Guardrails (review fixes):
 *   - patch.status is validated with isLegalOrderTransition() against
 *     the order's CURRENT status and latest payment status — a
 *     customer can no longer self-mark their own order "delivered"
 *     (unlocking reviews) or "refunded". Delivered / refunded moves
 *     are admin-only.
 *   - patch.paymentStatus is REJECTED from this path entirely:
 *     payment status may only change via the verified callback
 *     (updateSupabaseOrderFromCallback), which appends a new attempt
 *     row. Callers that used to pass a payment status here (the
 *     test-pay page) now use the callback path instead.
 *   - The update is conditional on the current status, and an audit
 *     row is written best-effort for the change.
 */
export async function updateSupabaseOrderStatus(
  orderId: string,
  patch: { status: StoredOrder["status"]; paymentStatus?: StoredOrder["paymentStatus"] },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isConfigured()) return { ok: false, message: "Supabase is not configured." };
  const userId = await getSignedInUserId();
  if (!userId) return { ok: false, message: "Not allowed." };
  if (patch.paymentStatus !== undefined && patch.paymentStatus !== "unpaid") {
    return { ok: false, message: "Not allowed." };
  }
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, message: "Supabase is not configured." };
  }
  const { data: order } = await admin
    .from("orders")
    .select("id, user_id, status, payment_method, total_poisha")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, message: "Order not found." };
  const { data: caller } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const isAdmin = caller?.role === "admin";
  if (order.user_id !== userId && !isAdmin) {
    return { ok: false, message: "Not allowed." };
  }
  const currentStatus = order.status as StoredOrder["status"];
  const currentPayment = await latestPaymentStatus(admin, orderId);
  if (!isLegalOrderTransition(currentStatus, patch.status, currentPayment)) {
    return { ok: false, message: "That status change is not allowed." };
  }
  if ((patch.status === "delivered" || patch.status === "refunded") && !isAdmin) {
    return { ok: false, message: "Not allowed." };
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
  await writeOrderAudit(admin, userId, orderId, currentStatus, patch.status, "status-sync");
  return { ok: true };
}

/**
 * The current status of an order, from the server side, for the order
 * pages to reconcile against.
 *
 * The shopper's browser keeps its own copy of every order
 * (localStorage, lib/checkout-store), and the test-pay page updates
 * that copy through the ?payment= redirect — but a payment completed
 * through the PUBLIC callback route (POST /api/payments/callback) has
 * no browser redirect: the callback updates the server-side record
 * (in-memory, plus Supabase) and the browser copy would otherwise say
 * "Pending payment" forever, even though the order is paid. The order
 * detail page calls this after loading the browser copy and adopts the
 * server status when the browser copy is still pending payment.
 *
 * Order of sources: the Supabase row first (it is the source of
 * truth — admin moves such as advance, return, refund and cancel
 * write the database, never the in-memory record — so returning the
 * in-memory snapshot first would freeze the order at its checkout
 * status in the browser that placed it, even though /orders, where
 * the live copy wins the merge, already shows the new status), then
 * the in-memory record (same server process — checkout, test-pay
 * and the callback all register there) for orders with no database
 * row. Returns null when the order is not found anywhere the caller
 * may see it. BOTH branches require a signed-in session and the same
 * owner-or-admin check: the in-memory record carries no owner id, so
 * ownership there is the checkout email on the record matching the
 * signed-in user's email (admins may see any order). A guest's
 * browser copy is unaffected — this only gates the server-side
 * status read.
 */
export async function getOrderStatusFromServer(
  orderId: string,
): Promise<{
  status: StoredOrder["status"];
  paymentStatus: StoredOrder["paymentStatus"];
} | null> {
  // The database row first, when Supabase is configured: it is the
  // only copy admin moves ever update. A row the caller may see
  // answers the question outright; a row that exists but belongs to
  // someone else answers it with null (no falling through to the
  // in-memory record for an order the caller may not see). Only when
  // there is no database row at all does the in-memory record below
  // get a say.
  if (isConfigured()) {
    const userId = await getSignedInUserId();
    if (userId) {
      let admin: SupabaseClient | null = null;
      try {
        admin = untyped(createAdminClient());
      } catch {
        admin = null;
      }
      if (admin) {
        const { data: order } = await admin
          .from("orders")
          .select("id, user_id, status, payment_method")
          .eq("id", orderId)
          .maybeSingle();
        if (order) {
          const { data: caller } = await admin
            .from("profiles")
            .select("role")
            .eq("id", userId)
            .maybeSingle();
          if (order.user_id !== userId && caller?.role !== "admin") return null;
          let paymentStatus: StoredOrder["paymentStatus"] = "unpaid";
          const { data: payment } = await admin
            .from("payments")
            .select("status")
            .eq("order_id", orderId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (payment?.status === "paid") paymentStatus = "paid";
          else if (payment?.status === "failed") paymentStatus = "failed";
          else if (payment?.status === "refunded") paymentStatus = "refunded";
          return {
            status: order.status as StoredOrder["status"],
            paymentStatus,
          };
        }
      }
    }
  }
  const local = getOrderRecord(orderId);
  if (local) {
    const user = await getSignedInUser();
    if (!user) return null;
    const ownerEmail = (local.address?.email ?? "").toLowerCase();
    if (user.role !== "admin" && (!ownerEmail || ownerEmail !== user.email)) {
      return null;
    }
    return { status: local.status, paymentStatus: local.paymentStatus };
  }
  return null;
}
