// Admin orders list (client component).
//
// Orders are separated into status tabs (All + the nine statuses,
// each with a count) instead of one flat list. Each order's status
// controls live in ./status-controls (manual status selector, which
// writes through the server action setOrderStatus in
// lib/orders/actions.ts — the server validates the transition,
// writes the audit row and revalidates the order pages). Advance
// stays as a small shortcut next to the selector; Cancel / Refund
// stay with their previous rules. When Supabase is not configured
// the local demo store is the fallback, exactly as before.
//
// A caller who cannot change orders (manager) sees no selector and
// no order-change buttons at all, and the section states plainly
// that orders are read-only for their role.
//
// Split from components/AdminOrders.tsx: the list, status tabs and
// server-action handlers live here, the per-order controls in
// ./status-controls, and components/AdminOrders.tsx re-exports them.

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatBDT } from "@/lib/theme";
import { listOrders, updateOrderStatus, type StoredOrder } from "@/lib/checkout-store";
import { advanceOrderStatus, setOrderStatus } from "@/lib/orders/actions";
import { canChangeOrders } from "@/lib/roles";
import { Badge, Card, EmptyState, SectionHeading } from "@/components/ui";
import TabBar from "@/components/TabBar";
import {
  ORDER_STATUS_TABS,
  countByStatus,
  filterByStatus,
  orderStatusLabel,
} from "@/components/admin-helpers";
import OrderStatusControls from "./status-controls";

export interface ListedOrder {
  id: string;
  orderNumber: string;
  status: string;
  /** Latest payment status ("paid" gates the Refund button). */
  paymentStatus?: string;
  totalPoisha: number;
  createdAt?: string;
  items: Array<{ title?: string; quantity?: number; pricePoisha?: number }>;
}

/** Map a stored checkout order (lib/checkout-store) to the shape this
 *  section renders. Stored orders are store orders (no per-account split). */
export function fromStoredOrder(order: StoredOrder): ListedOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalPoisha: order.total_poisha,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      pricePoisha: item.price_poisha,
    })),
  };
}

interface AdminOrdersProps {
  initialOrders: ListedOrder[];
  configured: boolean;
  /** The signed-in caller's role string (owner "admin", "co_admin", "manager", ...). */
  callerRole: string | null;
}

