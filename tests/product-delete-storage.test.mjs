// Product-delete Storage-reclamation tests — TechShot.
//
// Covers audit run-1 LOW 8
// (techshot:products:deleteProduct-storage-objects-not-removed):
// deleting a product removed its database rows (images and
// variants cascade) but never removed its files from the public
// product-images bucket, so the photos stayed retrievable at
// their public URLs indefinitely. deleteProduct now reads the
// product's product_images.storage_path and
// product_variants.image_path values BEFORE the delete, deletes
// the row, then removes the bucket objects — following the
// deleteBanner pattern in lib/banners-server.ts.
//
// These tests run the REAL action (lib/products/actions/manage.ts)
// against a fake admin client (tests/fake-supabase.mjs) with a
// stub staff user, under the stub hook in
// tests/next-stub-hooks.mjs. What is proven here:
//   - product + variant photos (bare Storage filenames) are
//     removed with the row, in one remove call;
//   - full https URLs are skipped (not bucket objects) and legacy
//     "/images/products/<file>" paths resolve to their basename;
//   - a file another product still references is kept, and a file
//     a banner still references is kept;
//   - a Storage removal failure still deletes the row, logs
//     server-side, and returns a visible warning on the ok result
//     — never a silent success;
//   - a product with no photos removes nothing and warns nothing;
//   - a missing product errors without touching Storage, and a
//     non-staff caller is rejected before any delete;
//   - an unreadable photo-reference read still deletes the row
//     but warns that the photos could not be checked.
//
// What is NOT proven here: the live bucket round-trip — the
// browser-level proof (upload a photo, delete the product, the
// file leaves the mock bucket listing) is in
// tests/e2e/lows-products-catalog.mjs.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./next-stub-hooks.mjs", import.meta.url);

import { __setAdminClient } from "./stubs/supabase-server-stub.mjs";
import { __setUser } from "./stubs/auth-server-stub.mjs";
import { makeFakeAdmin, makeFakeStorage, stepOp } from "./fake-supabase.mjs";

const manage = await import("../lib/products/actions/manage.ts");

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:3101";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";

const STAFF = { id: "staff-1", email: "staff@techshot.test", displayName: "Staff Owner", role: "admin" };
const CUSTOMER = { id: "cust-1", email: "cust@techshot.test", displayName: "Customer", role: "customer" };

