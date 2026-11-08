"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatBDT, FREE_DELIVERY_THRESHOLD_POISHA } from "@/lib/theme";
import { PRODUCTS, getProductForCartSlug } from "@/lib/data/catalog";
import { computeTotals, validateCoupon } from "@/lib/orders";
import { useCart, usePricedCartLines } from "@/lib/cart-store";
import ProductImage from "@/components/ProductImage";
import {
  getCouponCode,
  getDefaultAddress,
  getSavedForLater,
  removeSaved,
  saveForLater,
  setCouponCode,
  type SavedItem,
} from "@/lib/checkout-store";

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-text outline-none focus:border-brand";
const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-brand px-5 py-3 font-semibold text-white hover:bg-blue-600";
const btnAccent =
  "inline-flex w-full items-center justify-center rounded-lg bg-accent px-5 py-3 font-semibold text-white hover:bg-orange-600";
const btnGhost =
  "inline-flex items-center justify-center rounded-lg border border-border bg-panel px-4 py-2 text-sm font-medium text-text hover:border-brand";

export default function CartPage() {
  // The live cart is owned by lib/cart-store (CartProvider in the root
  // layout); prices are resolved from the catalog, never stored.
  const cart = useCart();
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [deliverCity, setDeliverCity] = useState("Dhaka");

  useEffect(() => {
    setSaved(getSavedForLater());
    setAppliedCoupon(getCouponCode());
    const def = getDefaultAddress();
    if (def?.city) setDeliverCity(def.city);
  }, []);

  // Priced lines: resolved from the seed catalogue immediately, then
  // from the live database when Supabase is configured (see
  // usePricedCartLines in lib/cart-store.ts). Prices are never stored
  // in the cart — only slugs, variants and quantities are.
  const { lines, unknownSlugs } = usePricedCartLines();

  const mrpTotal_poisha = useMemo(
    () => lines.reduce((sum, l) => sum + l.mrp_poisha * l.quantity, 0),
    [lines],
  );

  const resolvedSubtotal_poisha = useMemo(
    () => lines.reduce((sum, l) => sum + l.price_poisha * l.quantity, 0),
    [lines],
  );

  const couponResult = useMemo(() => {
    if (!appliedCoupon) return { discount_poisha: 0, error: undefined as string | undefined };
    const result = validateCoupon(appliedCoupon, resolvedSubtotal_poisha);
    if ("discount_poisha" in result) return { discount_poisha: result.discount_poisha, error: undefined };
    return { discount_poisha: 0, error: result.error };
  }, [appliedCoupon, resolvedSubtotal_poisha]);

  const summary = useMemo(
    () => computeTotals(lines, "standard", couponResult.discount_poisha),
    [lines, couponResult.discount_poisha],
  );

  const amountToFreeDelivery = FREE_DELIVERY_THRESHOLD_POISHA - summary.subtotal_poisha;
  const recommendations = useMemo(
    () =>
      PRODUCTS.filter((p) => !cart.items.some((c) => c.slug === p.slug)).slice(0, 2),
    [cart.items],
  );

  function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code) {
      setCouponMessage("Enter a coupon code first.");
      return;
    }
    const result = validateCoupon(code, summary.subtotal_poisha);
    if ("discount_poisha" in result) {
      setAppliedCoupon(code);
      setCouponCode(code);
      setCouponMessage(
        result.discount_poisha > 0
          ? `Coupon applied. You save ${formatBDT(result.discount_poisha)}.`
          : "Coupon applied.",
      );
    } else {
      setCouponMessage(result.error);
    }
  }

  function removeCoupon() {
    setAppliedCoupon(null);
    setCouponCode(null);
    setCouponInput("");
    setCouponMessage("Coupon removed.");
  }

  if (cart.items.length === 0) {
    return (
      <main className="mx-auto max-w-[1312px] px-4 py-10">
        <nav className="text-sm text-muted" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-text">Home</Link>
          <span className="mx-2">›</span>
          <span className="text-text">Your cart</span>
        </nav>
        <div className="mt-10 rounded-2xl border border-border bg-panel p-10 text-center">
          <h1 className="text-2xl font-bold text-text">Your cart is empty</h1>
          <p className="mt-2 text-muted">Good choices start with a first pick. Browse the shop and add something you like.</p>
          <Link href="/" className={`${btnPrimary} mt-6`}>Continue shopping</Link>
        </div>
        {saved.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-text">Saved for later</h2>
            <ul className="mt-4 space-y-3">
              {saved.map((item) => {
                const product = getProductForCartSlug(item.slug);
                if (!product) return null;
                return (
                  <li key={`${item.slug}::${item.variant ?? ""}`} className="flex items-center gap-4 rounded-xl border border-border bg-panel p-4">
                    <ProductImage src={product.image} alt={product.title} className="h-20 w-20 shrink-0 rounded-lg" />
                    <div className="flex-1">
                      <p className="font-medium text-text">{product.title}</p>
                      <p className="text-sm text-muted">{formatBDT(product.price_poisha)}</p>
                    </div>
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => {
                        cart.add(item.slug, item.variant, item.quantity);
                        removeSaved(item.slug, item.variant);
                        setSaved(getSavedForLater());
                      }}
                    >
                      Move to cart
                    </button>
                    <button
                      type="button"
                      className="text-sm text-muted hover:text-text"
                      onClick={() => {
                        removeSaved(item.slug, item.variant);
                        setSaved(getSavedForLater());
                      }}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1312px] px-4 py-8">
      <nav className="text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-text">Home</Link>
        <span className="mx-2">›</span>
        <span className="text-text">Your cart</span>
      </nav>

      <h1 className="mt-4 text-3xl font-bold text-text">Good choices. Great upgrades.</h1>

      {amountToFreeDelivery > 0 ? (
        <div className="mt-4 rounded-lg border border-border bg-panel px-4 py-3 text-sm text-text">
          Add <span className="font-semibold text-accent">{formatBDT(amountToFreeDelivery)}</span> more to unlock FREE delivery.
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-success bg-panel px-4 py-3 text-sm text-success">
          You have unlocked FREE delivery on this order.
        </div>
      )}

      {unknownSlugs.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-400 bg-panel px-4 py-3 text-sm text-red-400" role="alert">
          Some items are no longer available and were left out of the total: {unknownSlugs.join(", ")}. Remove them below.
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section aria-label="Cart items">
          <p className="text-sm text-muted">
            Delivering to <span className="font-semibold text-text">{deliverCity}</span>
            {" · "}
            <Link href="/account" className="font-medium text-brand hover:underline">Change</Link>
          </p>

          <ul className="mt-4 space-y-4">
            {cart.items.map((item) => {
              const product = getProductForCartSlug(item.slug);
              const line = lines.find(
                (l) => l.productId === item.slug && (l.variant ?? "") === (item.variant ?? product?.variant ?? ""),
              );
              // Title / image come from the priced line when there is
              // one (live title and price), else the seed catalogue.
              const title = line?.title ?? product?.title ?? `Unavailable product (${item.slug})`;
              const image = line?.image ?? product?.image;
              return (
                <li key={`${item.slug}::${item.variant ?? ""}`} className="flex gap-4 rounded-2xl border border-border bg-panel p-4">
                  {image ? (
                    <ProductImage src={image} alt={title} className="h-20 w-20 shrink-0 rounded-lg" />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-surface text-2xl font-bold text-brand">
                      ?
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-text">
                      {title}
                    </p>
                    {item.variant && <p className="text-sm text-muted">{item.variant}</p>}
                    {line && (
                      <p className="mt-1 text-sm text-muted">
                        <span className="font-semibold text-text">{formatBDT(line.price_poisha)}</span>
                        {line.mrp_poisha > line.price_poisha && (
                          <span className="ml-2 line-through">{formatBDT(line.mrp_poisha)}</span>
                        )}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <div className="flex items-center rounded-lg border border-border">
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          className="px-3 py-1 text-lg text-text hover:text-brand"
                          onClick={() => cart.setQuantity(item.slug, item.variant, item.quantity - 1)}
                        >
                          −
                        </button>
                        <span className="min-w-8 text-center text-sm font-semibold text-text">{item.quantity}</span>
                        <button
                          type="button"
                          aria-label="Increase quantity"
                          className="px-3 py-1 text-lg text-text hover:text-brand"
                          onClick={() => cart.setQuantity(item.slug, item.variant, item.quantity + 1)}
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className="text-sm text-brand hover:underline"
                        onClick={() => {
                          saveForLater({ slug: item.slug, variant: item.variant, quantity: item.quantity });
                          cart.remove(item.slug, item.variant);
                          setSaved(getSavedForLater());
                        }}
                      >
                        Save for later
                      </button>
                      <button
                        type="button"
                        className="text-sm text-muted hover:text-text"
                        onClick={() => cart.remove(item.slug, item.variant)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {line && (
                    <p className="shrink-0 font-bold text-text">{formatBDT(line.price_poisha * item.quantity)}</p>
                  )}
                </li>
              );
            })}
          </ul>

          {saved.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-text">Saved for later</h2>
              <ul className="mt-3 space-y-3">
                {saved.map((item) => {
                  const product = getProductForCartSlug(item.slug);
                  if (!product) return null;
                  return (
                    <li key={`${item.slug}::${item.variant ?? ""}`} className="flex items-center gap-4 rounded-xl border border-border bg-panel p-4">
                      <ProductImage src={product.image} alt={product.title} className="h-20 w-20 shrink-0 rounded-lg" />
                      <div className="flex-1">
                        <p className="font-medium text-text">{product.title}</p>
                        <p className="text-sm text-muted">{formatBDT(product.price_poisha)}</p>
                      </div>
                      <button
                        type="button"
                        className={btnGhost}
                        onClick={() => {
                          cart.add(item.slug, item.variant, item.quantity);
                          removeSaved(item.slug, item.variant);
                          setSaved(getSavedForLater());
                        }}
                      >
                        Move to cart
                      </button>
                      <button
                        type="button"
                        className="text-sm text-muted hover:text-text"
                        onClick={() => {
                          removeSaved(item.slug, item.variant);
                          setSaved(getSavedForLater());
                        }}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <section className="mt-10">
            <h2 className="text-xl font-bold text-text">The finishing touches</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {recommendations.map((product) => (
                <article key={product.slug} className="rounded-2xl border border-border bg-panel p-4">
                  <ProductImage src={product.image} alt={product.title} className="h-28 w-full rounded-lg" />
                  <h3 className="mt-3 font-semibold text-text">{product.title}</h3>
                  <p className="text-sm text-muted">
                    <span className="font-semibold text-text">{formatBDT(product.price_poisha)}</span>
                    <span className="ml-2 line-through">{formatBDT(product.compare_at_poisha)}</span>
                  </p>
                  <button
                    type="button"
                    className={`${btnGhost} mt-3`}
                    onClick={() => cart.add(product.slug, product.variant, 1)}
                  >
                    + Add
                  </button>
                </article>
              ))}
            </div>
          </section>
        </section>

        <aside aria-label="Order summary" className="h-fit rounded-2xl border border-border bg-panel p-5 lg:sticky lg:top-4">
          <h2 className="text-lg font-bold text-text">Order summary</h2>

          <div className="mt-4">
            <label htmlFor="coupon" className="mb-1 block text-sm font-medium text-text">Coupon code</label>
            {appliedCoupon ? (
              <div className="flex items-center justify-between rounded-lg border border-success bg-surface px-3 py-2">
                <span className="text-sm font-semibold text-success">{appliedCoupon} applied</span>
                <button type="button" className="text-sm text-muted hover:text-text" onClick={removeCoupon}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  id="coupon"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="FIRST2000"
                  className={inputCls}
                />
                <button type="button" className={btnGhost} onClick={applyCoupon}>Apply</button>
              </div>
            )}
            {couponMessage && (
              <p className={`mt-2 text-sm ${couponResult.error ? "text-red-400" : "text-success"}`}>
                {couponMessage}
              </p>
            )}
            {couponResult.error && <p className="mt-1 text-sm text-red-400">{couponResult.error}</p>}
            <p className="mt-2 text-xs text-muted">FIRST2000: ৳2,000 off on a first order above ৳50,000.</p>
          </div>

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
              <dd className="text-success">− {formatBDT(couponResult.discount_poisha)}</dd>
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
            You are saving {formatBDT(summary.savings_poisha + couponResult.discount_poisha)} on this order.
          </p>

          <Link href="/checkout" className={`${btnAccent} mt-4`}>
            Proceed to Checkout
          </Link>
          <Link href="/" className="mt-3 block text-center text-sm text-brand hover:underline">
            Continue shopping
          </Link>
        </aside>
      </div>
    </main>
  );
}
