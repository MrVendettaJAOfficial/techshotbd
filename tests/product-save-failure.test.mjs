// Product-save failure-visibility tests — TechShot.
//
// Covers the 2026-11-12 fix for audit run-1 finding #12
// (techshot:product-update-nonatomic-save-silent-data-loss): a
// product update used to delete all of a product's photos,
// variants and extra categories, then re-insert them through
// helpers that swallowed every failure and returned void, and
// still report { ok: true }.
//
// These tests run the REAL helpers (lib/products/actions/shared.ts)
// and the REAL actions (lib/products/actions/create-update.ts)
// against a fake admin client (tests/fake-supabase.mjs) with a
// stub staff user, under the stub hook in tests/next-stub-hooks.mjs
// (next/cache + auth + Supabase factories are stubbed because plain
// Node cannot import them). The fake fails each subordinate write
// in both failure modes the audit reproduced — the insert THROWS,
// and the insert RETURNS { error } — and the tests assert the
// failure is visible instead of silent.
//
// What is proven here:
//   - writeImages / writeVariants / writeCategories return true on
//     a clean write, and false when the write returns { error }
//     or throws (both modes, all three helpers), including a failed
//     delete in writeCategories;
//   - updateProduct returns { ok: false } when any subordinate
//     write fails — images, variants or categories — and stops at
//     the first failure instead of carrying on to the next helper;
//   - createProduct returns { ok: false } when any subordinate
//     write fails, instead of a product with silently dropped
//     photos / variants / categories;
//   - the happy path still returns { ok: true, slug } for both
//     actions, with every subordinate write attempted.
//
// What is NOT proven here: a failed save preserving the old rows.
// The schema forbids insert-first (product_images has a unique
// (product_id, storage_path) constraint, product_categories a
// (product_id, category_id) primary key, and variants have no
// identity to delete stale rows by), so the fix is delete-then-
// insert WITH failure reporting: the failure is visible and the
// staff member can retry from the form, which still holds the
// photos and variants they entered. There is no transaction in
// supabase-js without a Postgres function, so a failed save can
// still leave the product row updated and the child rows deleted
// — the { ok: false } is what stops it being silent.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./next-stub-hooks.mjs", import.meta.url);

import { __setAdminClient } from "./stubs/supabase-server-stub.mjs";
import { __setUser } from "./stubs/auth-server-stub.mjs";
import { makeFakeAdmin, stepArgs, stepOp } from "./fake-supabase.mjs";

const shared = await import("../lib/products/actions/shared.ts");
const { createProduct, updateProduct } = await import("../lib/products/actions/create-update.ts");

const GENERIC_ERROR = shared.GENERIC_ERROR;

const STAFF = { id: "staff-1", email: "staff@techshot.test", displayName: "Staff Owner", role: "admin" };

// Valid input for the actions. Title matches the existing product
// below, so updateProduct keeps the slug without a uniqueness
// lookup; categorySlugs [audio, flash-deals] makes the primary
// "audio" and "flash-deals" the one extra membership.
const INPUT = {
  title: "Sony WH-1000XM5",
  categorySlug: "audio",
  categorySlugs: ["audio", "flash-deals"],
  description: "Wireless noise cancelling headphones.",
  priceTaka: 24990,
  stock: 5,
  status: "active",
  imagePath: "",
  imagePaths: ["/images/products/sony-wh-1000xm5.jpg", "/images/products/sony-wh-1000xm5-2.jpg"],
  variants: [{ name: "Black", priceTaka: 24990, stock: 5 }],
  warranty: "",
  specifications: [],
};

const EXISTING = { id: "prod-sony", slug: "sony-wh-1000xm5", title: "Sony WH-1000XM5" };

/**
 * A fake admin client for the product save path. `fail` maps a
 * table to a failure mode — "error" (the write returns { error })
 * or "throw" (the write throws) — applied to that table's insert,
 * or, for a "table.delete" key, to its delete. Every other query
 * answers as a healthy database would: the product loads, the
 * category loads, the product row inserts / updates, audit_log
 * accepts.
 */