function deleteClient({
  productExists = true,
  imageRows = [],
  variantRows = [],
  bannerRows = [],
  failImageRead = false,
  failRemove = false,
} = {}) {
  let deleted = false;
  const removed = [];
  const storage = makeFakeStorage({
    remove: async (paths) => {
      if (failRemove) return { data: null, error: { message: "dummy storage error" } };
      removed.push(...paths);
      return { data: [], error: null };
    },
  });
  const admin = makeFakeAdmin((table, steps) => {
    const op = stepOp(steps);
    if (table === "products") {
      if (op === "select") {
        return { data: productExists ? { id: "prod-1", slug: "test-phone" } : null, error: null };
      }
      if (op === "delete") {
        deleted = true;
        return { data: null, error: null };
      }
    }
    if (table === "product_images") {
      if (failImageRead) return { data: null, error: { message: "dummy DB error" } };
      return { data: imageRows, error: null };
    }
    if (table === "product_variants") {
      return { data: variantRows, error: null };
    }
    if (table === "banners") {
      return { data: bannerRows, error: null };
    }
    if (table === "audit_log") {
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }, storage);
  return { admin, storage, removed, wasDeleted: () => deleted };
}

function removes(storage) {
  return storage.calls.filter((call) => call.op === "remove");
}

test.beforeEach(() => {
  __setUser(STAFF);
});

test.afterEach(() => {
  __setAdminClient(null);
  __setUser(STAFF);
});

test("delete removes the product's photos and its variant photos", async () => {
  const { admin, storage } = deleteClient({
    imageRows: [
      { product_id: "prod-1", storage_path: "test-phone-aaa.jpg" },
      { product_id: "prod-1", storage_path: "test-phone-bbb.jpg" },
    ],
    variantRows: [{ product_id: "prod-1", image_path: "test-phone-variant.jpg" }],
  });
  __setAdminClient(admin);
  assert.deepEqual(await manage.deleteProduct("prod-1"), { ok: true, slug: "test-phone" });
  assert.equal(removes(storage).length, 1);
  assert.deepEqual(
    [...removes(storage)[0].args[0]].sort(),
    ["test-phone-aaa.jpg", "test-phone-bbb.jpg", "test-phone-variant.jpg"].sort(),
  );
});

test("delete skips full https URLs and resolves legacy /images/products paths to their basename", async () => {
  const { admin, storage } = deleteClient({
    imageRows: [
      { product_id: "prod-1", storage_path: "https://example.com/elsewhere.jpg" },
      { product_id: "prod-1", storage_path: "/images/products/test-phone-legacy.jpg" },
      { product_id: "prod-1", storage_path: "/other/path.jpg" },
    ],
  });
  __setAdminClient(admin);
  assert.deepEqual(await manage.deleteProduct("prod-1"), { ok: true, slug: "test-phone" });
  assert.equal(removes(storage).length, 1);
  assert.deepEqual(removes(storage)[0].args[0], ["test-phone-legacy.jpg"]);
});

test("delete keeps a file another product still references", async () => {
  const { admin, storage } = deleteClient({
    imageRows: [
      { product_id: "prod-1", storage_path: "shared-photo.jpg" },
      { product_id: "prod-1", storage_path: "own-photo.jpg" },
      { product_id: "prod-2", storage_path: "shared-photo.jpg" },
    ],
  });
  __setAdminClient(admin);
  assert.deepEqual(await manage.deleteProduct("prod-1"), { ok: true, slug: "test-phone" });
  assert.equal(removes(storage).length, 1);
  assert.deepEqual(removes(storage)[0].args[0], ["own-photo.jpg"]);
});

test("delete keeps a file a banner still references", async () => {
  const { admin, storage } = deleteClient({
    imageRows: [{ product_id: "prod-1", storage_path: "banner-lamp-abc.jpg" }],
    bannerRows: [{ image_path: "banner-lamp-abc.jpg" }],
  });
  __setAdminClient(admin);
  assert.deepEqual(await manage.deleteProduct("prod-1"), { ok: true, slug: "test-phone" });
  assert.equal(removes(storage).length, 0);
});

test("a Storage removal failure still deletes the row and returns a visible warning", async () => {
  const { admin, storage, wasDeleted } = deleteClient({
    imageRows: [
      { product_id: "prod-1", storage_path: "test-phone-aaa.jpg" },
      { product_id: "prod-1", storage_path: "test-phone-bbb.jpg" },
    ],
    failRemove: true,
  });
  __setAdminClient(admin);
  assert.deepEqual(await manage.deleteProduct("prod-1"), {
    ok: true,
    slug: "test-phone",
    warning: "Product deleted, but 2 photos could not be removed from Storage.",
  });
  assert.equal(wasDeleted(), true);
  assert.equal(removes(storage).length, 1);
});

test("a product with no photos removes nothing and warns nothing", async () => {
  const { admin, storage } = deleteClient({});
  __setAdminClient(admin);
  assert.deepEqual(await manage.deleteProduct("prod-1"), { ok: true, slug: "test-phone" });
  assert.equal(removes(storage).length, 0);
});

test("a missing product errors without touching Storage", async () => {
  const { admin, storage, wasDeleted } = deleteClient({ productExists: false });
  __setAdminClient(admin);
  assert.deepEqual(await manage.deleteProduct("prod-missing"), {
    ok: false,
    error: "Product not found.",
  });
  assert.equal(wasDeleted(), false);
  assert.equal(removes(storage).length, 0);
});

test("a non-staff caller is rejected before any delete", async () => {
  __setUser(CUSTOMER);
  const { admin, storage, wasDeleted } = deleteClient({
    imageRows: [{ product_id: "prod-1", storage_path: "test-phone-aaa.jpg" }],
  });
  __setAdminClient(admin);
  const result = await manage.deleteProduct("prod-1");
  assert.equal(result.ok, false);
  assert.equal(wasDeleted(), false);
  assert.equal(removes(storage).length, 0);
});

test("an unreadable photo-reference read still deletes the row but warns", async () => {
  const { admin, storage, wasDeleted } = deleteClient({
    imageRows: [{ product_id: "prod-1", storage_path: "test-phone-aaa.jpg" }],
    failImageRead: true,
  });
  __setAdminClient(admin);
  assert.deepEqual(await manage.deleteProduct("prod-1"), {
    ok: true,
    slug: "test-phone",
    warning: "Product deleted, but its photos could not be checked for removal from Storage.",
  });
  assert.equal(wasDeleted(), true);
  assert.equal(removes(storage).length, 0);
});
