// TechShot marketplace — pure product validation helpers.
//
// No server imports in this file (zod only), so the slug / money /
// variant rules can be unit-tested without a database or Supabase
// credentials. Server actions in lib/products/actions.ts import the
// zod schemas from here; the Node tests in
// tests/products-actions.test.mjs mirror these pure helpers in plain
// JS (Node cannot import .ts directly — same pattern as
// tests/pricing.test.mjs).
//
// Money is integer poisha (100 poisha = 1 BDT) everywhere in the DB.
// The forms work in BDT taka; conversion to poisha happens here and
// in the server actions, never in the browser.

// The validation helpers used to live in this file. They have moved,
// one job per file, into lib/products/validation/ — this file is now
// only a re-export barrel so every existing import path keeps working
// (including the unit tests, which import this path directly):
//   lib/products/validation/slug-money.ts  — slugify, dedupeSlug,
//                                           takaToPoisha, poishaToTaka
//   lib/products/validation/image-paths.ts — isSafeImagePath,
//                                           MAX_PRODUCT_IMAGES, mergeImagePaths
//   lib/products/validation/variants.ts    — ParsedVariant,
//                                           parseVariantsText, productVariantInputSchema
//   lib/products/validation/upload.ts      — MAX_UPLOAD_BYTES /
//                                           MAX_UPLOAD_FILES, validateUploadFile,
//                                           uploadStoragePath
//   lib/products/validation/schema.ts      — ProductStatus,
//                                           productInputSchema, ProductInput,
//                                           productStatusSchema, specification schemas

export * from "./validation/slug-money";
export * from "./validation/image-paths";
export * from "./validation/variants";
export * from "./validation/upload";
export * from "./validation/schema";
