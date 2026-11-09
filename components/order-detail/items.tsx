// Order detail items (client component).
//
// The ordered items with quantities and line totals, plus the
// price breakdown (subtotal, savings, coupon, delivery, total).
//
// Split from app/orders/[id]/page.tsx: the presentational items
// list lives here, the page keeps the order loading, reconciliation
// and cancel logic.

import { formatBDT } from "@/lib/theme";
import type { StoredOrder } from "@/lib/checkout-store";

interface OrderItemsProps {
  order: StoredOrder;
}

export default function OrderItems({ order }: OrderItemsProps) {
  return (
    <section className="mt-6 rounded-2xl border border-border bg-panel p-5" aria-label="Order items">
      <h2 className="text-lg font-bold text-text">Items</h2>
      <ul className="mt-4 space-y-3">
        {order.items.map((item) => (
          <li key={item.productId} className="flex items-center gap-3 text-sm">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface font-bold text-brand">
              {item.title.charAt(0)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-text">{item.title}</span>
              <span className="text-muted">
                Qty {item.quantity}
                {item.variant ? ` · ${item.variant}` : ""}
              </span>
            </span>
            <span className="font-semibold text-text">{formatBDT(item.price_poisha * item.quantity)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Subtotal</dt>
          <dd className="text-text">{formatBDT(order.subtotal_poisha)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Product savings</dt>
          <dd className="text-success">− {formatBDT(order.savings_poisha)}</dd>
        </div>
        {order.couponCode && (
          <div className="flex justify-between">
            <dt className="text-muted">Coupon ({order.couponCode})</dt>
            <dd className="text-success">− {formatBDT(order.couponDiscount_poisha)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-muted">Delivery ({order.delivery === "express" ? "Express" : "Standard"})</dt>
          <dd className="text-text">{order.deliveryFee_poisha === 0 ? "FREE" : formatBDT(order.deliveryFee_poisha)}</dd>
        </div>
        <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
          <dt className="text-text">Total</dt>
          <dd className="text-text">{formatBDT(order.total_poisha)}</dd>
        </div>
      </dl>
    </section>
  );
}
