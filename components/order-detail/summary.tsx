// Order detail summary (client component).
//
// The order header: order number, placed date, status badge, and the
// transient / persisted notice (payment outcome, cancel outcome,
// server error) when there is one.
//
// Split from app/orders/[id]/page.tsx: the presentational summary
// lives here, the page keeps the order loading, reconciliation and
// cancel logic.

import type { StoredOrder } from "@/lib/checkout-store";

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
  returned: "Returned",
};

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface OrderSummaryProps {
  order: StoredOrder;
  notice: string | null;
}

export default function OrderSummary({ order, notice }: OrderSummaryProps) {
  return (
    <>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-text">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted">Placed {formatDateTime(order.createdAt)}</p>
        </div>
        <span className="rounded-full bg-brand/20 px-3 py-1 text-sm font-semibold text-brandLight">
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      {notice && (
        <p role="status" className="mt-4 rounded-lg border border-success bg-panel px-4 py-3 text-sm text-success">
          {notice}
        </p>
      )}
    </>
  );
}
