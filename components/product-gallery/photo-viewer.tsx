"use client";

// Fullscreen photo viewer (lightbox) for the product gallery.
// Zoom in / out buttons and drag-to-pan on desktop, swipe +
// pinch on mobile, Escape or the close button to leave. The
// viewer always shows a close button; on mobile it is the only
// button.

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  GALLERY_ZOOM_MAX,
  GALLERY_ZOOM_MIN,
  clampPan,
  nextGalleryIndex,
  pinchDistance,
  pinchScale,
  prevGalleryIndex,
  swipeDirection,
  zoomStep,
} from "../../lib/gallery";
import ProductImage from "../ProductImage";

/** Fullscreen photo viewer (lightbox). */
export function PhotoViewer({
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
      className="fixed inset-0 z-50 flex flex-col bg-ink"
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
