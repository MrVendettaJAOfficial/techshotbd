// Account order history section (client component).
//
// The five most recent orders, each linking to its order detail
// page, plus the link to the full orders list. The orders themselves
// come from the caller (app/account/page.tsx), which merges the
// Supabase orders over the browser-local ones.
//
// Split from app/account/page.tsx: the order history UI lives here,
// the page keeps the order state.

"use client";

import Link from "next/link";
import { formatBDT } from "@/lib/theme";
import type { StoredOrder } from "@/lib/checkout-store";
import { btnPrimary } from "./account-ui";

const ORDER_STATUS_LABELS: Record<string, string> = {
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

interface OrdersSectionProps {
  orders: StoredOrder[];
}

export default function OrdersSection({ orders }: OrdersSectionProps) {
  const recentOrders = orders.slice(0, 5);

  return (
    <section className="mt-6 rounded-2xl border border-border bg-panel p-5" aria-label="Order history">
      <h2 className="text-lg font-bold text-text">Order history</h2>
      {recentOrders.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No orders yet. Orders you place will show up here with their status and totals.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {recentOrders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/orders/${order.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 hover:border-brand"
              >
                <span>
                  <span className="block font-semibold text-text">{order.orderNumber}</span>
                  <span className="block text-sm text-muted">
                    {formatDate(order.createdAt)} · {ORDER_STATUS_LABELS[order.status] ?? order.status}
                  </span>
                </span>
                <span className="font-bold text-text">{formatBDT(order.total_poisha)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href="/orders" className={`${btnPrimary} mt-4`}>View my orders</Link>
    </section>
  );
}
