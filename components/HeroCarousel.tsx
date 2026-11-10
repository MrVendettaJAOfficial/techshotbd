// Hero banner carousel (client component) — the home-page hero,
// IMAGE-ONLY since the 2026-11-10 redesign.
//
// The whole section shows just the banner photo: no headline,
// subcopy, button or price text anywhere. Slides come from the
// admin-managed banners when any is active, otherwise from the top
// products (the fallback in lib/hero-slides.ts), so the home page
// never shows an empty hero. The text the admin used to type
// (headline / subcopy / button) now lives INSIDE the banner image
// itself — the banner's headline survives only as the slide's alt
// text (accessibility), never as visible text.
//
// Behaviour follows the product gallery (components/product-gallery/
// gallery.tsx) where it can, with two deliberate differences:
// auto-advance runs on ALL devices (touch included — the user
// asked for a continuous loop of images), and every slide is
// rendered at once, stacked and crossfaded, so a photo can never
// linger mismatched with a different slide (the old carousel
// swapped the text instantly while the previous photo was still
// showing).
//
//   * Auto-advance every GALLERY_AUTO_SLIDE_MS (4.5s), paused on
//     hover / focus / hidden tab / reduced-motion. ANY manual
//     navigation (dot, arrow, swipe, keyboard) RESETS the timer —
//     a `tick` state the interval effect depends on — so a manual
//     pick is never immediately overridden by the old timer.
//     Wraps around both directions.
//   * Dots are overlaid at the bottom centre of the image, on a
//     small dark translucent pill so they read over any photo.
//   * Arrows are overlaid at the left/right edges, visible on
//     hover / focus on desktop only (the gallery's canHover gate);
//     on mobile swipe + dots, no arrows.
//   * Keyboard arrows work when the region is focused.
//
// Restrained on purpose: 380px tall on desktop, about 200px on a
// phone (a banner strip, not a full-viewport takeover). A slide
// with no image shows the TechShot logo placeholder, never a
// blank area.

"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GALLERY_AUTO_SLIDE_MS, nextGalleryIndex, prevGalleryIndex, swipeDirection } from "../lib/gallery";
import type { HeroSlide } from "../lib/hero-slides";
import ProductPlaceholder from "./ProductPlaceholder";

export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hidden, setHidden] = useState(false);
  // Reset token for the auto-advance timer: every manual
  // navigation bumps it, which restarts the interval (see the
  // effect below), so the old timer can never fire straight after
  // a manual pick and undo it.
  const [tick, setTick] = useState(0);
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  const count = slides.length;
  // The parent never passes an empty list (the fallback covers it),
  // but guard anyway: no slide, no carousel.
  const current = count > 0 ? Math.min(active, count - 1) : 0;

  // Pointer + motion capabilities are client-only: read them after
  // mount so the server render matches (no arrows on the server).
  // A touch device reports hover: none, so it never gets the
  // arrows — swipe is its navigation — but it DOES get the
  // auto-advance loop, unlike the old carousel.
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

  // The slider runs on every device with more than one slide, and
  // only while nobody is looking at the hero: hovering, focusing
  // or hiding the tab all pause it, and prefers-reduced-motion
  // turns it off entirely. It depends on `tick`, so any manual
  // navigation restarts the 4.5s wait from the pick.
  const autoSlide = count > 1 && !reducedMotion && !hovered && !focused && !hidden;
  useEffect(() => {
    if (!autoSlide) return;
    const timer = window.setInterval(() => {
      setActive((prev) => nextGalleryIndex(prev, count));
    }, GALLERY_AUTO_SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [autoSlide, count, tick]);

  const goTo = (index: number) => {
    setActive(index);
    setTick((prev) => prev + 1);
  };
  const goNext = () => goTo(nextGalleryIndex(current, count));
  const goPrev = () => goTo(prevGalleryIndex(current, count));
  const showArrows = canHover && (hovered || focused) && count > 1;

  // Touch swipe: a mostly-horizontal drag past the minimum distance
  // changes the slide; a short or vertical drag is a tap / page
  // scroll and does nothing.
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
    if (direction === "left") goNext();
    else goPrev();
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

  if (count === 0) return null;

  return (
    <div
      className="relative h-[200px] overflow-hidden rounded-3xl border border-border bg-panel lg:h-[380px]"
      // Horizontal drags belong to the carousel (swipe to change
      // slides); vertical drags stay with the page (scroll).
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
      aria-label="Featured banners"
      data-testid="hero-carousel"
    >
      {/* Every slide is rendered, stacked in the same fixed-height
          frame, and crossfaded — the next photo is already loaded
          when the slide changes, so no photo ever lingers under a
          different slide's turn. Inactive slides are transparent
          and untouchable. Reduced motion: no transition. */}
      {slides.map((slide, i) => (
        <div
          key={`${slide.alt}-${i}`}
          aria-hidden={i !== current}
          data-testid="hero-slide"
          data-slide-index={i}
          data-slide-alt={slide.alt}
          className={`absolute inset-0 ${reducedMotion ? "" : "transition-opacity duration-500"} ${
            i === current ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          {slide.image !== "" ? (
            <Image
              src={slide.image}
              alt={slide.alt}
              fill
              priority={i === 0}
              sizes="100vw"
              className="object-cover"
            />
          ) : (
            <ProductPlaceholder className="h-full w-full" label={slide.alt} />
          )}
        </div>
      ))}
      {showArrows && (
        <>
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous banner"
            data-testid="hero-prev"
            className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-black/60 text-white transition hover:border-brand"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-label="Next banner"
            data-testid="hero-next"
            className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-black/60 text-white transition hover:border-brand"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
      {count > 1 && (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/50 px-3 py-2" role="tablist" aria-label="Choose banner">
          {slides.map((slide, i) => (
            <button
              key={`${slide.alt}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === current}
              aria-label={`Go to banner ${i + 1}: ${slide.alt}`}
              data-testid={`hero-dot-${i}`}
              onClick={() => goTo(i)}
              className={`h-2.5 rounded-full transition ${
                i === current ? "w-8 bg-white" : "w-2.5 bg-white/60"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
