// Product extras-failure tests — TechShot.
//
// Covers the 2026-11-16 fix for Ponytail review finding #8:
// lib/products/queries.ts loadExtras() ignored errors from the
// product_images / product_variants selects and fell back to
// empty lists, while the product itself still loaded. The admin
// form then showed the product with no photos and no variants,
// and saving any small change ran updateProduct — which deletes
// all product_images / product_variants rows first and re-inserts
// only what the form holds — so the real photos and variants were
// gone.
//
// These tests run the REAL fetchAllProducts()
// (lib/products/queries.ts) against a fake admin client
// (tests/fake-supabase.mjs) under the stub hook in
// tests/next-stub-hooks.mjs. What is proven here:
//   - an error from the product_images select fails the whole
//     fetch (no products, configured: false) instead of returning
//     the product with empty photos;
//   - an error from the product_variants select does the same;
//   - a thrown extras query does the same;
//   - when both extras queries succeed, the product comes back
//     with its photos and variants intact (the happy path);
//   - the product_categories join read stays tolerant: a missing
//     table (pre-migration-0012) still returns the products under
//     their primary category only.
//
// What is NOT proven here: the admin page rendering (the empty +
// configured: false result drives the existing "Live product data
// is not configured yet" alert in the product form and disables
// it, so no save can wipe the photos). The shopfront is untouched
// by this change — it reads products through the joined catalogue
// query in lib/supabase/catalog.ts, not through loadExtras.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./next-stub-hooks.mjs", import.meta.url);

import { __setAdminClient } from "./stubs/supabase-server-stub.mjs";
import { makeFakeAdmin } from "./fake-supabase.mjs";

const queries = await import("../lib/products/queries.ts");

const PRODUCT_ROW = {
  id: "prod-1",
  seller_id: "owner-1",
  category_id: "cat-1",
  title: "Banner lamp",
  slug: "banner-lamp",
  description: "A lamp.",
  price_poisha: 149900,
  compare_at_poisha: null,
  stock: 5,
  status: "active",
  warranty: null,
  specifications: [],
  created_at: "2026-11-16T00:00:00.000Z",
};

const CATEGORY_ROW = { id: "cat-1", slug: "lighting", name: "Lighting", is_active: true };

const IMAGE_ROWS = [
  { product_id: "prod-1", storage_path: "banner-lamp-abc.jpg", sort_order: 0 },
  { product_id: "prod-1", storage_path: "banner-lamp-def.jpg", sort_order: 1 },
];

const VARIANT_ROWS = [
  { product_id: "prod-1", name: "Warm white", price_override_poisha: null, stock: 3, image_path: null },
];

/**
 * A fake admin client answering the tables fetchAllProducts reads.
 * `imagesError` / `variantsError` make that extras select return
 * an error; `imagesThrow` makes it throw instead; `categoriesError`
 * makes the product_categories join read fail (the tolerated case).
 */
function productsClient({ imagesError = false, variantsError = false, imagesThrow = false, categoriesError = false } = {}) {
  return makeFakeAdmin((table) => {
    if (table === "products") return { data: [PRODUCT_ROW], error: null };
    if (table === "categories") return { data: [CATEGORY_ROW], error: null };
    if (table === "product_images") {
      if (imagesThrow) return new Error("dummy DB error");
      if (imagesError) return { data: null, error: { message: "dummy DB error" } };
      return { data: IMAGE_ROWS, error: null };
    }
    if (table === "product_variants") {
      if (variantsError) return { data: null, error: { message: "dummy DB error" } };
      return { data: VARIANT_ROWS, error: null };
    }
    if (table === "product_categories") {
      if (categoriesError) return { data: null, error: { message: "dummy DB error" } };
      return { data: [], error: null };
    }
    return { data: [], error: null };
  });
}

test.afterEach(() => {
  __setAdminClient(null);
});

test("an images-query error fails the whole fetch instead of returning the product photo-less", async () => {
  __setAdminClient(productsClient({ imagesError: true }));
  const result = await queries.fetchAllProducts();
  assert.deepEqual(result, { products: [], categories: [], configured: false });
});

test("a variants-query error fails the whole fetch instead of returning the product variant-less", async () => {
  __setAdminClient(productsClient({ variantsError: true }));
  const result = await queries.fetchAllProducts();
  assert.deepEqual(result, { products: [], categories: [], configured: false });
});

test("a thrown images query fails the whole fetch", async () => {
  __setAdminClient(productsClient({ imagesThrow: true }));
  const result = await queries.fetchAllProducts();
  assert.deepEqual(result, { products: [], categories: [], configured: false });
});

test("when both extras queries succeed the product keeps its photos and variants", async () => {
  __setAdminClient(productsClient());
  const result = await queries.fetchAllProducts();
  assert.equal(result.configured, true);
  assert.equal(result.products.length, 1);
  assert.deepEqual(result.products[0].imagePaths, ["banner-lamp-abc.jpg", "banner-lamp-def.jpg"]);
  assert.equal(result.products[0].imagePath, "banner-lamp-abc.jpg");
  assert.equal(result.products[0].variants.length, 1);
  assert.equal(result.products[0].variants[0].name, "Warm white");
  assert.deepEqual(result.categories, [{ slug: "lighting", name: "Lighting" }]);
});

test("a product_categories failure stays tolerated (primary category only)", async () => {
  __setAdminClient(productsClient({ categoriesError: true }));
  const result = await queries.fetchAllProducts();
  assert.equal(result.configured, true);
  assert.equal(result.products.length, 1);
  assert.deepEqual(result.products[0].categorySlugs, ["lighting"]);
});
