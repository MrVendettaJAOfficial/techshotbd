"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EXPRESS_DELIVERY_POISHA, formatBDT } from "@/lib/theme";
import {
  addressSchema,
  computeTotals,
  validateCoupon,
  type AddressInput,
  type PlaceOrderInput,
  type PlaceOrderResult,
} from "@/lib/orders";
import { useCart, usePricedCartLines } from "@/lib/cart-store";
import {
  DIVISIONS,
  DISTRICTS,
  clearCouponCode,
  getCouponCode,
  saveOrder,
  type DeliveryOption,
  type PaymentMethod,
} from "@/lib/checkout-store";

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-text outline-none focus:border-brand";
const labelCls = "mb-1 block text-sm font-medium text-text";
const errCls = "mt-1 text-sm text-red-400";
const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 font-semibold text-white hover:bg-blue-600 disabled:opacity-50";
const btnGhost =
  "inline-flex items-center justify-center rounded-lg border border-border bg-panel px-4 py-2 text-sm font-medium text-text hover:border-brand";

type Step = 1 | 2 | 3;

const PAYMENT_METHODS: { key: PaymentMethod; label: string; hint: string }[] = [
  { key: "card", label: "Card", hint: "Debit / credit card (test mode)" },
  { key: "bkash", label: "bKash", hint: "Pay with bKash (test mode)" },
  { key: "nagad", label: "Nagad", hint: "Pay with Nagad (test mode)" },
  { key: "cod", label: "Cash on Delivery", hint: "Pay in cash when it arrives" },
  { key: "emi", label: "EMI", hint: "Monthly instalments (test mode)" },
];

const emptyAddress: AddressInput = {
  firstName: "",
  lastName: "",
  email: "",
  mobile: "",
  address: "",
  area: "",
  division: "",
  district: "",
  city: "",
  billingSame: true,
};