function saveClient(fail = {}) {
  return makeFakeAdmin((table, steps) => {
    const op = stepOp(steps);
    // Which failure applies to this query, if any: fail[table]
    // covers the table's insert, fail["table.delete"] its delete.
    const mode = op === "delete" ? fail[`${table}.delete`] : fail[table];
    if (mode === "throw") return new Error("dummy DB error");
    if (mode === "error") return { data: null, error: { message: "dummy DB error" } };
    if (table === "products" && op === "select") {
      // The slug-uniqueness lookup (a like query) answers with a
      // list; the single-product load (maybeSingle) with one row.
      if (steps.some(([method]) => method === "like")) {
        return { data: [], error: null };
      }
      return { data: EXISTING, error: null };
    }
    if (table === "products" && op === "insert") {
      return { data: { id: "prod-sony", slug: "sony-wh-1000xm5" }, error: null };
    }
    if (table === "categories" && op === "select") {
      const inSlugs = stepArgs(steps, "in")[1];
      if (Array.isArray(inSlugs)) {
        return {
          data: inSlugs.map((slug) => ({ id: `cat-${slug}`, slug, name: slug })),
          error: null,
        };
      }
      return { data: { id: "cat-audio", name: "Audio" }, error: null };
    }
    return { data: null, error: null };
  });
}

/** Tables whose insert/delete ran, in call order, for one action. */
function writeCalls(admin) {
  return admin.calls
    .filter(({ table }) => ["product_images", "product_variants", "product_categories"].includes(table))
    .map(({ table, steps }) => `${table}.${stepOp(steps)}`);
}

test.beforeEach(() => {
  __setUser(STAFF);
});

test.afterEach(() => {
  __setAdminClient(null);
  __setUser(STAFF);
});

// ---------------------------------------------------------------------------
// writeImages / writeVariants / writeCategories: the helpers themselves
// ---------------------------------------------------------------------------

test("writeImages returns true on a clean insert", async () => {
  const admin = saveClient();
  __setAdminClient(admin);
  assert.equal(await shared.writeImages(admin, "prod-sony", ["/a.jpg", "/b.jpg"], "T"), true);
  assert.deepEqual(writeCalls(admin), ["product_images.insert"]);
});

test("writeImages returns false when the insert returns { error }", async () => {
  const admin = saveClient({ product_images: "error" });
  __setAdminClient(admin);
  assert.equal(await shared.writeImages(admin, "prod-sony", ["/a.jpg"], "T"), false);
});

test("writeImages returns false when the insert throws", async () => {
  const admin = saveClient({ product_images: "throw" });
  __setAdminClient(admin);
  assert.equal(await shared.writeImages(admin, "prod-sony", ["/a.jpg"], "T"), false);
});

test("writeImages returns true without inserting when there are no photos", async () => {
  const admin = saveClient();
  __setAdminClient(admin);
  assert.equal(await shared.writeImages(admin, "prod-sony", ["  ", ""], "T"), true);
  assert.deepEqual(writeCalls(admin), []);
});

test("writeVariants returns true on a clean insert", async () => {
  const admin = saveClient();
  __setAdminClient(admin);
  assert.equal(await shared.writeVariants(admin, "prod-sony", [{ name: "Black", stock: 5 }]), true);
});

test("writeVariants returns false when the insert returns { error }", async () => {
  const admin = saveClient({ product_variants: "error" });
  __setAdminClient(admin);
  assert.equal(await shared.writeVariants(admin, "prod-sony", [{ name: "Black", stock: 5 }]), false);
});

test("writeVariants returns false when the insert throws", async () => {
  const admin = saveClient({ product_variants: "throw" });
  __setAdminClient(admin);
  assert.equal(await shared.writeVariants(admin, "prod-sony", [{ name: "Black", stock: 5 }]), false);
});

test("writeCategories returns true on a clean delete + insert", async () => {
  const admin = saveClient();
  __setAdminClient(admin);
  assert.equal(await shared.writeCategories(admin, "prod-sony", ["cat-flash"]), true);
  assert.deepEqual(writeCalls(admin), ["product_categories.delete", "product_categories.insert"]);
});

test("writeCategories returns false when the insert returns { error }", async () => {
  const admin = saveClient({ product_categories: "error" });
  __setAdminClient(admin);
  assert.equal(await shared.writeCategories(admin, "prod-sony", ["cat-flash"]), false);
});

test("writeCategories returns false when the insert throws", async () => {
  const admin = saveClient({ product_categories: "throw" });
  __setAdminClient(admin);
  assert.equal(await shared.writeCategories(admin, "prod-sony", ["cat-flash"]), false);
});

