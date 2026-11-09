"use client";

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

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Product } from "../../lib/data/catalog";
import {
  GALLERY_AUTO_SLIDE_MS,
  nextGalleryIndex,
  prevGalleryIndex,
  swipeDirection,
} from "../../lib/gallery";
import ProductImage from "../ProductImage";
import { PhotoViewer } from "./photo-viewer";

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