export default function CheckoutForm({
  placeOrder,
}: {
  placeOrder: (input: PlaceOrderInput) => Promise<PlaceOrderResult>;
}) {
  const router = useRouter();
  // The live cart is owned by lib/cart-store; display lines are priced
  // lines (seed catalogue immediately, live database when Supabase is
  // configured — see usePricedCartLines) and the server re-prices them
  // again at order time, so the total shown here can never change what
  // a customer is charged.
  const cart = useCart();
  const { lines, unknownSlugs } = usePricedCartLines();
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [address, setAddress] = useState<AddressInput>(emptyAddress);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryOption>("standard");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [cardExpiry, setCardExpiry] = useState("12/28");
  const [cardCvc, setCardCvc] = useState("123");
  const [mobileWalletNumber, setMobileWalletNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setCouponCode(getCouponCode());
  }, []);

  const resolvedSubtotal_poisha = useMemo(
    () => lines.reduce((sum, l) => sum + l.price_poisha * l.quantity, 0),
    [lines],
  );

  const coupon = useMemo(() => {
    if (!couponCode) return { discount_poisha: 0 };
    const result = validateCoupon(couponCode, resolvedSubtotal_poisha);
    return "discount_poisha" in result ? { discount_poisha: result.discount_poisha } : { discount_poisha: 0 };
  }, [couponCode, resolvedSubtotal_poisha]);

  const summary = useMemo(
    () => computeTotals(lines, delivery, coupon.discount_poisha),
    [lines, delivery, coupon.discount_poisha],
  );

  const districts = address.division ? DISTRICTS[address.division] ?? [] : [];

  function setField<K extends keyof AddressInput>(key: K, value: AddressInput[K]) {
    setAddress((prev) => {
      const next = { ...prev, [key]: value };
      // Changing division resets the district.
      if (key === "division") next.district = "";
      return next;
    });
    setErrors((prev) => {
      if (!prev[key as string]) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  }

  function validateStep1(): boolean {
    const parsed = addressSchema.safeParse(address);
    if (parsed.success) {
      setErrors({});
      return true;
    }
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      if (!fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    setErrors(fieldErrors);
    setFormMessage("Please fix the highlighted address fields.");
    return false;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormMessage(null);
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    if (cart.items.length === 0) {
      setFormMessage("Your cart is empty.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await placeOrder({
        items: cart.items,
        couponCode,
        delivery,
        paymentMethod,
        address,
      });
      if (!result.ok) {
        setErrors(result.errors);
        setFormMessage(result.message);
        if (result.errors.coupon) setCouponCode(null);
        setSubmitting(false);
        return;
      }
      // Save the same order to browser storage so Orders / Account can
      // list it, then clear the cart and follow the server redirect.
      saveOrder(result.order);
      cart.clear();
      clearCouponCode();
      router.push(result.redirectTo);
    } catch {
      setFormMessage("Something went wrong while placing your order. Please try again.");
      setSubmitting(false);
    }
  }

  if (cart.items.length === 0) {
    return (
      <div className="mt-10 rounded-2xl border border-border bg-panel p-10 text-center">
        <h2 className="text-2xl font-bold text-text">Your cart is empty</h2>
        <p className="mt-2 text-muted">Add items to your cart before checking out.</p>
        <Link href="/cart" className={`${btnPrimary} mt-6`}>Go to cart</Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        {unknownSlugs.length > 0 && (
          <p role="alert" className="rounded-lg border border-red-400 bg-panel px-4 py-3 text-sm text-red-400">
            Some items are no longer available and were left out of this order: {unknownSlugs.join(", ")}. Remove them from your cart to continue.
          </p>
        )}
        {/* Step 1 — Shipping address */}
        <section className="rounded-2xl border border-border bg-panel p-5" aria-label="Shipping address">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-text">
              <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-sm text-white">1</span>
              Shipping address
            </h2>
            {step !== 1 && (
              <button type="button" className="text-sm text-brand hover:underline" onClick={() => setStep(1)}>
                Edit
              </button>
            )}
          </div>

          {step === 1 ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="firstName" className={labelCls}>First name</label>
                <input id="firstName" value={address.firstName} onChange={(e) => setField("firstName", e.target.value)} className={inputCls} autoComplete="given-name" />
                {errors.firstName && <p className={errCls}>{errors.firstName}</p>}
              </div>
              <div>
                <label htmlFor="lastName" className={labelCls}>Last name</label>
                <input id="lastName" value={address.lastName} onChange={(e) => setField("lastName", e.target.value)} className={inputCls} autoComplete="family-name" />
                {errors.lastName && <p className={errCls}>{errors.lastName}</p>}
              </div>
              <div>
                <label htmlFor="email" className={labelCls}>Email</label>
                <input id="email" type="email" value={address.email} onChange={(e) => setField("email", e.target.value)} className={inputCls} autoComplete="email" />
                {errors.email && <p className={errCls}>{errors.email}</p>}
              </div>
              <div>
                <label htmlFor="mobile" className={labelCls}>Mobile (+880)</label>
                <input id="mobile" type="tel" value={address.mobile} onChange={(e) => setField("mobile", e.target.value)} placeholder="01XXXXXXXXX" className={inputCls} autoComplete="tel" />
                {errors.mobile && <p className={errCls}>{errors.mobile}</p>}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="address" className={labelCls}>Street address</label>
                <input id="address" value={address.address} onChange={(e) => setField("address", e.target.value)} placeholder="House, road, building" className={inputCls} autoComplete="street-address" />
                {errors.address && <p className={errCls}>{errors.address}</p>}
              </div>
              <div>
                <label htmlFor="area" className={labelCls}>Area / locality</label>
                <input id="area" value={address.area} onChange={(e) => setField("area", e.target.value)} placeholder="e.g. Dhanmondi" className={inputCls} />
                {errors.area && <p className={errCls}>{errors.area}</p>}
              </div>
              <div>
                <label htmlFor="division" className={labelCls}>Division</label>
                <select id="division" value={address.division} onChange={(e) => setField("division", e.target.value)} className={inputCls}>
                  <option value="">Select division</option>
                  {DIVISIONS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                {errors.division && <p className={errCls}>{errors.division}</p>}
              </div>
              <div>
                <label htmlFor="district" className={labelCls}>District</label>
                <select id="district" value={address.district} onChange={(e) => setField("district", e.target.value)} className={inputCls} disabled={!address.division}>
                  <option value="">{address.division ? "Select district" : "Select division first"}</option>
                  {districts.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                {errors.district && <p className={errCls}>{errors.district}</p>}
              </div>
              <div>
                <label htmlFor="city" className={labelCls}>City</label>
                <input id="city" value={address.city} onChange={(e) => setField("city", e.target.value)} placeholder="e.g. Dhaka" className={inputCls} />
                {errors.city && <p className={errCls}>{errors.city}</p>}
              </div>
              <label className="flex items-center gap-2 text-sm text-text sm:col-span-2">
                <input
                  type="checkbox"
                  checked={address.billingSame}
                  onChange={(e) => setField("billingSame", e.target.checked)}
                  className="h-4 w-4 accent-blue-500"
                />
                Billing address is the same as shipping address
              </label>
              <div className="sm:col-span-2">
                <button type="button" className={btnPrimary} onClick={() => { if (validateStep1()) setStep(2); }}>
                  Continue to delivery
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">
              {address.firstName} {address.lastName}, {address.address}, {address.area}, {address.city}, {address.district}, {address.division} · {address.mobile}
            </p>
          )}
        </section>

        {/* Step 2 — Delivery options */}
        <section className="rounded-2xl border border-border bg-panel p-5" aria-label="Delivery options">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-text">
              <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-sm text-white">2</span>
              Delivery options
            </h2>
            {step !== 2 && step === 3 && (
              <button type="button" className="text-sm text-brand hover:underline" onClick={() => setStep(2)}>
                Edit
              </button>
            )}
          </div>
          {step >= 2 ? (
            <div className="mt-4 space-y-3" role="radiogroup" aria-label="Delivery options">
              <label className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 ${delivery === "standard" ? "border-brand bg-surface" : "border-border"}`}>
                <span className="flex items-center gap-3">
                  <input type="radio" name="delivery" value="standard" checked={delivery === "standard"} onChange={() => setDelivery("standard")} className="h-4 w-4 accent-blue-500" />
                  <span>
                    <span className="block font-semibold text-text">Standard delivery</span>
                    <span className="block text-sm text-muted">2–4 working days</span>
                  </span>
                </span>
                <span className="font-semibold text-success">FREE</span>
              </label>
              <label className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 ${delivery === "express" ? "border-brand bg-surface" : "border-border"}`}>
                <span className="flex items-center gap-3">
                  <input type="radio" name="delivery" value="express" checked={delivery === "express"} onChange={() => setDelivery("express")} className="h-4 w-4 accent-blue-500" />
                  <span>
                    <span className="block font-semibold text-text">Express delivery</span>
                    <span className="block text-sm text-muted">1–2 working days</span>
                  </span>
                </span>
                <span className="font-semibold text-text">{formatBDT(EXPRESS_DELIVERY_POISHA)}</span>
              </label>
              {step === 2 && (
                <button type="button" className={btnPrimary} onClick={() => setStep(3)}>
                  Continue to payment
                </button>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Choose a delivery option after entering your address.</p>
          )}
        </section>

        {/* Step 3 — Payment options */}
        <section className="rounded-2xl border border-border bg-panel p-5" aria-label="Payment options">
          <h2 className="text-lg font-bold text-text">
            <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-sm text-white">3</span>
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
                    onClick={() => setPaymentMethod(method.key)}
                    className={`rounded-lg border px-4 py-2 text-sm font-semibold ${paymentMethod === method.key ? "border-brand bg-brand text-white" : "border-border bg-surface text-text hover:border-brand"}`}
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
                  <p className="rounded-lg bg-accent px-3 py-2 text-sm font-bold text-white">
                    TEST MODE — do not enter real card details.
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label htmlFor="cardNumber" className={labelCls}>Card number (test)</label>
                      <input id="cardNumber" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} inputMode="numeric" className={inputCls} />
                    </div>
                    <div>
                      <label htmlFor="cardExpiry" className={labelCls}>Expiry</label>
                      <input id="cardExpiry" value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} placeholder="MM/YY" className={inputCls} />
                    </div>
                    <div>
                      <label htmlFor="cardCvc" className={labelCls}>CVC</label>
                      <input id="cardCvc" value={cardCvc} onChange={(e) => setCardCvc(e.target.value)} inputMode="numeric" className={inputCls} />
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted">Test card 4242 4242 4242 4242 is prefilled. No real payment is charged and card details are never stored.</p>
                </div>
              )}

              {(paymentMethod === "bkash" || paymentMethod === "nagad") && (
                <div className="mt-4 rounded-xl border border-border bg-surface p-4">
                  <p className="rounded-lg bg-accent px-3 py-2 text-sm font-bold text-white">
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
                      onChange={(e) => setMobileWalletNumber(e.target.value)}
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

        {formMessage && (
          <p role="alert" className="rounded-lg border border-red-400 bg-panel px-4 py-3 text-sm text-red-400">
            {formMessage}
          </p>
        )}
      </div>

      {/* Order summary sidebar */}
      <aside aria-label="Order summary" className="h-fit rounded-2xl border border-border bg-panel p-5 lg:sticky lg:top-4">
        <h2 className="text-lg font-bold text-text">Order summary</h2>
        <ul className="mt-4 space-y-3">
          {lines.map((item) => (
            <li key={item.productId} className="flex items-center gap-3 text-sm">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface font-bold text-brand">
                {item.title.charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-text">{item.title}</span>
                <span className="text-muted">Qty {item.quantity}</span>
              </span>
              <span className="font-semibold text-text">{formatBDT(item.price_poisha * item.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd className="text-text">{formatBDT(summary.subtotal_poisha)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Product savings</dt>
            <dd className="text-success">− {formatBDT(summary.savings_poisha)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Coupon {couponCode ? `(${couponCode})` : ""}</dt>
            <dd className="text-success">− {formatBDT(coupon.discount_poisha)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Delivery ({delivery === "express" ? "Express" : "Standard"})</dt>
            <dd className="text-text">{summary.deliveryFee_poisha === 0 ? "FREE" : formatBDT(summary.deliveryFee_poisha)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
            <dt className="text-text">Total</dt>
            <dd className="text-text">{formatBDT(summary.total_poisha)}</dd>
          </div>
        </dl>
        {errors.coupon && <p className={errCls}>{errors.coupon}</p>}
        <button type="submit" disabled={submitting} className="mt-5 w-full rounded-lg bg-accent px-5 py-3 font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
          {submitting ? "Placing your order…" : `Pay ${formatBDT(summary.total_poisha)} securely`}
        </button>
        <p className="mt-2 text-center text-xs text-muted">
          {paymentMethod === "cod"
            ? "No payment is taken now — pay on delivery."
            : "Test mode — no real payment is charged."}
        </p>
        <Link href="/cart" className="mt-3 block text-center text-sm text-brand hover:underline">
          Back to cart
        </Link>
      </aside>
    </form>
  );
}