test("writeCategories returns false when the delete returns { error }", async () => {
  const admin = saveClient({ "product_categories.delete": "error" });
  __setAdminClient(admin);
  assert.equal(await shared.writeCategories(admin, "prod-sony", ["cat-flash"]), false);
  // The failed delete stops the sync: no insert is attempted.
  assert.deepEqual(writeCalls(admin), ["product_categories.delete"]);
});

test("writeCategories returns true without inserting when there are no extra categories", async () => {
  const admin = saveClient();
  __setAdminClient(admin);
  assert.equal(await shared.writeCategories(admin, "prod-sony", []), true);
  assert.deepEqual(writeCalls(admin), ["product_categories.delete"]);
});

// ---------------------------------------------------------------------------
// updateProduct: a failed subordinate write fails the save
// ---------------------------------------------------------------------------

test("updateProduct returns { ok: true } on a clean save", async () => {
  const admin = saveClient();
  __setAdminClient(admin);
  assert.deepEqual(await updateProduct("prod-sony", INPUT), { ok: true, slug: "sony-wh-1000xm5" });
  assert.deepEqual(writeCalls(admin), [
    "product_images.delete",
    "product_images.insert",
    "product_variants.delete",
    "product_variants.insert",
    "product_categories.delete",
    "product_categories.insert",
  ]);
});

test("updateProduct returns { ok: false } when the images insert returns { error }", async () => {
  const admin = saveClient({ product_images: "error" });
  __setAdminClient(admin);
  const result = await updateProduct("prod-sony", INPUT);
  assert.deepEqual(result, { ok: false, error: GENERIC_ERROR });
  // The stale photos are deleted first (schema forbids
  // insert-first), the insert fails, and the save stops there:
  // variants and categories are never attempted.
  assert.deepEqual(writeCalls(admin), ["product_images.delete", "product_images.insert"]);
});

test("updateProduct returns { ok: false } when the images insert throws", async () => {
  const admin = saveClient({ product_images: "throw" });
  __setAdminClient(admin);
  assert.deepEqual(await updateProduct("prod-sony", INPUT), { ok: false, error: GENERIC_ERROR });
});

test("updateProduct returns { ok: false } when the variants insert throws", async () => {
  const admin = saveClient({ product_variants: "throw" });
  __setAdminClient(admin);
  const result = await updateProduct("prod-sony", INPUT);
  assert.deepEqual(result, { ok: false, error: GENERIC_ERROR });
  // Photos were replaced before the variants failed; categories
  // are never attempted after the failure.
  assert.deepEqual(writeCalls(admin), [
    "product_images.delete",
    "product_images.insert",
    "product_variants.delete",
    "product_variants.insert",
  ]);
});

test("updateProduct returns { ok: false } when the categories insert returns { error }", async () => {
  const admin = saveClient({ product_categories: "error" });
  __setAdminClient(admin);
  assert.deepEqual(await updateProduct("prod-sony", INPUT), { ok: false, error: GENERIC_ERROR });
});

test("updateProduct returns { ok: false } when the images delete returns { error }", async () => {
  const admin = saveClient({ "product_images.delete": "error" });
  __setAdminClient(admin);
  assert.deepEqual(await updateProduct("prod-sony", INPUT), { ok: false, error: GENERIC_ERROR });
  assert.deepEqual(writeCalls(admin), ["product_images.delete"]);
});

// ---------------------------------------------------------------------------
// createProduct: a failed subordinate write fails the create
// ---------------------------------------------------------------------------

test("createProduct returns { ok: true } on a clean create", async () => {
  const admin = saveClient();
  __setAdminClient(admin);
  assert.deepEqual(await createProduct(INPUT), { ok: true, slug: "sony-wh-1000xm5" });
});

test("createProduct returns { ok: false } when the images insert throws", async () => {
  const admin = saveClient({ product_images: "throw" });
  __setAdminClient(admin);
  assert.deepEqual(await createProduct(INPUT), { ok: false, error: GENERIC_ERROR });
});

test("createProduct returns { ok: false } when the variants insert returns { error }", async () => {
  const admin = saveClient({ product_variants: "error" });
  __setAdminClient(admin);
  assert.deepEqual(await createProduct(INPUT), { ok: false, error: GENERIC_ERROR });
});

test("createProduct returns { ok: false } when the categories insert returns { error }", async () => {
  const admin = saveClient({ product_categories: "error" });
  __setAdminClient(admin);
  assert.deepEqual(await createProduct(INPUT), { ok: false, error: GENERIC_ERROR });
});
