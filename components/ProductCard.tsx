"use client";

// Product card matching the Figma design: solid card background, image,
// discount badge, wishlist heart, title, variant, star rating, price with
// compare price, and an Add to Cart button wired to the cart store.

import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Heart, ShoppingCart, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Product } from "../lib/data/catalog";
import { formatBDT } from "../lib/theme";
import { useCart } from "../lib/cart-store";
import { addToWishlist, getWishlist, removeFromWishlist } from "../lib/checkout-store";
import ProductImage from "./ProductImage";

function discountPercent(product: Product): number {
  if (product.compare_at_poisha <= product.price_poisha) return 0;
  return Math.round(
    (1 - product.price_poisha / product.compare_at_poisha) * 100,
  );
}

export function RatingStars({
  rating,
  size = 14,
}: {
  rating: number;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Rated ${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={
            n <= Math.round(rating)
              ? "fill-amber-400 text-amber-400"
              : "fill-border text-border"
          }
        />
      ))}
    </span>
  );
}

export default function ProductCard({ product }: { product: Product }) {
  const { add } = useCart();
  const [wishlisted, setWishlisted] = useState(false);
  const [added, setAdded] = useState(false);
  const pct = discountPercent(product);

  useEffect(() => {
    setWishlisted(getWishlist().some((w) => w.productId === product.slug));
  }, [product.slug]);

  function toggleWishlist() {
    const next = !wishlisted;
    setWishlisted(next);
    // Wishlist is stored per-account in the browser until Supabase is
    // connected (see lib/checkout-store). There is intentionally no
    // /api/wishlist route — the toggle always works locally.
    if (next) {
      addToWishlist({
        productId: product.slug,
        title: product.title,
        price_poisha: product.price_poisha,
        mrp_poisha: product.compare_at_poisha,
        image: product.image,
      });
    } else {
      removeFromWishlist(product.slug);
    }
  }

  function handleAdd() {
    add(product.slug, product.variant, 1);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="relative">
        <Link href={`/product/${product.slug}`} aria-label={product.title}>
          <ProductImage src={product.image} alt={product.title} />
        </Link>
        {pct > 0 && (
          <span className="absolute left-3 top-3 rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-white">
            -{pct}%
          </span>
        )}
        {product.badge && (
          <span className="absolute bottom-3 left-3 rounded-full bg-ink/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-text">
            {product.badge}
          </span>
        )}
        <button
          type="button"
          onClick={toggleWishlist}
          aria-pressed={wishlisted}
          aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-ink/70 text-text transition hover:bg-ink"
        >
          <Heart
            size={18}
            className={wishlisted ? "fill-red-500 text-red-500" : ""}
          />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <Link href={`/product/${product.slug}`} className="hover:text-brand">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-text">
            {product.title}
          </h3>
        </Link>
        <p className="truncate text-xs text-muted">{product.variant}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <RatingStars rating={product.rating} />
          <span className="font-semibold text-text">{product.rating.toFixed(1)}</span>
          <span>({product.review_count.toLocaleString("en-IN")})</span>
        </p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-base font-bold text-text">
            {formatBDT(product.price_poisha)}
          </span>
          {product.compare_at_poisha > product.price_poisha && (
            <span className="text-xs text-muted line-through">
              {formatBDT(product.compare_at_poisha)}
            </span>
          )}
        </p>
        <p className="text-xs text-muted">
          {product.stock > 0 ? (
            product.stock <= 12 ? (
              <span className="text-accent">Selling fast · {product.stock} left</span>
            ) : (
              "In stock"
            )
          ) : (
            <span className="text-red-400">Out of stock</span>
          )}
        </p>
        <button
          type="button"
          onClick={handleAdd}
          disabled={product.stock <= 0}
          className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-border disabled:text-muted"
        >
          {added ? (
            <>
              <Check size={16} /> Added
            </>
          ) : (
            <>
              <ShoppingCart size={16} /> Add to Cart
            </>
          )}
        </button>
      </div>
    </article>
  );
}

// Horizontally scrollable product row with working prev/next buttons.
// Kept in this file so the homepage stays a server component.
export function TrendingRow({ products }: { products: Product[] }) {
  const rowRef = useRef<HTMLDivElement>(null);

  function scrollBy(direction: 1 | -1) {
    rowRef.current?.scrollBy({ left: direction * 320, behavior: "smooth" });
  }

  return (
    <div className="relative">
      <div
        ref={rowRef}
        className="flex gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:thin]"
      >
        {products.map((product) => (
          <div key={product.slug} className="w-[260px] shrink-0 sm:w-[280px]">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          aria-label="Scroll trending products left"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-panel text-text transition hover:border-brand"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          onClick={() => scrollBy(1)}
          aria-label="Scroll trending products right"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-panel text-text transition hover:border-brand"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
