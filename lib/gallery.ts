// TechShot marketplace — pure gallery helpers.
//
// Slider, swipe and pinch-zoom maths for the product gallery
// (components/ProductGallery.tsx). No imports, no DOM access, so
// `node --test` can import this file directly and prove the rules
// without a browser:
//
//   * the slider wraps around (last photo -> first, first -> last);
//   * a swipe is a mostly-horizontal drag past a minimum distance —
//     a short drag or a mostly-vertical drag (page scroll) is not a
//     swipe, so swiping never fights scrolling;
//   * pinch-zoom scales from the distance between two fingers and is
//     clamped to 1x–4x, so a photo can never shrink below its frame
//     or blow up without limit.
//
// The component owns the timing (auto-slide interval), the hover /
// focus / touch state and the reduced-motion check; this file only
// answers "what happens next" for a given gesture.

/** Auto-slide interval on desktop (hover-capable pointers only). */
export const GALLERY_AUTO_SLIDE_MS = 4500;

/** Minimum horizontal drag (px) that counts as a swipe. */
export const GALLERY_SWIPE_MIN_PX = 50;

/** Zoom limits in the fullscreen viewer. */
export const GALLERY_ZOOM_MIN = 1;
export const GALLERY_ZOOM_MAX = 4;

/** Index after moving one photo forward, wrapping at the end. */
export function nextGalleryIndex(current: number, count: number): number {
  if (count <= 0) return 0;
  return (current + 1) % count;
}

/** Index after moving one photo back, wrapping at the start. */
export function prevGalleryIndex(current: number, count: number): number {
  if (count <= 0) return 0;
  return (current - 1 + count) % count;
}

/**
 * Swipe direction for a drag from (startX, startY) to (endX, endY),
 * or null when it is not a swipe: shorter than the minimum distance,
 * or mostly vertical (a page scroll, not a photo change). A swipe
 * left shows the next photo, a swipe right the previous one.
 */
export function swipeDirection(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  minDistance: number = GALLERY_SWIPE_MIN_PX,
): "left" | "right" | null {
  const dx = endX - startX;
  const dy = endY - startY;
  if (Math.abs(dx) < minDistance) return null;
  if (Math.abs(dy) > Math.abs(dx)) return null;
  return dx < 0 ? "left" : "right";
}

/** Distance (px) between two touch points. */
export function pinchDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Clamp a zoom level to the viewer's 1x–4x range. */
export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return GALLERY_ZOOM_MIN;
  return Math.min(GALLERY_ZOOM_MAX, Math.max(GALLERY_ZOOM_MIN, scale));
}

/**
 * Zoom level after a pinch: the scale grows / shrinks with the ratio
 * of the fingers' current distance to their starting distance,
 * clamped to 1x–4x. A zero starting distance (two fingers on the
 * same point) leaves the scale unchanged instead of dividing by zero.
 */
export function pinchScale(
  startDistance: number,
  currentDistance: number,
  startScale: number,
): number {
  if (!(startDistance > 0) || !(currentDistance > 0)) return clampZoom(startScale);
  return clampZoom(startScale * (currentDistance / startDistance));
}

/**
 * One zoom-button step: zoom in multiplies by 1.5x, zoom out divides
 * by 1.5x, both clamped to 1x–4x. Steps (not a continuous slider)
 * keep the zoom predictable: 1x -> 1.5x -> 2.25x -> 3.375x -> 4x.
 */
export function zoomStep(scale: number, direction: 1 | -1): number {
  return clampZoom(direction === 1 ? scale * 1.5 : scale / 1.5);
}

/** Clamp a pan offset so a zoomed photo cannot be dragged off-screen. */
export function clampPan(offset: number, maxOffset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(maxOffset, Math.max(-maxOffset, offset));
}
