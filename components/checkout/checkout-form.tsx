"use client";

// Checkout form for TechShot (steps, delivery, order summary).
// One job: own the checkout state and submit; Step 1 (address) and
// Step 3 (payment) live in components/checkout/address-step.tsx and
// components/checkout/payment-step.tsx.

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
import AddressStep from "@/components/checkout/address-step";
import PaymentStep from "@/components/checkout/payment-step";
import { btnPrimary, errCls, type CheckoutStep } from "@/components/checkout/checkout-shared";
import ProductPlaceholder from "@/components/ProductPlaceholder";
import {
  clearCouponCode,
  getCouponCode,
  saveOrder,
  type DeliveryOption,
  type PaymentMethod,
} from "@/lib/checkout-store";

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
  const [step, setStep] = useState<CheckoutStep>(1);
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
          <p role="alert" className="rounded-lg border border-red-700 bg-panel px-4 py-3 text-sm text-red-700">
            Some items are no longer available and were left out of this order: {unknownSlugs.join(", ")}. Remove them from your cart to continue.
          </p>
        )}
        <AddressStep
          address={address}
          errors={errors}
          step={step}
          onField={setField}
          onEdit={() => setStep(1)}
          onContinue={() => { if (validateStep1()) setStep(2); }}
        />

        {/* Step 2 — Delivery options */}
        <section className="rounded-2xl border border-border bg-panel p-5" aria-label="Delivery options">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-text">
              <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink text-sm text-white">2</span>
              Delivery options
            </h2>
            {step !== 2 && step === 3 && (
              <button type="button" className="text-sm text-ink hover:underline" onClick={() => setStep(2)}>
                Edit
              </button>
            )}
          </div>
          {step >= 2 ? (
            <div className="mt-4 space-y-3" role="radiogroup" aria-label="Delivery options">
              <label className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 ${delivery === "standard" ? "border-brand bg-surface" : "border-border"}`}>
                <span className="flex items-center gap-3">
                  <input type="radio" name="delivery" value="standard" checked={delivery === "standard"} onChange={() => setDelivery("standard")} className="h-4 w-4 accent-brandDark" />
                  <span>
                    <span className="block font-semibold text-text">Standard delivery</span>
                    <span className="block text-sm text-muted">2–4 working days</span>
                  </span>
                </span>
                <span className="font-semibold text-success">FREE</span>
              </label>
              <label className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 ${delivery === "express" ? "border-brand bg-surface" : "border-border"}`}>
                <span className="flex items-center gap-3">
                  <input type="radio" name="delivery" value="express" checked={delivery === "express"} onChange={() => setDelivery("express")} className="h-4 w-4 accent-brandDark" />
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

        <PaymentStep
          step={step}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          cardNumber={cardNumber}
          onCardNumberChange={setCardNumber}
          cardExpiry={cardExpiry}
          onCardExpiryChange={setCardExpiry}
          cardCvc={cardCvc}
          onCardCvcChange={setCardCvc}
          mobileWalletNumber={mobileWalletNumber}
          onMobileWalletNumberChange={setMobileWalletNumber}
        />

        {formMessage && (
          <p role="alert" className="rounded-lg border border-red-700 bg-panel px-4 py-3 text-sm text-red-700">
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
              <ProductPlaceholder compact label={item.title} className="h-10 w-10 shrink-0 rounded-lg" />
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
        <button type="submit" disabled={submitting} className="mt-5 w-full rounded-lg bg-ink px-5 py-3 font-semibold text-white transition hover:bg-inkLight disabled:opacity-50">
          {submitting ? "Placing your order…" : `Pay ${formatBDT(summary.total_poisha)} securely`}
        </button>
        <p className="mt-2 text-center text-xs text-muted">
          {paymentMethod === "cod"
            ? "No payment is taken now — pay on delivery."
            : "Test mode — no real payment is charged."}
        </p>
        <Link href="/cart" className="mt-3 block text-center text-sm text-ink hover:underline">
          Back to cart
        </Link>
      </aside>
    </form>
  );
}
