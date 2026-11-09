// Order detail status timeline (client component).
//
// The 5-step status tracker (pending payment → confirmed →
// processing → shipped → delivered). A cancelled, refunded or
// returned order is terminal and shows its own message instead of
// the tracker — returned is terminal like cancelled and refunded,
// with its own message (not the cancelled one).
//
// Split from app/orders/[id]/page.tsx: the presentational timeline
// lives here, the page keeps the order loading, reconciliation and
// cancel logic.

import { Check } from "lucide-react";
import { ORDER_TIMELINE_STEPS, type StoredOrder } from "@/lib/checkout-store";

interface OrderTimelineProps {
  order: StoredOrder;
}

export default function OrderTimeline({ order }: OrderTimelineProps) {
  const timelineIndex =
    order.status === "cancelled" || order.status === "refunded" || order.status === "returned"
      ? -1
      : ORDER_TIMELINE_STEPS.findIndex((s) => s.key === order.status);

  return (
    <section className="mt-6 rounded-2xl border border-border bg-panel p-5" aria-label="Order status">
      <h2 className="text-lg font-bold text-text">Status</h2>
      {timelineIndex === -1 ? (
        <p className="mt-3 rounded-lg bg-red-500/20 px-4 py-3 text-sm font-semibold text-red-700">
          This order was{" "}
          {order.status === "refunded"
            ? "cancelled and refunded"
            : order.status === "returned"
              ? "returned — the order was not received, so its items are back in stock"
              : "cancelled"}
          .
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {ORDER_TIMELINE_STEPS.map((step, index) => {
            const done = index <= timelineIndex;
            const current = index === timelineIndex;
            return (
              <li key={step.key} className="flex items-center gap-3">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    done ? "bg-success text-white" : "bg-surface text-muted"
                  }`}
                  aria-hidden="true"
                >
                  {done ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span className={`text-sm ${current ? "font-bold text-text" : done ? "text-text" : "text-muted"}`}>
                  {step.label}
                  {current && " — current status"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
