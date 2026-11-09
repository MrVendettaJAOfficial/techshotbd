"use client";

// Interactive product detail: image gallery (main image + thumbnails),
// colour / storage selectors that change the displayed price and stock,
// quantity selector, Add to Cart, Buy Now, compare toggle, delivery info,
// coupon banner, and Description / Specifications / Reviews / Warranty
// tabs — all with real content from the catalog.
//

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  GitCompareArrows,
  MapPin,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Truck,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Product } from "../../lib/data/catalog";
import { buildGalleryList } from "../../lib/catalog-rules";
import { FIRST2000_MIN_POISHA, FIRST2000_VALUE_POISHA, formatBDT } from "../../lib/theme";
import { useCart } from "../../lib/cart-store";
import type { ProductReviewItem, ProductReviews } from "../../lib/reviews";
import { RatingStars } from "../ProductCard";
import { ProductGallery } from "./gallery";
import { ReviewForm, averageOf } from "./review-form";

type Tab = "description" | "specs" | "reviews" | "warranty";

/**
 * Warranty + specifications as stored for a product. The live
 * catalogue merges them into product.specs (lib/catalog-rules.ts
 * buildSpecs), so a dedicated `specifications` list is only read
 * when a future catalogue mapping carries one.
 */
type ProductWithDetails = Product & {
  warranty?: string | null;
  specifications?: Array<{ key: string; value: string }> | null;
};

