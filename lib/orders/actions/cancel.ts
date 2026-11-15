"use server";

// Customer order cancel (lib/orders/actions.ts). One job:
// cancelMyOrder — the signed-in owner only, pending_payment /
// confirmed only, paid orders must be refunded by an admin.
// A guest whose order is a real database row cannot cancel it
// from the browser at all: see below.

import { getCurrentUser } from "@/lib/auth-server";
import { getOrderRecord } from "@/lib/orders";
import { buyerTokenMatches } from "@/lib/payments/test-adapter";
import {
  ALREADY_CHANGED_ERROR,
  GENERIC_ERROR,
  GUEST_DB_CANCEL_ERROR,
  GUEST_DB_REFUND_ERROR,
  adminClient,
  loadOrder,
  revalidateOrderPages,
  restoreStockAfterStatusChange,
  writeAudit,
  type CustomerCancelResult,
} from "./shared";

/**
 * Cancel the signed-in customer's OWN order, live in Supabase.
 * Owner-only, and only from pending_payment / confirmed (the same
 * rule the admin path enforces). The conditional update, stock
 * restore and audit row are the same as the admin path; the customer
 * order page and the admin list both see the cancellation.
 *
 * A paid order cannot be cancelled this way — it must be refunded by
 * the admin, so the money is actually returned.
 *
 * The database row is loaded FIRST, before any sign-in check: a
 * guest order is a real database row with user_id NULL (migration
 * 0014), and the old code returned the browser-only fallback as
 * soon as there was no signed-in user — before even looking for
 * the row — so a guest saw "cancelled" in the browser while the
 * database order stayed confirmed and its stock stayed held.
 *
 *   * Live database row + signed-in owner: cancelled live, as before.
 *   * Live database row + anyone else: never cancelled here. A
 *     guest who proves ownership with the order's buyerToken (the
 *     same proof the confirmation page and test-pay use, compared
 *     against the in-memory record's key — the token is never
 *     stored in the database) gets the contact-us error
 *     (GUEST_DB_CANCEL_ERROR in ./shared); a
 *     guest who cannot prove it, or a signed-in non-owner, gets
 *     the generic error, so a stranger cannot probe for guest
 *     orders. Either way the row is untouched and no stock moves.
 *   * No database row (guest order, Supabase not configured, or a
 *     browser-only order): the result carries localOnly: true and
 *     the caller falls back to cancelling the browser copy only —
 *     WITHOUT claiming stock was released, because no live stock
 *     was touched.
 *
 * `buyerToken` is the guest key from the caller's browser copy
 * (null for signed-in orders, where the session proves ownership).
 * It is only ever compared, never stored or logged.
 */
export async function cancelMyOrder(
  orderId: string,
  buyerToken?: string | null,
): Promise<CustomerCancelResult> {
  if (typeof orderId !== "string" || orderId.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }
  const user = await getCurrentUser();
  const admin = adminClient();
  // Supabase not configured: there is no live row to check, so the
  // caller falls back to the browser copy — exactly as before.
  if (!admin) return { ok: false, error: GENERIC_ERROR, localOnly: true };
  const order = await loadOrder(admin, orderId);

  // A live database row exists: the browser-only fallback must
  // never run for it — cancelling only the browser copy would be
  // a fake cancel with the row still confirmed.
  if (order) {
    if (user) {
      if (order.userId !== user.id) {
        return { ok: false, error: GENERIC_ERROR };
      }
      if (order.status !== "pending_payment" && order.status !== "confirmed") {
        return { ok: false, error: "This order can no longer be cancelled." };
      }
      if (order.paymentStatus === "paid") {
        return {
          ok: false,
          error: "This order was already paid. Please contact us for a refund.",
        };
      }

      const { data: updated, error } = await admin
        .from("orders")
        .update({ status: "cancelled" })
        .eq("id", order.id)
        .eq("status", order.status)
        .select("id");
      if (error) return { ok: false, error: GENERIC_ERROR };
      if (!Array.isArray(updated) || updated.length !== 1) {
        return { ok: false, error: ALREADY_CHANGED_ERROR };
      }

      await restoreStockAfterStatusChange(admin, order.id);
      await writeAudit(admin, user.id, order.id, order.status, "cancelled", "customer-cancel");
      revalidateOrderPages(order.id);
      return { ok: true, orderNumber: order.orderNumber };
    }

    // Guest caller, live database row. An order owned by a
    // signed-in user is never a guest order: generic error.
    if (order.userId !== null) {
      return { ok: false, error: GENERIC_ERROR };
    }
    // Guest order: prove ownership with the buyerToken, the way
    // the confirmation page and test-pay do — against the
    // in-memory record's key. Only the proven buyer gets the
    // contact-us direction; anyone else gets the generic error.
    // A proven buyer still cannot cancel here: the row stays
    // live and the stock stays held until support cancels it.
    const memoryOrder = getOrderRecord(orderId);
    if (!memoryOrder || !buyerTokenMatches(memoryOrder.buyerToken, buyerToken ?? null)) {
      return { ok: false, error: GENERIC_ERROR };
    }
    if (order.paymentStatus === "paid") {
      return { ok: false, error: GUEST_DB_REFUND_ERROR };
    }
    return { ok: false, error: GUEST_DB_CANCEL_ERROR };
  }

  // No live row: browser-only order (or Supabase not configured).
  // The caller cancels the browser copy only — without claiming
  // stock was released, because no live stock was touched.
  return { ok: false, error: GENERIC_ERROR, localOnly: true };
}
