// TechShot marketplace — order status transition rules.
//
// Pure rules, no server or database access, so unit tests import this
// module directly and prove the exact rules the admin server actions
// enforce (see lib/orders/actions.ts). The app must never let an
// order move backwards, skip a step, or be cancelled / refunded from
// a state where that makes no sense.
//
// Flow: pending_payment -> confirmed -> processing -> shipped ->
// delivered. Cancel is only allowed while the order has not started
// fulfilment (pending_payment or confirmed). Refund is only allowed
// for an order whose latest payment is paid, and only once the order
// exists past payment (confirmed, processing, shipped, delivered).
// Returned is an exit alongside cancelled / refunded: an order that
// was placed and not yet taken back — confirmed, processing or
// shipped — may be marked returned. It may NOT come from delivered
// (the customer took it — that is a refund) and NOT from
// pending_payment (nothing shipped yet — cancel there instead).
// Marking an order returned restores stock exactly like cancel /
// refund, and when the order was already paid the admin action
// refunds through the payment adapter first (see
// lib/orders/actions.ts), exactly like a refund.
//
// Refund from "delivered" is a returns flow, not a label: the admin
// refund path (lib/orders/actions.ts changeOrderStatus) restores the
// stock for the order's items AND calls PaymentAdapter.refund() before
// the order is marked refunded, exactly like a refund from any other
// paid state — so "delivered" stays a refund source here.

import type { OrderStatus, PaymentStatus } from "../checkout-store";
import { canChangeOrders } from "../roles";

/** The fulfilment flow, in order. Cancelled / refunded / returned are exits, not steps. */
export const ORDER_FLOW: OrderStatus[] = [
  "pending_payment",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
];

/** The next status in the flow, or null when the order is at the end (or not in the flow). */
export function nextOrderStatus(current: OrderStatus): OrderStatus | null {
  const index = ORDER_FLOW.indexOf(current);
  if (index < 0 || index >= ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[index + 1];
}

/**
 * Whether an admin may move an order from `from` to `to`.
 * `paymentStatus` is the latest payments-row status for the order
 * (from lib/orders-server.ts); it is only consulted for refunds.
 */
export function isLegalOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
  paymentStatus?: PaymentStatus,
): boolean {
  if (from === to) return false;
  if (to === "cancelled") {
    return from === "pending_payment" || from === "confirmed";
  }
  if (to === "refunded") {
    return (
      paymentStatus === "paid" &&
      (from === "confirmed" ||
        from === "processing" ||
        from === "shipped" ||
        from === "delivered")
    );
  }
  if (to === "returned") {
    // No payment condition: an unpaid (e.g. COD, not yet paid) order
    // can be returned too — the admin action simply skips the refund
    // step when there is no paid payment. Delivered and
    // pending_payment are never return sources (see header note).
    return from === "confirmed" || from === "processing" || from === "shipped";
  }
  // Every other move must be exactly one step forward in the flow.
  return nextOrderStatus(from) === to;
}

/** Admin-only gate, shared by the server actions so it is unit-tested. */
export function checkAdminRole(
  role: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!role) {
    return { ok: false, error: "You must be signed in to manage orders." };
  }
  if (role !== "admin") {
    return { ok: false, error: "You do not have permission to manage orders." };
  }
  return { ok: true };
}

/**
 * Order-change gate, shared by the server actions so it is
 * unit-tested. Owner and co-admin may change orders; a manager may
 * not — a manager calling an order action gets an error, never a
 * silent success. (checkAdminRole above stays owner-only for the
 * callers that still need it.)
 */
export function checkOrderRole(
  role: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!role) {
    return { ok: false, error: "You must be signed in to manage orders." };
  }
  if (!canChangeOrders(role)) {
    return { ok: false, error: "You do not have permission to manage orders." };
  }
  return { ok: true };
}
