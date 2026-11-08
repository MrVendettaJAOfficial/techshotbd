"use client";

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

const STATUS_STYLES: Record<string, string> = {
  pending_payment: "bg-amber-500/20 text-amber-300",
  confirmed: "bg-brand/20 text-blue-300",
  processing: "bg-brand/20 text-blue-300",
  shipped: "bg-accent/20 text-orange-300",
  delivered: "bg-success/20 text-emerald-300",
  cancelled: "bg-red-500/20 text-red-300",
  refunded: "bg-muted/20 text-gray-300",
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
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
          <Link href="/" className="mt-6 inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 font-semibold text-white hover:bg-blue-600">
            Shop now
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1312px] px-4 py-10">
      <h1 className="text-3xl font-bold text-text">My orders</h1>
      <p className="mt-1 text-muted">{orders.length} order{orders.length === 1 ? "" : "s"}</p>
      <ul className="mt-6 space-y-4">
        {orders.map((order) => (
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
                  <span className={`mt-1 inline-block rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[order.status] ?? "bg-muted/20 text-gray-300"}`}>
                    {STATUS_LABELS[order.status] ?? order.status}
                  </span>
                  {order.testMode && (
                    <span className="ml-2 inline-block rounded-full bg-accent px-2 py-1 text-xs font-bold text-white">TEST MODE</span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
