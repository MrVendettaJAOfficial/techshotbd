// Hero banner carousel (client component) — the home-page hero.
//
// Replaces the old static hero (one panel + a decorative "01 / 03"
// pager that never moved). Slides come from the admin-managed
// banners when any is active, otherwise from the top products
// (the fallback in lib/hero-slides.ts), so the home page never
// shows an empty hero.
//
// Behaviour follows the product gallery (components/product-gallery/
// gallery.tsx) exactly, so shoppers meet one carousel language:
//   * Desktop (hover-capable pointer): auto-advances every
//     GALLERY_AUTO_SLIDE_MS (4.5s) while nobody is looking at it —
//     hovering, focusing or opening the page in a hidden tab pauses
//     it; prefers-reduced-motion turns it off entirely; arrows
//     appear on hover / focus; dots are always there.
//   * Mobile (touch): no auto-advance, no arrows — swipe left /
//     right to change slides, like the phone's own gallery.
//   * Keyboard arrows work when the carousel is focused.
//
// Restrained on purpose: the slide is capped at 380px tall on
// desktop (a banner strip, not a full-viewport takeover), the photo
// panel is 176px tall on a phone, and the text is one headline +
// one line of subcopy + one button — the user asked for banners
// that are not "too much". A slide with no image shows the
// TechShot logo placeholder, never a blank area.

"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Zap } from "lucide-react";
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
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  const count = slides.length;
  // The parent never passes an empty list (the fallback covers it),
  // but guard anyway: no slide, no carousel.
  const slide = count > 0 ? slides[Math.min(active, count - 1)] : undefined;

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

  // The slider only runs on desktop, only with more than one slide,
  // and only while nobody is looking at the hero: hovering,
  // focusing or hiding the tab all pause it.
  const autoSlide =
    count > 1 && canHover && !reducedMotion && !hovered && !focused && !hidden;
  useEffect(() => {
    if (!autoSlide) return;
    const timer = window.setInterval(() => {
      setActive((current) => nextGalleryIndex(current, count));
    }, GALLERY_AUTO_SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [autoSlide, count]);

  const goNext = () => setActive((current) => nextGalleryIndex(current, count));
  const goPrev = () => setActive((current) => prevGalleryIndex(current, count));
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

  if (!slide) return null;

  return (
    <div>
      <div
        className="relative overflow-hidden rounded-3xl border border-border bg-panel"
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
        <div
          className="grid lg:h-[380px] lg:grid-cols-2"
          data-testid="hero-slide"
          data-slide-index={Math.min(active, count - 1)}
          data-slide-headline={slide.headline}
        >
          <div className="flex flex-col justify-center p-6 sm:p-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brandDark">
              {slide.eyebrow}
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight text-text sm:text-4xl">
              {slide.headline}
            </h1>
            {slide.subcopy !== "" ? (
              <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
                {slide.subcopy}
              </p>
            ) : null}
            {slide.ctaLabel !== "" ? (
              <div className="mt-6">
                <Link
                  href={slide.ctaHref}
                  data-testid="hero-cta"
                  className="inline-flex items-center gap-2 rounded-xl bg-brandDark px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-brandDarker"
                >
                  {slide.ctaLabel} <ArrowRight size={16} />
                </Link>
              </div>
            ) : null}
          </div>

          <div className="relative h-44 sm:h-56 lg:h-full">
            {slide.image !== "" ? (
              <Image
                src={slide.image}
                alt={slide.headline}
                fill
                priority={active === 0}
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            ) : (
              <ProductPlaceholder className="h-full w-full" label={slide.headline} />
            )}
            {slide.priceChip ? (
              <div className="absolute bottom-4 left-4 flex items-center gap-3 rounded-2xl bg-ink/90 px-4 py-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brandDark text-white">
                  <Zap size={20} />
                </span>
                <div>
                  <p className="text-sm font-bold text-white">{slide.priceChip}</p>
                  <p className="text-xs text-mutedNavy">Free delivery over ৳999</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
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
      </div>
      {count > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <div className="flex items-center gap-2" role="tablist" aria-label="Choose banner">
            {slides.map((item, i) => (
              <button
                key={item.headline + i}
                type="button"
                role="tab"
                aria-selected={i === Math.min(active, count - 1)}
                aria-label={`Go to banner ${i + 1}: ${item.headline}`}
                data-testid={`hero-dot-${i}`}
                onClick={() => setActive(i)}
                className={`h-2.5 rounded-full transition ${
                  i === Math.min(active, count - 1) ? "w-8 bg-brand" : "w-2.5 bg-border"
                }`}
              />
            ))}
          </div>
          <p
            aria-live="polite"
            data-testid="hero-counter"
            className="font-mono text-xs tracking-widest text-muted"
          >
            {String(Math.min(active, count - 1) + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
          </p>
        </div>
      )}
    </div>
  );
}
