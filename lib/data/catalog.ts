// Local seed catalogue for the TechShot storefront.
//
// Seed data mirroring supabase/seed.sql. This is the single source of
// product data for the storefront until Supabase is connected; it will be
// replaced by Supabase queries (see lib/supabase/*, owned by another agent).
//
// Ratings here are ALWAYS 0 with review_count 0: there are no real
// reviews in this fallback, and the old seeded numbers were fabricated.
// Real ratings come only from the reviews table (see lib/reviews.ts and
// lib/catalog-rules.ts aggregateReviewStats). The "BESTSELLER" badges
// that were derived from those fabricated counts are gone too; only
// "FLASH DEAL" badges remain, because they come from the real flash flag.
// Prices are in poisha (1 BDT = 100 poisha). Currency is BDT throughout.
// Bangladesh localisation only: Dhaka/Chattogram, Division/District,
// bKash/Nagad, cash on delivery.

// The catalogue used to live in this file. It has moved, one job per
// file, into lib/data/catalog/ — this file is now only a re-export
// barrel so every existing import path keeps working:
//   lib/data/catalog/types.ts         — Category / Product /
//                                      SubscriptionPlan shapes
//   lib/data/catalog/seed-products.ts — CATEGORIES / PRODUCTS /
//                                      SUBSCRIPTIONS / FLASH_DEAL_ENDS_AT
//   lib/data/catalog/helpers.ts       — getProduct, getProductForCartSlug,
//                                      getRelated, searchProducts, categoryName

export * from "./catalog/types";
export * from "./catalog/seed-products";
export * from "./catalog/helpers";
