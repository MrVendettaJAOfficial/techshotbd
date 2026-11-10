"use client";

// Order summary sidebar for the cart page. One job: the coupon box,
// the totals breakdown, the savings note and the checkout links.

import Link from "next/link";
import { formatBDT } from "@/lib/theme";
import CouponBox from "./coupon-box";

const btnAccent =
  "inline-flex w-full items-center justify-center rounded-lg bg-brandDark px-5 py-3 font-semibold text-white transition hover:bg-brandDarker";

export interface CartSummaryTotals {
  savings_poisha: number;
  deliveryFee_poisha: number;
  total_poisha: number;
}

export default function CartSummary({
  mrpTotal_poisha,
  summary,
  appliedCoupon,
  couponDiscount_poisha,
  couponError,
  couponMessage,
  couponInput,
  onCouponInputChange,
  onApplyCoupon,
  onRemoveCoupon,
}: {
  mrpTotal_poisha: number;
  summary: CartSummaryTotals;
  appliedCoupon: string | null;
  couponDiscount_poisha: number;
  couponError: string | undefined;
  couponMessage: string | null;
  couponInput: string;
  onCouponInputChange: (value: string) => void;
  onApplyCoupon: () => void;
  onRemoveCoupon: () => void;
}) {
  return (
    <aside aria-label="Order summary" className="h-fit rounded-2xl border border-border bg-panel p-5 lg:sticky lg:top-4">
              <h2 className="text-lg font-bold text-text">Order summary</h2>
      <CouponBox
        appliedCoupon={appliedCoupon}
        couponInput={couponInput}
        onCouponInputChange={onCouponInputChange}
        onApplyCoupon={onApplyCoupon}
        onRemoveCoupon={onRemoveCoupon}
        couponMessage={couponMessage}
        couponError={couponError}
      />

              <dl className="mt-5 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Subtotal (MRP)</dt>
                  <dd className="text-text">{formatBDT(mrpTotal_poisha)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Product savings</dt>
                  <dd className="text-success">− {formatBDT(summary.savings_poisha)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Coupon {appliedCoupon ? `(${appliedCoupon})` : ""}</dt>
                  <dd className="text-success">− {formatBDT(couponDiscount_poisha)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Delivery</dt>
                  <dd className="text-text">
                    {summary.deliveryFee_poisha === 0 ? "FREE" : formatBDT(summary.deliveryFee_poisha)}
                    {summary.deliveryFee_poisha !== 0 && (
                      <span className="ml-1 text-xs text-muted">(standard ৳60)</span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
                  <dt className="text-text">Total payable</dt>
                  <dd className="text-text">{formatBDT(summary.total_poisha)}</dd>
                </div>
              </dl>

              <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm text-success">
                You are saving {formatBDT(summary.savings_poisha + couponDiscount_poisha)} on this order.
              </p>

              <Link href="/checkout" className={`${btnAccent} mt-4`}>
                Proceed to Checkout
              </Link>
              <Link href="/" className="mt-3 block text-center text-sm text-brandDark hover:underline">
                Continue shopping
              </Link>
    </aside>
  );
}
