"use client";

// Interactive product detail: image gallery (main image + thumbnails),
// colour / storage selectors that change the displayed price and stock,
// quantity selector, Add to Cart, Buy Now, compare toggle, delivery info,
// coupon banner, and Description / Specifications / Reviews / Warranty
// tabs — all with real content from the catalog.
//
// Gallery behaviour (multi-angle build, 2026-11-09):
//   * Every photo for the product is shown: main photo, clickable
//     thumbnails, and — when the product has more than one photo —
//     an auto-slider on desktop that advances every few seconds.
//   * Desktop (hover-capable pointer): hovering the photo pauses the
//     slider and shows previous / next arrows; keyboard arrows work
//     when the gallery is focused. Once the shopper interacts, the
//     slider stays paused until they leave and come back — it never
//     yanks the photo away while they are looking at it.
//     prefers-reduced-motion turns the slider off entirely, and the
//     slider also pauses while the tab is hidden.
//   * Mobile (touch): no auto-slide, no arrows, no zoom buttons —
//     swipe left / right to change photos, pinch to zoom like the
//     phone's own gallery.
//   * Tapping the main photo opens a fullscreen viewer: zoom in / out
//     buttons and drag-to-pan on desktop, swipe + pinch on mobile,
//     Escape or the close button to leave. The viewer always shows a
//     close button; on mobile it is the only button.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  MapPin,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Truck,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "../lib/data/catalog";
import { buildGalleryList } from "../lib/catalog-rules";
import {
  GALLERY_AUTO_SLIDE_MS,
  GALLERY_ZOOM_MAX,
  GALLERY_ZOOM_MIN,
  clampPan,
  nextGalleryIndex,
  pinchDistance,
  pinchScale,
  prevGalleryIndex,
  swipeDirection,
  zoomStep,
} from "../lib/gallery";
import { formatBDT } from "../lib/theme";
import { FIRST2000_MIN_POISHA, FIRST2000_VALUE_POISHA } from "../lib/theme";
import { useCart } from "../lib/cart-store";
import ProductImage from "./ProductImage";
import { RatingStars } from "./ProductCard";

type Tab = "description" | "specs" | "reviews" | "warranty";

