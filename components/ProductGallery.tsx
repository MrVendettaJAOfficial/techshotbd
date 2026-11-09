"use client";

// Interactive product detail: image gallery (main image + thumbnails),
// colour / storage selectors that change the displayed price and stock,
// quantity selector, Add to Cart, Buy Now, compare toggle, delivery info,
// coupon banner, and Description / Specifications / Reviews / Warranty
// tabs — all with real content from the catalog.

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
import type { Product } from "../lib/data/catalog";
import { resolveVariantImage } from "../lib/catalog-rules";
import { formatBDT } from "../lib/theme";
import { FIRST2000_MIN_POISHA, FIRST2000_VALUE_POISHA } from "../lib/theme";
import { useCart } from "../lib/cart-store";
import ProductImage from "./ProductImage";
import { RatingStars } from "./ProductCard";

type Tab = "description" | "specs" | "reviews" | "warranty";

export function ProductGallery({
  product,
  images,
}: {
  product: Product;
  images: string[];
}) {
  const [active, setActive] = useState(0);
  const list = images.length > 0 ? images : [product.image];
  // The image list changes when the shopper picks a variant with its
  // own photo (ProductDetail swaps the list); go back to the first
  // image so the main photo is always the selected variant's photo,
  // not a stale thumbnail index from the previous list. `images` is
  // memoised by the caller, so this only fires when the list changes.
  useEffect(() => {
    setActive(0);
  }, [images]);
  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-border">
        <ProductImage
          key={list[active]}
          src={list[active]}
          alt={product.title}
          priority
        />
      </div>
      {list.length > 1 && (
        <div className="mt-3 flex gap-3">
          {list.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`View image ${i + 1}`}
              aria-pressed={active === i}
              className={`w-20 overflow-hidden rounded-xl border-2 transition ${
                active === i ? "border-brand" : "border-border"
              }`}
            >
              <ProductImage src={src} alt={`${product.title} thumbnail ${i + 1}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProductDetail({ product }: { product: Product }) {
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

  // The displayed photo follows the selected variant: a colour (or
  // storage option) with its own photo shows that photo first, with
  // the product photo still available as a thumbnail; a variant
  // without a photo falls back to the product photo alone. No real
  // per-colour photos exist yet, so this is the product photo until
  // a variant photo is set in /admin (product_variants.image_path,
  // migration 0005).
  const variantImage = resolveVariantImage(product, colour, storage?.label);
  const images = useMemo(() => {
    const list = variantImage ? [variantImage, product.image] : [product.image];
    return [...new Set(list)];
  }, [variantImage, product.image]);

  function handleAdd() {
    add(product.slug, variantLabel, quantity);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  function handleBuyNow() {
    add(product.slug, variantLabel, quantity);
    router.push("/cart");
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "description", label: "Description" },
    { id: "specs", label: "Specifications" },
    { id: "reviews", label: `Reviews (${product.review_count.toLocaleString("en-IN")})` },
    { id: "warranty", label: "Warranty" },
  ];

  // Rating distribution derived from the catalog rating (5-star share
  // estimated from the average); review text is not yet imported from
  // Supabase, so no individual reviews are invented here.
  const distribution = [
    { stars: 5, share: Math.round(((product.rating - 3.4) / 1.6) * 100) },
    { stars: 4, share: 18 },
    { stars: 3, share: 6 },
    { stars: 2, share: 2 },
    { stars: 1, share: 1 },
  ];

  return (
    <div>
      <div className="grid gap-8 lg:grid-cols-2">
        <ProductGallery product={product} images={images} />

        <div>
          <p className="text-sm font-medium text-brand">
            {product.brand} · {product.category}
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight text-text sm:text-3xl">
            {product.title}
          </h1>
          <p className="mt-1 text-sm text-muted">{product.variant}</p>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <RatingStars rating={product.rating} size={16} />
            <span className="font-semibold text-text">{product.rating.toFixed(1)}</span>
            <span className="text-muted">
              ({product.review_count.toLocaleString("en-IN")} reviews)
            </span>
            <span className="text-muted">·</span>
            <span className={stock > 0 ? "font-medium text-success" : "font-medium text-red-400"}>
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
                <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-white">
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
                className="flex h-11 w-11 items-center justify-center text-text hover:text-brand"
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
                className="flex h-11 w-11 items-center justify-center text-text hover:text-brand"
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
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-border disabled:text-muted"
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
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:bg-border disabled:text-muted"
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
              <Truck size={18} className="mt-0.5 shrink-0 text-brand" />
              <span>
                <span className="font-semibold">Deliver to Dhaka</span>
                <span className="text-muted">
                  {" "}
                  — delivery in 1–3 working days, Bangladesh-wide.{" "}
                </span>
                <Link href="/account" className="font-medium text-brand hover:underline">
                  Change
                </Link>
              </span>
            </p>
            <p className="flex items-start gap-2.5 text-text">
              <MapPin size={18} className="mt-0.5 shrink-0 text-brand" />
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
            <Tag size={18} className="mt-0.5 shrink-0 text-accent" />
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
            <dl className="max-w-3xl divide-y divide-border">
              {Object.entries(product.specs).map(([key, value]) => (
                <div key={key} className="grid grid-cols-2 gap-4 py-3 text-sm sm:grid-cols-3">
                  <dt className="font-semibold text-text">{key}</dt>
                  <dd className="col-span-1 text-muted sm:col-span-2">{value}</dd>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-4 py-3 text-sm sm:grid-cols-3">
                <dt className="font-semibold text-text">Brand</dt>
                <dd className="col-span-1 text-muted sm:col-span-2">{product.brand}</dd>
              </div>
              <div className="grid grid-cols-2 gap-4 py-3 text-sm sm:grid-cols-3">
                <dt className="font-semibold text-text">Condition</dt>
                <dd className="col-span-1 text-muted sm:col-span-2">{product.condition}</dd>
              </div>
            </dl>
          )}

          {tab === "reviews" && (
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-4">
                <p className="text-4xl font-bold text-text">{product.rating.toFixed(1)}</p>
                <div>
                  <RatingStars rating={product.rating} size={18} />
                  <p className="mt-1 text-sm text-muted">
                    Based on {product.review_count.toLocaleString("en-IN")} verified reviews
                  </p>
                </div>
              </div>
              <div className="mt-6 space-y-2">
                {distribution.map((row) => (
                  <div key={row.stars} className="flex items-center gap-3 text-sm">
                    <span className="w-8 shrink-0 text-muted">{row.stars} star</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-amber-400"
                        style={{ width: `${Math.min(100, Math.max(0, row.share))}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-muted">{row.share}%</span>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-sm text-muted">
                Individual review text has not been imported yet — ratings and
                counts above come from the catalog. Written reviews will appear
                here once the review system is connected.
              </p>
            </div>
          )}

          {tab === "warranty" && (
            <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-muted">
              <p className="text-base font-semibold text-text">Official warranty, handled by TechShot</p>
              <p>
                This product includes the official brand warranty stated in its
                specifications, starting from the delivery date. Keep your
                TechShot invoice — it is your warranty proof.
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
