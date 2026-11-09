// Step 3 of the checkout form: the payment options.
// One job: the payment-method tabs and the per-method panels
// (test card, bKash / Nagad, COD, EMI). Test mode only — no real
// payment is charged and card details are never stored.

import type { PaymentMethod } from "@/lib/checkout-store";
import { inputCls, labelCls, type CheckoutStep } from "./checkout-shared";

const PAYMENT_METHODS: { key: PaymentMethod; label: string; hint: string }[] = [
  { key: "card", label: "Card", hint: "Debit / credit card (test mode)" },
  { key: "bkash", label: "bKash", hint: "Pay with bKash (test mode)" },
  { key: "nagad", label: "Nagad", hint: "Pay with Nagad (test mode)" },
  { key: "cod", label: "Cash on Delivery", hint: "Pay in cash when it arrives" },
  { key: "emi", label: "EMI", hint: "Monthly instalments (test mode)" },
];

export default function PaymentStep({
  step,
  paymentMethod,
  onPaymentMethodChange,
  cardNumber,
  onCardNumberChange,
  cardExpiry,
  onCardExpiryChange,
  cardCvc,
  onCardCvcChange,
  mobileWalletNumber,
  onMobileWalletNumberChange,
}: {
  step: CheckoutStep;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  cardNumber: string;
  onCardNumberChange: (value: string) => void;
  cardExpiry: string;
  onCardExpiryChange: (value: string) => void;
  cardCvc: string;
  onCardCvcChange: (value: string) => void;
  mobileWalletNumber: string;
  onMobileWalletNumberChange: (value: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-panel p-5" aria-label="Payment options">
            <h2 className="text-lg font-bold text-text">
              <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink text-sm text-white">3</span>
              Payment options
            </h2>
            {step === 3 ? (
              <div className="mt-4">
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Payment methods">
                  {PAYMENT_METHODS.map((method) => (
                    <button
                      key={method.key}
                      type="button"
                      role="tab"
                      aria-selected={paymentMethod === method.key}
                      onClick={() => onPaymentMethodChange(method.key)}
                      className={`rounded-lg border px-4 py-2 text-sm font-semibold ${paymentMethod === method.key ? "border-ink bg-ink text-white" : "border-border bg-surface text-text hover:border-brand"}`}
                    >
                      {method.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-sm text-muted">
                  {PAYMENT_METHODS.find((m) => m.key === paymentMethod)?.hint}
                </p>

                {paymentMethod === "card" && (
                  <div className="mt-4 rounded-xl border border-border bg-surface p-4">
                    <p className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm font-bold text-amber-700">
                      TEST MODE — do not enter real card details.
                    </p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label htmlFor="cardNumber" className={labelCls}>Card number (test)</label>
                        <input id="cardNumber" value={cardNumber} onChange={(e) => onCardNumberChange(e.target.value)} inputMode="numeric" className={inputCls} />
                      </div>
                      <div>
                        <label htmlFor="cardExpiry" className={labelCls}>Expiry</label>
                        <input id="cardExpiry" value={cardExpiry} onChange={(e) => onCardExpiryChange(e.target.value)} placeholder="MM/YY" className={inputCls} />
                      </div>
                      <div>
                        <label htmlFor="cardCvc" className={labelCls}>CVC</label>
                        <input id="cardCvc" value={cardCvc} onChange={(e) => onCardCvcChange(e.target.value)} inputMode="numeric" className={inputCls} />
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-muted">Test card 4242 4242 4242 4242 is prefilled. No real payment is charged and card details are never stored.</p>
                  </div>
                )}

                {(paymentMethod === "bkash" || paymentMethod === "nagad") && (
                  <div className="mt-4 rounded-xl border border-border bg-surface p-4">
                    <p className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm font-bold text-amber-700">
                      TEST MODE — {paymentMethod === "bkash" ? "bKash" : "Nagad"} test payment. No real money moves.
                    </p>
                    <div className="mt-4">
                      <label htmlFor="walletNumber" className={labelCls}>
                        {paymentMethod === "bkash" ? "bKash" : "Nagad"} mobile number (test)
                      </label>
                      <input
                        id="walletNumber"
                        type="tel"
                        value={mobileWalletNumber}
                        onChange={(e) => onMobileWalletNumberChange(e.target.value)}
                        placeholder="01XXXXXXXXX"
                        className={inputCls}
                      />
                      <p className="mt-2 text-xs text-muted">Use any valid Bangladeshi mobile number format. This is a test flow — no OTP or real charge happens.</p>
                    </div>
                  </div>
                )}

                {paymentMethod === "cod" && (
                  <div className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm text-text">
                    <p className="font-semibold">Cash on Delivery</p>
                    <p className="mt-1 text-muted">Pay in cash when your order arrives. Please keep the exact amount ready.</p>
                  </div>
                )}

                {paymentMethod === "emi" && (
                  <div className="mt-4 rounded-xl border border-border bg-surface p-4 text-sm text-text">
                    <p className="font-semibold">EMI (test mode)</p>
                    <p className="mt-1 text-muted">EMI is available in test mode only. No real instalment plan will be created and no bank details are collected here.</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">Choose a payment method after selecting delivery.</p>
            )}
          </section>
  );
}