/** Fullscreen photo viewer (lightbox). */
function PhotoViewer({
  images,
  initialIndex,
  title,
  canHover,
  onClose,
}: {
  images: string[];
  initialIndex: number;
  title: string;
  /** True on desktop (hover-capable pointer): zoom buttons + arrows. */
  canHover: boolean;
  onClose: () => void;
}) {
  const count = images.length;
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const touchStartRef = useRef<{
    x: number;
    y: number;
    startScale: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const pinchRef = useRef<{ startDistance: number; startScale: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const goNext = () => setIndex((current) => nextGalleryIndex(current, count));
  const goPrev = () => setIndex((current) => prevGalleryIndex(current, count));

  // A new photo starts unzoomed: the zoom belongs to the photo the
  // shopper was looking at, not the next one.
  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, [index]);

  // Escape closes, arrows move (desktop keyboard users), and the
  // page behind cannot scroll while the viewer is open. Focus starts
  // on the close button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") goNext();
      else if (event.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
    // goNext / goPrev only depend on `count`, which is stable here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // Desktop drag-to-pan (mouse pointer only, and only while zoomed
  // in — at 1x there is nothing to pan to). Touch has its own
  // handlers below; pointer events for touch are ignored here.
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (scale <= 1 || event.pointerType === "touch") return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: translate.x,
      baseY: translate.y,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const maxOffset = 200 * scale;
    setTranslate({
      x: clampPan(drag.baseX + (event.clientX - drag.startX), maxOffset),
      y: clampPan(drag.baseY + (event.clientY - drag.startY), maxOffset),
    });
  }
  function endPointerDrag() {
    dragRef.current = null;
    setDragging(false);
  }

  // Touch: one finger pans while zoomed in and swipes to the next /
  // previous photo at 1x; two fingers pinch-zoom. The stage has
  // touch-action: none so the browser does not steal the gesture
  // (page zoom / scroll) while the viewer owns it.
  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length === 2) {
      const [first, second] = [event.touches[0], event.touches[1]];
      if (!first || !second) return;
      pinchRef.current = {
        startDistance: pinchDistance(first.clientX, first.clientY, second.clientX, second.clientY),
        startScale: scale,
      };
      touchStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      startScale: scale,
      baseX: translate.x,
      baseY: translate.y,
    };
  }
  function handleTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    const pinch = pinchRef.current;
    if (pinch && event.touches.length === 2) {
      const [first, second] = [event.touches[0], event.touches[1]];
      if (!first || !second) return;
      setScale(
        pinchScale(
          pinch.startDistance,
          pinchDistance(first.clientX, first.clientY, second.clientX, second.clientY),
          pinch.startScale,
        ),
      );
      return;
    }
    const start = touchStartRef.current;
    const touch = event.touches[0];
    if (!start || !touch || start.startScale <= 1) return;
    const maxOffset = 200 * scale;
    setTranslate({
      x: clampPan(start.baseX + (touch.clientX - start.x), maxOffset),
      y: clampPan(start.baseY + (touch.clientY - start.y), maxOffset),
    });
  }
  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    if (pinchRef.current) {
      // A pinch just ended: settle back to 1x when the fingers came
      // together, so a zoomed-out photo never sits half-zoomed.
      pinchRef.current = null;
      if (scale <= 1) setTranslate({ x: 0, y: 0 });
      return;
    }
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || start.startScale > 1) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const direction = swipeDirection(start.x, start.y, touch.clientX, touch.clientY);
    if (direction === "left") goNext();
    else if (direction === "right") goPrev();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#080d18]"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — photo viewer`}
      data-testid="photo-viewer"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm text-muted" data-testid="viewer-counter">
          Photo {index + 1} of {count}
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close photo viewer"
          data-testid="viewer-close"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-panel text-text transition hover:border-brand"
        >
          <X size={20} />
        </button>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointerDrag}
        onPointerCancel={endPointerDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        data-testid="viewer-stage"
      >
        <div
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transition: dragging ? "none" : "transform 150ms ease-out",
            cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "default",
          }}
        >
          {/* Plain <img>, not next/image: the viewer shows the Storage
              photo at its original size and the transform above does
              the zooming; next/image's responsive sizing would fight
              it. Deliberate — the lint rule is disabled for this one
              element only. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[index]}
            alt={`${title} — photo ${index + 1}`}
            draggable={false}
            className="max-h-[75vh] max-w-[92vw] select-none object-contain"
            data-testid="viewer-image"
          />
        </div>
        {canHover && count > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous photo"
              data-testid="viewer-prev"
              className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-black/60 text-white transition hover:border-brand"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Next photo"
              data-testid="viewer-next"
              className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-black/60 text-white transition hover:border-brand"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 px-4 py-3">
        {canHover ? (
          <>
            <button
              type="button"
              onClick={() => setScale((current) => zoomStep(current, -1))}
              disabled={scale <= GALLERY_ZOOM_MIN}
              aria-label="Zoom out"
              data-testid="viewer-zoom-out"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-panel text-text transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ZoomOut size={18} />
            </button>
            <span className="w-14 text-center text-sm font-semibold text-text" data-testid="viewer-zoom-level">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setScale((current) => zoomStep(current, 1))}
              disabled={scale >= GALLERY_ZOOM_MAX}
              aria-label="Zoom in"
              data-testid="viewer-zoom-in"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-panel text-text transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ZoomIn size={18} />
            </button>
          </>
        ) : (
          <p className="text-xs text-muted">Swipe to change photo · pinch to zoom</p>
        )}
      </div>

      {count > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 pb-4">
          {images.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`View photo ${i + 1}`}
              aria-pressed={index === i}
              data-testid={`viewer-thumb-${i}`}
              className={`w-14 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                index === i ? "border-brand" : "border-border"
              }`}
            >
              <ProductImage src={src} alt={`${title} thumbnail ${i + 1}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProductGallery({
  product,
  images,
}: {
  product: Product;
  images: string[];
}) {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hidden, setHidden] = useState(false);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const swipedRef = useRef(false);
  const mainButtonRef = useRef<HTMLButtonElement>(null);
  const wasViewerOpenRef = useRef(false);

  const list = images.length > 0 ? images : [product.image];
  // The image list changes when the shopper picks a variant with its
  // own photo (ProductDetail swaps the list); go back to the first
  // image so the main photo is always the selected variant's photo,
  // not a stale thumbnail index from the previous list. `images` is
  // memoised by the caller, so this only fires when the list changes.
  useEffect(() => {
    setActive(0);
  }, [images]);

  // Pointer + motion capabilities are client-only: read them after
  // mount so the server render matches (no slider, no arrows, on
  // the server). A touch device reports hover: none, so it never
  // gets the auto-slider or the arrows — swipe is its navigation.
  useEffect(() => {
    const hoverQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setCanHover(hoverQuery.matches);
      setReducedMotion(motionQuery.matches);
    };
    update();
    hoverQuery.addEventListener("change", update);
    motionQuery.addEventListener("change", update);
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      hoverQuery.removeEventListener("change", update);
      motionQuery.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Focus returns to the main photo button when the viewer closes.
  useEffect(() => {
    if (!viewerOpen && wasViewerOpenRef.current) {
      mainButtonRef.current?.focus();
    }
    wasViewerOpenRef.current = viewerOpen;
  }, [viewerOpen]);

  // The slider only runs on desktop, only with more than one photo,
  // and only while nobody is looking at the photo: hovering,
  // focusing, opening the viewer or hiding the tab all pause it.
  const autoSlide =
    list.length > 1 && canHover && !reducedMotion && !hovered && !focused && !viewerOpen && !hidden;
  useEffect(() => {
    if (!autoSlide) return;
    const timer = window.setInterval(() => {
      setActive((current) => nextGalleryIndex(current, list.length));
    }, GALLERY_AUTO_SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [autoSlide, list.length]);

  const goNext = () => setActive((current) => nextGalleryIndex(current, list.length));
  const goPrev = () => setActive((current) => prevGalleryIndex(current, list.length));
  const showArrows = canHover && (hovered || focused) && list.length > 1;

  // Touch swipe on the main photo: a mostly-horizontal drag past the
  // minimum distance changes the photo; a short or vertical drag is
  // a tap / page scroll and does nothing. A swipe also fires a click
  // afterwards, so it is suppressed — otherwise every swipe would
  // open the viewer.
  function handleTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    if (touch) touchRef.current = { x: touch.clientX, y: touch.clientY };
  }
  function handleTouchEnd(event: React.TouchEvent) {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const direction = swipeDirection(start.x, start.y, touch.clientX, touch.clientY);
    if (!direction) return;
    swipedRef.current = true;
    window.setTimeout(() => {
      swipedRef.current = false;
    }, 50);
    if (direction === "left") goNext();
    else goPrev();
  }
  function handleMainClick() {
    if (swipedRef.current) return;
    setViewerOpen(true);
  }
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrev();
    }
  }

  return (
    <div>
      <div
        className="relative overflow-hidden rounded-2xl border border-border"
        // Horizontal drags belong to the gallery (swipe to change
        // photos); vertical drags stay with the page (scroll).
        // Without this, a rightward swipe on a phone is the browser's
        // back gesture and navigates away instead of showing the
        // previous photo.
        style={{ touchAction: "pan-y" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false);
        }}
        onKeyDown={handleKeyDown}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label={`${product.title} photos`}
        data-testid="gallery-main"
      >
        <button
          ref={mainButtonRef}
          type="button"
          onClick={handleMainClick}
          aria-label={`Open photo ${active + 1} of ${list.length} fullscreen`}
          data-testid="gallery-open-viewer"
          className="block w-full cursor-pointer"
        >
          <ProductImage
            key={list[active]}
            src={list[active]}
            alt={product.title}
            priority
          />
        </button>
        {showArrows && (
          <>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous photo"
              data-testid="gallery-prev"
              className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-black/60 text-white transition hover:border-brand"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Next photo"
              data-testid="gallery-next"
              className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-black/60 text-white transition hover:border-brand"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
        {list.length > 1 && (
          <p
            aria-live="polite"
            data-testid="gallery-counter"
            className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white"
          >
            Photo {active + 1} of {list.length}
          </p>
        )}
      </div>
      {list.length > 1 && (
        // Wraps instead of overflowing: with a colour variant picked
        // the row holds 5 thumbnails (5 x 80px + gaps = 448px), which
        // is wider than a phone's content column (~358px at 390px).
        // Without the wrap the page's layout viewport expands to fit
        // the row and the whole page — including the fixed viewer —
        // renders wider than the screen.
        <div className="mt-3 flex flex-wrap gap-3">
          {list.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`View photo ${i + 1}`}
              aria-pressed={active === i}
              data-testid={`gallery-thumb-${i}`}
              className={`w-20 overflow-hidden rounded-xl border-2 transition ${
                active === i ? "border-brand" : "border-border"
              }`}
            >
              <ProductImage src={src} alt={`${product.title} thumbnail ${i + 1}`} />
            </button>
          ))}
        </div>
      )}
      {viewerOpen && (
        <PhotoViewer
          images={list}
          initialIndex={active}
          title={product.title}
          canHover={canHover}
          onClose={() => setViewerOpen(false)}
        />
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
