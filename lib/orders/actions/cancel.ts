"use server";

// Customer order cancel (lib/orders/actions.ts). One job:
// cancelMyOrder — the signed-in owner only, pending_payment /
// confirmed only, paid orders must be refunded by an admin.

import { getCurrentUser } from "@/lib/auth-server";
import {
  ALREADY_CHANGED_ERROR,
  GENERIC_ERROR,
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
 * When there is no live order to cancel (guest order, Supabase not
 * configured, or a browser-only order), the result carries
 * localOnly: true and the caller falls back to cancelling the browser
 * copy only — WITHOUT claiming stock was released, because no live
 * stock was touched.
 */
export async function cancelMyOrder(orderId: string): Promise<CustomerCancelResult> {
  if (typeof orderId !== "string" || orderId.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: GENERIC_ERROR, localOnly: true };
  const admin = adminClient();
  if (!admin) return { ok: false, error: GENERIC_ERROR, localOnly: true };

  const order = await loadOrder(admin, orderId);
  if (!order) return { ok: false, error: GENERIC_ERROR, localOnly: true };
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
