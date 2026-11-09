// TechShot marketplace — pure catalogue rules.
//
// Maps Supabase rows to the storefront catalogue shape and enforces the
// public-visibility rule: ONLY status = 'active' products are ever shown
// to shoppers. A paused / draft / deleted product must not appear.
//
// This file has almost no imports on purpose: it is pure logic, so it
// can be imported directly by `node --test` (Node strips the erasable
// TypeScript types) and by the server-side catalogue loader in
// lib/supabase/catalog.ts. Its single import is lib/storage-images.ts,
// which follows the same rule (pure, no imports of its own), so the
// file stays directly loadable. Only erasable TypeScript is used here
// (interfaces + type annotations) — no enums, namespaces or parameter
// properties — so Node's type stripping can load this file as-is.
//
// Money is integer poisha everywhere (100 poisha = 1 BDT). Prices are
// copied from the database untouched: never converted, rounded or
// re-derived here.

// The rules used to live in this file. They have moved, one job per
// file, into lib/catalog/ — this file is now only a re-export barrel
// so every existing import path keeps working:
//   lib/catalog/db-types.ts        — Db row types, storefront shapes,
//                                    review-stats aggregation
//   lib/catalog/brands-variants.ts — brand derivation, variant helpers
//   lib/catalog/specs-gallery.ts   — specs record, variant-image /
//                                    gallery resolution
//   lib/catalog/mapping.ts         — visibility rule, row -> catalogue
//                                    mapping

export * from "./catalog/db-types";
export * from "./catalog/brands-variants";
export * from "./catalog/specs-gallery";
export * from "./catalog/mapping";
