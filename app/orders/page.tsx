"use client";

// My orders page.
//
// Lists the signed-in user's orders (live Supabase orders merged
// over the browser-local ones, newest first) with status tabs, or
// "No orders yet" when there are none. Each order links to its
// detail page.

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBDT } from "@/lib/theme";
import { getOrderStatusFromServer, listSupabaseOrders } from "@/lib/orders-server";
import { mergeOrders } from "@/lib/account-rules";
import {
  listOrders,
  updateOrderStatus,
  type StoredOrder,
} from "@/lib/checkout-store";
import TabBar from "@/components/TabBar";
import {
  ORDER_STATUS_TABS,
  countByStatus,
  filterByStatus,
  orderStatusLabel,
} from "@/components/admin-helpers";

const STATUS_STYLES: Record<string, string> = {
  pending_payment: "bg-amber-500/20 text-amber-700",
  confirmed: "bg-brand/15 text-brandDark",
  processing: "bg-brand/15 text-brandDark",
  shipped: "bg-ink/10 text-ink",
  delivered: "bg-success/15 text-brandDark",
  returned: "bg-slate-500/15 text-slate-600",
  cancelled: "bg-red-500/15 text-red-700",
  refunded: "bg-muted/15 text-muted",
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function OrdersPage() {
  const [loaded, setLoaded] = useState(false);
  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    const browserOrders = listOrders();
    setOrders(browserOrders);
    setLoaded(true);
    // Live orders for the signed-in user, merged over the browser list:
    // the same order id in both places is one order and the Supabase
    // copy wins (it is the source of truth once configured). This is
    // the fix for a fresh browser showing "No orders yet" even though
    // the order exists in Supabase. listSupabaseOrders returns [] when
    // Supabase is not configured or nobody is signed in, so guests
    // keep seeing their local orders exactly as before.
    let cancelled = false;
    void (async () => {
      let liveOrders: StoredOrder[] = [];
      try {
        liveOrders = await listSupabaseOrders();
      } catch {
        liveOrders = [];
      }
      if (cancelled) return;
      const merged = mergeOrders(browserOrders, liveOrders);
      if (liveOrders.length > 0) setOrders(merged);
      // Same server reconciliation as the order detail page (see there):
      // a payment completed through the public callback route updates the
      // server-side record, not this browser copy. Only copies still
      // pending payment adopt the server status.
      const pending = merged.filter((o) => o.status === "pending_payment");
      if (pending.length === 0) return;
      const results = await Promise.all(
        pending.map(async (o) => {
          const server = await getOrderStatusFromServer(o.id).catch(() => null);
          if (!server) return false;
          if (
            server.status === "pending_payment" &&
            server.paymentStatus === o.paymentStatus
          ) {
            return false;
          }
          return (
            updateOrderStatus(o.id, {
              status: server.status,
              paymentStatus: server.paymentStatus,
            }) !== null
          );
        }),
      );
      if (!cancelled && results.some(Boolean)) {
        setOrders(mergeOrders(listOrders(), liveOrders));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) {
    return (
      <main className="mx-auto max-w-[1312px] px-4 py-10">
        <p className="text-muted">Loading your orders…</p>
      </main>
    );
  }

  if (orders.length === 0) {
    return (
      <main className="mx-auto max-w-[1312px] px-4 py-10">
        <h1 className="text-3xl font-bold text-text">My orders</h1>
        <div className="mt-8 rounded-2xl border border-border bg-panel p-10 text-center">
          <h2 className="text-xl font-bold text-text">No orders yet</h2>
          <p className="mt-2 text-muted">Orders you place will show up here with their status and totals.</p>
          <Link href="/" className="mt-6 inline-flex items-center justify-center rounded-lg bg-ink px-5 py-3 font-semibold text-white hover:bg-inkLight">
            Shop now
          </Link>
        </div>
      </main>
    );
  }

  const counts = countByStatus(orders, (order) => order.status);
  const filteredOrders = filterByStatus(orders, statusFilter, (order) => order.status);

  return (
    <main className="mx-auto max-w-[1312px] px-4 py-10">
      <h1 className="text-3xl font-bold text-text">My orders</h1>
      <p className="mt-1 text-muted">{orders.length} order{orders.length === 1 ? "" : "s"}</p>
      <div className="mt-6">
        <TabBar
          tabs={ORDER_STATUS_TABS.map((tab) => ({
            ...tab,
            count: tab.id === "all" ? orders.length : (counts[tab.id] ?? 0),
          }))}
          activeId={statusFilter}
          ariaLabel="Filter your orders by status"
          onSelect={setStatusFilter}
        />
      </div>
      {filteredOrders.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-border bg-panel p-10 text-center">
          <h2 className="text-xl font-bold text-text">
            No {statusFilter === "all" ? "" : `${orderStatusLabel(statusFilter).toLowerCase()} `}orders
          </h2>
          <p className="mt-2 text-muted">No orders currently have this status.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {filteredOrders.map((order) => (
          <li key={order.id}>
            <Link
              href={`/orders/${order.id}`}
              className="block rounded-2xl border border-border bg-panel p-5 hover:border-brand"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-text">{order.orderNumber}</p>
                  <p className="text-sm text-muted">
                    {formatDate(order.createdAt)} · {order.items.length} item{order.items.length === 1 ? "" : "s"} ·{" "}
                    {order.items.map((i) => i.title).slice(0, 2).join(", ")}
                    {order.items.length > 2 ? "…" : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-text">{formatBDT(order.total_poisha)}</p>
                  <span className={`mt-1 inline-block rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[order.status] ?? "bg-muted/15 text-muted"}`}>
                    {STATUS_LABELS[order.status] ?? order.status}
                  </span>
                  {order.testMode && (
                    <span className="ml-2 inline-block rounded-full bg-amber-500/20 px-2 py-1 text-xs font-bold text-amber-700">TEST MODE</span>
                  )}
                </div>
              </div>
            </Link>
          </li>
          ))}
        </ul>
      )}
    </main>
  );
}