export function ProductDetail({
  product,
  initialReviews,
  signedIn,
}: {
  product: Product;
  /** Real reviews, fetched server-side by the product page
   *  (listProductReviews): the average and count are computed from
   *  real review rows, never from seeded numbers. Null when the
   *  fetch failed — the page then shows "No reviews yet" rather
   *  than invented numbers. */
  initialReviews?: ProductReviews | null;
  /** True when a user is signed in (checked server-side). */
  signedIn?: boolean;
}) {
  const { add } = useCart();
  const router = useRouter();
  const [colour, setColour] = useState(product.colours?.[0] ?? "");
  const [storage, setStorage] = useState(product.storageOptions?.[0]);
  const [quantity, setQuantity] = useState(1);
  const [tab, setTab] = useState<Tab>("description");
  const [compare, setCompare] = useState(false);
  const [added, setAdded] = useState(false);

  const price = product.price_poisha + (storage?.priceDeltaPoisha ?? 0);
  const compareAt = product.compare_at_poisha + (storage?.priceDeltaPoisha ?? 0);
  const stock = storage?.stock ?? product.stock;
  const pct =
    compareAt > price ? Math.round((1 - price / compareAt) * 100) : 0;
  const variantLabel = [storage?.label, colour].filter(Boolean).join(" · ") || product.variant;

  // The displayed photos follow the selected variant and the
  // product's own photos: a colour (or storage option) with its own
  // photo goes first, then every photo for the product in sort_order
  // (see lib/catalog-rules.ts buildGalleryList). No real per-colour
  // photos exist yet, so this is the product's photos until a variant
  // photo is set in /admin (product_variants.image_path, migration
  // 0005).
  const images = useMemo(
    () => buildGalleryList(product, colour, storage?.label),
    [product, colour, storage?.label],
  );

  function handleAdd() {
    add(product.slug, variantLabel, quantity);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  function handleBuyNow() {
    add(product.slug, variantLabel, quantity);
    router.push("/cart");
  }

  // Only real reviews are ever shown: the average and count come
  // from the reviews table (listProductReviews), never from the
  // seeded catalog numbers. No reviews means no rating shown.
  // The list lives in local state, seeded from the server prop, so
  // a review just submitted (see ReviewForm) appears immediately
  // without a refresh — the refresh would remount this component
  // and reset the tab. The effect below re-seeds it when the server
  // data changes (navigating to another product).
  const [shownReviews, setShownReviews] = useState<ProductReviews | null>(initialReviews ?? null);
  useEffect(() => {
    setShownReviews(initialReviews ?? null);
  }, [initialReviews]);
  const reviewCount = shownReviews?.count ?? 0;
  const reviewAverage = shownReviews?.rating ?? 0;
  const reviewList = shownReviews?.reviews ?? [];

  /** Append a just-submitted review to the shown list (see
   *  ReviewForm): the count and average update from the same rows,
   *  and the new review tops the list until the next navigation
   *  loads the server copy. */
  function handleReviewSaved(review: ProductReviewItem): void {
    setShownReviews((current) => {
      const reviews = [review, ...(current?.reviews ?? [])];
      return {
        rating: averageOf(reviews),
        count: reviews.length,
        reviews,
      };
    });
  }

  // Stored specifications + warranty for this product, as key/value
  // rows. The live catalogue merges the stored list into
  // product.specs (lib/catalog-rules.ts buildSpecs): Description and
  // Warranty are injected there, and every other entry is a stored
  // specification. A product with no stored specs has neither — the
  // specs tab then says so instead of inventing any. The warranty
  // text is the stored warranty when set, otherwise the catalogue's
  // Warranty entry.
  const storedSpecifications: Array<{ key: string; value: string }> = (() => {
    const direct = (product as ProductWithDetails).specifications;
    if (direct && direct.length > 0) {
      return direct.map((row) => ({ key: row.key, value: row.value }));
    }
    return Object.entries(product.specs ?? {})
      .filter(([key]) => {
        const lower = key.toLowerCase();
        return lower !== "description" && lower !== "warranty";
      })
      .map(([key, value]) => ({ key, value }));
  })();
  const storedWarranty =
    (product as ProductWithDetails).warranty ?? product.specs?.["Warranty"] ?? null;

  const tabs: { id: Tab; label: string }[] = [
    { id: "description", label: "Description" },
    { id: "specs", label: "Specifications" },
    { id: "reviews", label: `Reviews (${reviewCount})` },
    { id: "warranty", label: "Warranty" },
  ];

  return (
    <div>
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <ProductGallery product={product} images={images} />
        </div>

        <div className="min-w-0">
          <p className="text-sm font-medium text-brandDark">
            {product.brand} · {product.category}
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight text-text sm:text-3xl">
            {product.title}
          </h1>
          <p className="mt-1 text-sm text-muted">{product.variant}</p>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {reviewCount > 0 ? (
              <>
                <RatingStars rating={reviewAverage} size={16} />
                <span className="font-semibold text-text">{reviewAverage.toFixed(1)}</span>
                <span className="text-muted">
                  ({reviewCount} review{reviewCount === 1 ? "" : "s"})
                </span>
              </>
            ) : (
              <span className="text-muted">No reviews yet</span>
            )}
            <span className="text-muted">·</span>
            <span className={stock > 0 ? "font-medium text-success" : "font-medium text-red-700"}>
              {stock > 0 ? "In stock" : "Out of stock"}
            </span>
          </p>

          <p className="mt-4 flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-bold text-text">{formatBDT(price)}</span>
            {compareAt > price && (
              <>
                <span className="text-lg text-muted line-through">
                  {formatBDT(compareAt)}
                </span>
                <span className="rounded-full bg-accentDark px-2.5 py-1 text-xs font-bold text-white">
                  {pct}% OFF
                </span>
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-muted">
            Inclusive of all taxes. Free delivery on orders above ৳999.
          </p>

          {product.colours && product.colours.length > 1 && (
            <div className="mt-6">
              <p className="text-sm font-semibold text-text">
                Colour: <span className="font-normal text-muted">{colour}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {product.colours.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColour(c)}
                    aria-pressed={colour === c}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      colour === c
                        ? "border-brand bg-brand/15 text-text"
                        : "border-border bg-panel text-muted hover:border-brand"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {product.storageOptions && (
            <div className="mt-6">
              <p className="text-sm font-semibold text-text">
                Storage: <span className="font-normal text-muted">{storage?.label}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {product.storageOptions.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setStorage(opt)}
                    aria-pressed={storage?.label === opt.label}
                    className={`rounded-xl border px-4 py-2 text-sm transition ${
                      storage?.label === opt.label
                        ? "border-brand bg-brand/15 text-text"
                        : "border-border bg-panel text-muted hover:border-brand"
                    }`}
                  >
                    {opt.label}
                    <span className="block text-xs text-muted">
                      {formatBDT(product.price_poisha + opt.priceDeltaPoisha)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-xl border border-border bg-panel">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
                className="flex h-11 w-11 items-center justify-center text-text hover:text-brandDark"
              >
                <Minus size={16} />
              </button>
              <span className="w-10 text-center text-sm font-semibold text-text" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(stock, q + 1))}
                aria-label="Increase quantity"
                className="flex h-11 w-11 items-center justify-center text-text hover:text-brandDark"
              >
                <Plus size={16} />
              </button>
            </div>
            <p className="text-xs text-muted">
              {stock > 0 ? `${stock} left in stock` : "Currently unavailable"}
            </p>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleAdd}
              disabled={stock <= 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-inkLight disabled:cursor-not-allowed disabled:bg-border disabled:text-muted"
            >
              {added ? (
                <>
                  <Check size={18} /> Added to Cart
                </>
              ) : (
                <>
                  <ShoppingCart size={18} /> Add to Cart
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleBuyNow}
              disabled={stock <= 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-inkLight disabled:cursor-not-allowed disabled:bg-border disabled:text-muted"
            >
              <Zap size={18} /> Buy Now
            </button>
          </div>

          <button
            type="button"
            onClick={() => setCompare((c) => !c)}
            aria-pressed={compare}
            className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-panel px-4 py-2.5 text-sm font-medium text-text transition hover:border-brand"
          >
            <GitCompareArrows size={16} />
            {compare ? "Added to compare — remove" : "Add to compare"}
          </button>
          {compare && (
            <p className="mt-2 text-xs text-muted">
              Compare is saved in this browser only for now; the compare page
              is not built yet.
            </p>
          )}

          <div className="mt-6 space-y-3 rounded-2xl border border-border bg-panel p-4 text-sm">
            <p className="flex items-start gap-2.5 text-text">
              <Truck size={18} className="mt-0.5 shrink-0 text-brandDark" />
              <span>
                <span className="font-semibold">Deliver to Dhaka</span>
                <span className="text-muted">
                  {" "}
                  — delivery in 1–3 working days, Bangladesh-wide.{" "}
                </span>
                <Link href="/account" className="font-medium text-ink hover:underline">
                  Change
                </Link>
              </span>
            </p>
            <p className="flex items-start gap-2.5 text-text">
              <MapPin size={18} className="mt-0.5 shrink-0 text-brandDark" />
              <span>
                Pickup available in Dhaka and Chattogram. Division and district
                selection happens at checkout.
              </span>
            </p>
            <p className="flex items-start gap-2.5 text-text">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-success" />
              <span>Official brand warranty included. 100% genuine product.</span>
            </p>
          </div>

          <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-accent/50 bg-accent/10 p-4 text-sm">
            <Tag size={18} className="mt-0.5 shrink-0 text-accentDark" />
            <p className="text-text">
              <span className="font-bold">FIRST2000</span> — get{" "}
              {formatBDT(FIRST2000_VALUE_POISHA)} off your first order above{" "}
              {formatBDT(FIRST2000_MIN_POISHA)}. Apply the code at checkout.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-12">
        <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-t-xl px-4 py-3 text-sm font-semibold transition ${
                tab === t.id
                  ? "border-b-2 border-brand bg-panel text-text"
                  : "text-muted hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="rounded-b-2xl border border-t-0 border-border bg-panel p-6">
          {tab === "description" && (
            <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-muted">
              <p className="text-base font-semibold text-text">{product.title}</p>
              <p>{product.description}</p>
              <p>
                Every TechShot order is checked before dispatch, packed securely
                and delivered across Bangladesh with cash on delivery, bKash and
                Nagad accepted.
              </p>
            </div>
          )}

          {tab === "specs" && (
            <div className="max-w-3xl">
              {storedSpecifications.length > 0 ? (
                <dl className="divide-y divide-border">
                  {storedSpecifications.map((row) => (
                    <div key={row.key} className="grid grid-cols-2 gap-4 py-3 text-sm sm:grid-cols-3">
                      <dt className="min-w-0 break-words font-semibold text-text">{row.key}</dt>
                      <dd className="col-span-1 min-w-0 break-words text-muted sm:col-span-2">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted">No specifications listed</p>
              )}
            </div>
          )}

          {tab === "reviews" && (
            <div className="max-w-3xl">
              {reviewCount > 0 ? (
                <div className="flex flex-wrap items-center gap-4">
                  <p className="text-4xl font-bold text-text">{reviewAverage.toFixed(1)}</p>
                  <div>
                    <RatingStars rating={reviewAverage} size={18} />
                    <p className="mt-1 text-sm text-muted">
                      Based on {reviewCount} real review{reviewCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-base font-semibold text-text">No reviews yet</p>
                  <p className="mt-1 text-sm text-muted">
                    Nobody has reviewed this product yet.
                  </p>
                </div>
              )}
              {reviewList.length > 0 && (
                <ul className="mt-6 space-y-4">
                  {reviewList.map((review) => (
                    <li key={review.id} className="rounded-2xl border border-border bg-surface p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-text">{review.authorName}</p>
                        <p className="text-xs text-muted">
                          {new Date(review.createdAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <div className="mt-1.5">
                        <RatingStars rating={review.rating} size={15} />
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-muted">{review.comment}</p>
                    </li>
                  ))}
                </ul>
              )}
              {signedIn ? (
                <ReviewForm productSlug={product.slug} onReviewSaved={handleReviewSaved} />
              ) : (
                <p className="mt-8 text-sm text-muted">
                  <Link href="/auth/sign-in" className="font-medium text-ink hover:underline">
                    Sign in to write a review
                  </Link>
                </p>
              )}
            </div>
          )}

          {tab === "warranty" && (
            <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-muted">
              <p className="text-base font-semibold text-text">Official warranty, handled by TechShot</p>
              {storedWarranty ? (
                <p className="text-text">{storedWarranty}</p>
              ) : null}
              <p>
                This product includes the official brand warranty for this product, starting from
                the delivery date. Keep your TechShot invoice — it is your warranty proof.
              </p>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>7-day replacement for dead-on-arrival or manufacturing defects.</li>
                <li>Warranty claims are collected and returned via our Dhaka service point.</li>
                <li>Physical damage, water damage and unauthorised repairs are not covered.</li>
                <li>Questions? Write to hello@techshotbd and our team will help.</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProductDetail;
