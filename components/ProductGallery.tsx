"use client";

// Product gallery + product detail — the code moved 2026-11-09
// into components/product-gallery/ (one file per piece:
// photo-viewer.tsx, gallery.tsx, review-form.tsx,
// product-detail.tsx). This file stays so existing imports
// (app/product/[slug]/page.tsx) keep working; it only
// re-exports the same names.

export { ProductGallery } from "./product-gallery/gallery";
export { ProductDetail, default } from "./product-gallery/product-detail";