export default function AdminOrders({ initialOrders, configured, callerRole }: AdminOrdersProps) {
  const router = useRouter();
  const [orders, setOrders] = useState<ListedOrder[]>(initialOrders);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [orderError, setOrderError] = useState<string | null>(null);
  // Id of the order whose server action is in flight, if any. While
  // set, that order's status controls are disabled. This state alone
  // cannot stop a double-click: React state updates are async, so
  // two clicks dispatched in the same task both read the stale value
  // (null) and both reach the server — and the server's conditional
  // update cannot stop the second one either, because by the time it
  // runs the first change has legitimately landed and "advance from
  // the new status" is a legal next step. The ref below is the real
  // guard: it mutates synchronously, so the second invocation in the
  // same task sees the order already in flight and returns before
  // any state update or server call. (Proven by the Playwright mock
  // run, 2026-11-08: two synchronous clicks moved confirmed ->
  // processing -> shipped, 2 audit rows.)
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const pendingOrderIdsRef = useRef<Set<string>>(new Set());

  /** Synchronously claim an order for one action; false when it is already in flight. */
  function beginOrderAction(orderId: string): boolean {
    if (pendingOrderIdsRef.current.has(orderId)) return false;
    pendingOrderIdsRef.current.add(orderId);
    setPendingOrderId(orderId);
    setOrderError(null);
    return true;
  }

  /** Release an order after its action settles. */
  function endOrderAction(orderId: string): void {
    pendingOrderIdsRef.current.delete(orderId);
    setPendingOrderId((current) => (current === orderId ? null : current));
  }

  useEffect(() => {
    // Live orders when Supabase is configured; the local demo store
    // is only the fallback for an unconfigured install.
    if (configured) {
      setOrders(initialOrders);
    } else {
      setOrders(listOrders().map(fromStoredOrder));
    }
  }, [configured, initialOrders]);

  const readOnly = !canChangeOrders(callerRole);
  const counts = countByStatus(orders, (order) => order.status);
  const filteredOrders = filterByStatus(orders, statusFilter, (order) => order.status);

  /** Set an order to a chosen status via the live server action (or
   *  the local demo store when Supabase is not configured). The
   *  server validates the transition — an illegal choice (for
   *  example jumping pending payment straight to delivered) comes
   *  back as an error and the status does not move. */
  async function handleSelectStatus(order: ListedOrder, target: string) {
    if (target === order.status) return;
    if (!beginOrderAction(order.id)) return;
    try {
      if (configured) {
        const result = await setOrderStatus(order.id, target);
        if (!result.ok) {
          setOrderError(result.error);
          return;
        }
        setOrders((prev) =>
          prev.map((o) => (o.id === order.id ? { ...o, status: result.newStatus } : o)),
        );
        router.refresh();
        return;
      }
      updateOrderStatus(order.id, { status: target as StoredOrder["status"] });
      setOrders(listOrders().map(fromStoredOrder));
    } finally {
      endOrderAction(order.id);
    }
  }

  /** Advance one order via the live server action (or the local demo
   *  store when Supabase is not configured). Kept as the small
   *  shortcut next to the manual selector. */
  async function handleAdvanceOrder(order: ListedOrder) {
    if (!beginOrderAction(order.id)) return;
    try {
      if (configured) {
        const result = await advanceOrderStatus(order.id);
        if (!result.ok) {
          setOrderError(result.error);
          return;
        }
        setOrders((prev) =>
          prev.map((o) => (o.id === order.id ? { ...o, status: result.newStatus } : o)),
        );
        router.refresh();
        return;
      }
      const flow = ["pending_payment", "confirmed", "processing", "shipped", "delivered"];
      const index = flow.indexOf(order.status);
      const next = index >= 0 && index < flow.length - 1 ? flow[index + 1] : "delivered";
      updateOrderStatus(order.id, { status: next as StoredOrder["status"] });
      setOrders(listOrders().map(fromStoredOrder));
    } finally {
      endOrderAction(order.id);
    }
  }

  /** Cancel / refund via the live server action (configured only —
   *  the demo store has no cancel or refund path). */
  async function handleSetOrderStatus(order: ListedOrder, target: "cancelled" | "refunded") {
    if (!beginOrderAction(order.id)) return;
    try {
      const result = await setOrderStatus(order.id, target);
      if (!result.ok) {
        setOrderError(result.error);
        return;
      }
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, status: result.newStatus } : o)),
      );
      router.refresh();
    } finally {
      endOrderAction(order.id);
    }
  }

  return (
    <div>
      <SectionHeading
        title="Orders"
        description="Set any order's status directly, or advance it one step through pending payment, confirmed, processing, shipped, delivered."
      />
      {readOnly ? (
        <p role="note" className="mb-4 rounded-xl border border-border bg-panel px-4 py-3 text-sm text-muted">
          Orders are read-only for your role. You can view order status, but only the owner and
          co-admin can change it.
        </p>
      ) : null}
      <TabBar
        tabs={ORDER_STATUS_TABS.map((tab) => ({
          ...tab,
          count: tab.id === "all" ? orders.length : (counts[tab.id] ?? 0),
        }))}
        activeId={statusFilter}
        ariaLabel="Filter orders by status"
        onSelect={setStatusFilter}
      />
      {orderError ? (
        <p role="alert" className="mt-4 text-sm text-red-700">{orderError}</p>
      ) : null}
      {orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          description={
            configured
              ? "Orders placed on the shop appear here."
              : "Orders appear here once checkout stores them locally."
          }
          className="mb-10 mt-4"
        />
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          title={`No ${orderStatusLabel(statusFilter).toLowerCase()} orders`}
          description="No orders currently have this status."
          className="mb-10 mt-4"
        />
      ) : (
        <div className="mb-10 mt-4 space-y-3">
          {filteredOrders.map((order) => (
            <Card key={order.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-text">Order {order.orderNumber || order.id}</p>
                  <p className="mt-1 text-sm text-muted">
                    {formatBDT(order.totalPoisha)} · {order.items.length} item(s)
                    {order.createdAt ? ` · ${new Date(order.createdAt).toLocaleDateString("en-GB")}` : ""}
                  </p>
                  <ul className="mt-2 list-inside list-disc text-sm text-muted">
                    {order.items.map((item, index) => (
                      <li key={`${order.id}-item-${index}`}>
                        {item.title ?? "Item"} × {item.quantity ?? 1}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">{orderStatusLabel(order.status)}</Badge>
                  {!readOnly && (
                    <OrderStatusControls
                      order={order}
                      pendingOrderId={pendingOrderId}
                      configured={configured}
                      onSelectStatus={(o, target) => void handleSelectStatus(o, target)}
                      onAdvance={(o) => void handleAdvanceOrder(o)}
                      onSetStatus={(o, target) => void handleSetOrderStatus(o, target)}
                    />
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
