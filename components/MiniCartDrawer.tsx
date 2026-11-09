"use client";

// Mini-cart drawer (slide-over) for TechShot.
//
// Opens from the header cart button instead of navigating away, so a
// shopper browsing products never loses their place. Every line,
// quantity change and removal goes through the SAME cart store the rest
// of the site uses (useCart / usePricedCartLines in lib/cart-store.ts),
// so the header badge, this drawer and /cart always agree — there is
// no second cart state here (no localStorage, no local item list).
//
// Closing: X button, clicking the dimmed overlay, the Escape key, or
// "Continue shopping" (empty cart). Focus moves to the close button
// when the drawer opens and back to the header cart button when it
// closes. "View full cart" and "Checkout" navigate and close the
// drawer. Body scrolling is locked while the drawer is open.
//
// Line rendering and prices reuse the /cart page's rules
// (app/cart/page.tsx): a priced line is matched back to its cart item
// by slug + variant, the title/image fall back to the seed catalogue,
// and money is formatted with formatBDT from lib/theme.ts. The
// free-delivery threshold is FREE_DELIVERY_THRESHOLD_POISHA (৳999).

import Link from "next/link";
import { useEffect, useRef, type RefObject } from "react";
import { ShoppingCart, Trash2, X } from "lucide-react";
import { formatBDT, FREE_DELIVERY_THRESHOLD_POISHA } from "../lib/theme";
import { getProductForCartSlug } from "../lib/data/catalog";
import { useCart, usePricedCartLines } from "../lib/cart-store";
import ProductImage from "./ProductImage";

export default function MiniCartDrawer({
  open,
  onClose,
  triggerRef,
}: {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement>;
}) {
  const cart = useCart();
  const { lines } = usePricedCartLines();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  function closeAndRefocus() {
    onClose();
    // The trigger stays mounted, so focusing it right away puts focus
    // back on the header cart button.
    triggerRef.current?.focus();
  }

  // Escape closes, body scroll locks, and focus moves into the panel
  // — all only while the drawer is open. Escape uses the same close
  // path as the X button and the overlay, so focus returns to the
  // header cart button whichever way the drawer is closed.
  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAndRefocus();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
    // closeAndRefocus is re-created each render; the effect only
    // needs to re-run when the drawer opens or its close handler
    // changes identity, so it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  if (!open) return null;

  // Subtotal from the priced lines, exactly as /cart computes it
  // (unknown slugs are priced at nothing and left out of the total).
  const subtotalPoisha = lines.reduce(
    (sum, line) => sum + line.price_poisha * line.quantity,
    0,
  );
  const amountToFreeDelivery =
    FREE_DELIVERY_THRESHOLD_POISHA - subtotalPoisha;

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        onClick={closeAndRefocus}
        className="animate-fade-in absolute inset-0 bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
        className="animate-drawer-right absolute right-0 top-0 flex h-full w-[92vw] max-w-md flex-col bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold text-text">
            Your cart{cart.count > 0 ? ` (${cart.count})` : ""}
          </h2>
          <button
            type="button"
            ref={closeButtonRef}
            aria-label="Close cart"
            onClick={closeAndRefocus}
            className="flex h-10 w-10 items-center justify-center rounded-full text-text transition hover:bg-panel"
          >
            <X size={20} />
          </button>
        </div>

        {cart.items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-panel text-muted">
              <ShoppingCart size={28} />
            </span>
            <p className="mt-4 text-lg font-semibold text-text">
              Your cart is empty
            </p>
            <p className="mt-1 text-sm text-muted">
              Good choices start with a first pick. Browse the shop and add
              something you like.
            </p>
            <button
              type="button"
              onClick={closeAndRefocus}
              className="mt-6 rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-white hover:bg-inkLight"
            >
              Continue shopping
            </button>
          </div>
        ) : (
          <>
            <ul className="flex-1 overflow-y-auto px-5 py-4" aria-label="Cart items">
              {cart.items.map((item) => {
                const product = getProductForCartSlug(item.slug);
                const line = lines.find(
                  (l) =>
                    l.productId === item.slug &&
                    (l.variant ?? "") ===
                      (item.variant ?? product?.variant ?? ""),
                );
                // Title / image come from the priced line when there is
                // one (live title and price), else the seed catalogue —
                // the same rule as /cart.
                const title =
                  line?.title ??
                  product?.title ??
                  `Unavailable product (${item.slug})`;
                const image = line?.image ?? product?.image;
                const variant = line?.variant ?? item.variant;
                return (
                  <li
                    key={`${item.slug}::${item.variant ?? ""}`}
                    className="flex gap-3 border-b border-border py-4 first:pt-0 last:border-b-0"
                  >
                    <ProductImage
                      src={image ?? ""}
                      alt={title}
                      className="h-20 w-20 shrink-0 rounded-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-text">
                        {title}
                      </p>
                      {variant && (
                        <p className="mt-0.5 text-sm text-muted">{variant}</p>
                      )}
                      {line && (
                        <p className="mt-1 text-sm text-muted">
                          <span className="font-semibold text-text">
                            {formatBDT(line.price_poisha)}
                          </span>
                          {line.mrp_poisha > line.price_poisha && (
                            <span className="ml-2 line-through">
                              {formatBDT(line.mrp_poisha)}
                            </span>
                          )}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-3">
                        <div className="flex items-center rounded-lg border border-border">
                          <button
                            type="button"
                            aria-label="Decrease quantity"
                            className="px-3 py-1 text-lg text-text hover:text-brandDark"
                            onClick={() =>
                              cart.setQuantity(
                                item.slug,
                                item.variant,
                                item.quantity - 1,
                              )
                            }
                          >
                            −
                          </button>
                          <span className="min-w-8 text-center text-sm font-semibold text-text">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label="Increase quantity"
                            className="px-3 py-1 text-lg text-text hover:text-brandDark"
                            onClick={() =>
                              cart.setQuantity(
                                item.slug,
                                item.variant,
                                item.quantity + 1,
                              )
                            }
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${title} from cart`}
                          className="flex items-center gap-1 text-sm text-muted hover:text-text"
                          onClick={() => cart.remove(item.slug, item.variant)}
                        >
                          <Trash2 size={15} />
                          Remove
                        </button>
                      </div>
                    </div>
                    {line && (
                      <p className="shrink-0 font-bold text-text">
                        {formatBDT(line.price_poisha * item.quantity)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-border px-5 py-4">
              {amountToFreeDelivery > 0 ? (
                <p className="rounded-lg bg-panel px-3 py-2 text-sm text-text">
                  Add{" "}
                  <span className="font-semibold text-brandDark">
                    {formatBDT(amountToFreeDelivery)}
                  </span>{" "}
                  more to unlock free delivery.
                </p>
              ) : (
                <p className="rounded-lg bg-panel px-3 py-2 text-sm text-success">
                  You&apos;ve got free delivery
                </p>
              )}
              <div className="mt-3 flex items-center justify-between text-base font-bold">
                <span className="text-text">Subtotal</span>
                <span className="text-text">{formatBDT(subtotalPoisha)}</span>
              </div>
              <Link
                href="/checkout"
                onClick={onClose}
                className="mt-4 flex w-full items-center justify-center rounded-lg bg-ink px-5 py-3 font-semibold text-white transition hover:bg-inkLight"
              >
                Checkout
              </Link>
              <Link
                href="/cart"
                onClick={onClose}
                className="mt-2 flex w-full items-center justify-center rounded-lg border border-border bg-panel px-5 py-3 font-semibold text-text hover:border-brand"
              >
                View full cart
              </Link>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
