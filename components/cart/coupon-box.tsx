"use client";

// Coupon box for the cart page. One job: the coupon code input,
// the applied-coupon state, and the apply / remove messages.

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-text outline-none focus:border-brand";
const btnGhost =
  "inline-flex items-center justify-center rounded-lg border border-border bg-panel px-4 py-2 text-sm font-medium text-text hover:border-brand";

export default function CouponBox({
  appliedCoupon,
  couponInput,
  onCouponInputChange,
  onApplyCoupon,
  onRemoveCoupon,
  couponMessage,
  couponError,
}: {
  appliedCoupon: string | null;
  couponInput: string;
  onCouponInputChange: (value: string) => void;
  onApplyCoupon: () => void;
  onRemoveCoupon: () => void;
  couponMessage: string | null;
  couponError: string | undefined;
}) {
  return (
            <div className="mt-4">
              <label htmlFor="coupon" className="mb-1 block text-sm font-medium text-text">Coupon code</label>
              {appliedCoupon ? (
                <div className="flex items-center justify-between rounded-lg border border-success bg-surface px-3 py-2">
                  <span className="text-sm font-semibold text-success">{appliedCoupon} applied</span>
                  <button type="button" className="text-sm text-muted hover:text-text" onClick={onRemoveCoupon}>
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    id="coupon"
                    value={couponInput}
                    onChange={(e) => onCouponInputChange(e.target.value.toUpperCase())}
                    placeholder="FIRST2000"
                    className={inputCls}
                  />
                  <button type="button" className={btnGhost} onClick={onApplyCoupon}>Apply</button>
                </div>
              )}
              {couponMessage && (
                <p className={`mt-2 text-sm ${couponError ? "text-red-400" : "text-success"}`}>
                  {couponMessage}
                </p>
              )}
              {couponError && <p className="mt-1 text-sm text-red-400">{couponError}</p>}
              <p className="mt-2 text-xs text-muted">FIRST2000: ৳2,000 off on a first order above ৳50,000.</p>
            </div>
  );
}
