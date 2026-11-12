"use server";

// Admin order status actions (lib/orders/actions.ts). One job:
// advanceOrderStatus and setOrderStatus (owner / co-admin only).

import { nextOrderStatus } from "../transitions";
import {
  ALREADY_CHANGED_ERROR,
  changeOrderStatus,
  orderStatusSchema,
  type OrderStatusActionResult,
} from "./shared";

/**
 * Advance one order to the next step in the fulfilment flow. Owner / co-admin only.
 *
 * `expectedStatus` is the status the caller RENDERED (the admin
 * orders list passes order.status): the advance is rejected when
 * the order no longer holds it, so a double-click, a second tab or
 * a replayed request cannot move the order a second step — the
 * caller is told to reload instead. A missing / invalid expected
 * status skips the check (older callers), but the advance still
 * moves exactly one step from the current status.
 */
export async function advanceOrderStatus(
  orderId: string,
  expectedStatus?: unknown,
): Promise<OrderStatusActionResult> {
  const parsed = orderStatusSchema.safeParse(expectedStatus);
  return changeOrderStatus(orderId, (order) => {
    if (parsed.success && order.status !== parsed.data) {
      return { error: ALREADY_CHANGED_ERROR };
    }
    const next = nextOrderStatus(order.status);
    if (!next) return { error: "This order cannot be advanced." };
    return next;
  });
}

/**
 * Set an order to a specific valid status (cancel / refund /
 * returned, or any step in the flow). Owner / co-admin only — the
 * role gate and the transition validation both live in
 * changeOrderStatus above, so this path runs the same atomic
 * conditional update (.eq("status", oldStatus), audit only on
 * exactly 1 row) and the same audit row as advanceOrderStatus.
 * A manager calling this gets an error, never a silent success.
 */
export async function setOrderStatus(
  orderId: string,
  rawTarget: unknown,
): Promise<OrderStatusActionResult> {
  const parsed = orderStatusSchema.safeParse(rawTarget);
  if (!parsed.success) {
    return { ok: false, error: "Please choose a valid status." };
  }
  return changeOrderStatus(orderId, () => parsed.data);
}
