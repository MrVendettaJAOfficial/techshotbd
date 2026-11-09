// Admin order status controls (client component).
//
// The per-order controls for one row of the admin orders list: the
// manual status selector (all nine statuses, writes through the
// server action setOrderStatus), the Advance shortcut, and Cancel /
// Refund with their previous rules. Rendered only for callers who
// can change orders (see components/admin-orders/orders-list.tsx);
// a read-only caller sees no controls at all.
//
// Split from components/AdminOrders.tsx: the list, status tabs and
// server-action handlers live in ./orders-list, and
// components/AdminOrders.tsx re-exports them.

"use client";

import { Button, Select } from "@/components/ui";
import { ORDER_STATUSES, orderStatusLabel } from "@/components/admin-helpers";
import type { ListedOrder } from "./orders-list";

interface OrderStatusControlsProps {
  order: ListedOrder;
  /** Id of the order whose server action is in flight, if any. */
  pendingOrderId: string | null;
  /** False when Supabase is not configured (no Cancel / Refund path). */
  configured: boolean;
  onSelectStatus: (order: ListedOrder, target: string) => void;
  onAdvance: (order: ListedOrder) => void;
  onSetStatus: (order: ListedOrder, target: "cancelled" | "refunded") => void;
}

export default function OrderStatusControls({
  order,
  pendingOrderId,
  configured,
  onSelectStatus,
  onAdvance,
  onSetStatus,
}: OrderStatusControlsProps) {
  return (
    <>
      <label htmlFor={`order-status-${order.id}`} className="sr-only">
        Change status for order {order.orderNumber || order.id}
      </label>
      <Select
        id={`order-status-${order.id}`}
        value={ORDER_STATUSES.includes(order.status as (typeof ORDER_STATUSES)[number]) ? order.status : ""}
        disabled={pendingOrderId === order.id}
        onChange={(e) => onSelectStatus(order, e.target.value)}
        aria-label={`Change status for order ${order.orderNumber || order.id}`}
      >
        {ORDER_STATUSES.map((status) => (
          <option key={status} value={status}>
            {orderStatusLabel(status)}
          </option>
        ))}
      </Select>
      {order.status !== "delivered" &&
      order.status !== "cancelled" &&
      order.status !== "refunded" &&
      order.status !== "returned" ? (
        <Button variant="outline" size="sm" disabled={pendingOrderId === order.id} onClick={() => onAdvance(order)}>
          Advance
        </Button>
      ) : null}
      {(order.status === "pending_payment" || order.status === "confirmed") &&
      configured ? (
        <Button variant="danger" size="sm" disabled={pendingOrderId === order.id} onClick={() => onSetStatus(order, "cancelled")}>
          Cancel
        </Button>
      ) : null}
      {order.paymentStatus === "paid" &&
      order.status !== "cancelled" &&
      order.status !== "refunded" &&
      configured ? (
        <Button variant="outline" size="sm" disabled={pendingOrderId === order.id} onClick={() => onSetStatus(order, "refunded")}>
          Refund
        </Button>
      ) : null}
    </>
  );
}
