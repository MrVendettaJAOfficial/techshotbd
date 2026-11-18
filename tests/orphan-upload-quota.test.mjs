// Orphan product-upload quota tests — TechShot.
//
// Covers audit run-1 NV 14
// (techshot:upload-orphan-files-no-quota-bucket-exhaustion):
// product photo uploads had only per-call caps (10 files, 5 MB
// each) and no aggregate bound, and files uploaded without saving
// the product were never deleted — one staff account could fill
// the shared 1 GB Supabase Storage bucket. uploadProductImages
// now mirrors the banner caps in lib/banners-server.ts (audit
// run-1, finding #13): at most 50 product photos per staff member
// per day (counted from audit_log, action "product.upload") and
// at most 500 stored product files in total (via Storage list),
// and cleanupOrphanProductPhotos sweeps unreferenced product
// files older than 24h.
//
// These tests run the REAL actions
// (lib/products/actions/upload.ts) against a fake admin client
// (tests/fake-supabase.mjs) with a stub staff user, under the
// stub hook in tests/next-stub-hooks.mjs. What is proven here:
//   - upload succeeds below both caps, stores the files, and
//     records one audit row per photo;
//   - the daily cap counts photos, not calls (49 prior + 2 new is
//     over 50; 48 prior + 2 new is exactly 50), counts only the
//     caller's uploads inside 24h, and is fail-closed when the
//     count cannot be verified;
//   - the total cap rejects at 500 stored product files and lets
//     one through at 499; banner-* files do not count (unless a
//     product references one), and a failed Storage list does not
//     block the upload (the daily cap is the hard bound);
//   - a failed audit record removes the uploaded files again and
//     fails the upload, so no upload is invisible to the quota;
//   - the sweep removes only old unreferenced product files,
//     keeps fresh orphans, referenced files (exact and legacy
//     basename), banner-referenced files and files with no
//     timestamp, never touches banner-* files (the banner sweep's
//     job), and refuses non-staff callers.
//
// What is NOT proven here: the caps against real Supabase. The
// live-shaped flow (seeded audit rows reject an upload, removing
// them lets it through) is in tests/e2e/lows-products-catalog.mjs.
// No new table is used: the daily count reads the existing
// audit_log table, so no migration was written.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./next-stub-hooks.mjs", import.meta.url);

import { __setAdminClient } from "./stubs/supabase-server-stub.mjs";
import { __setUser } from "./stubs/auth-server-stub.mjs";
import { makeFakeAdmin, makeFakeStorage, stepArgs, stepOp } from "./fake-supabase.mjs";

const upload = await import("../lib/products/actions/upload.ts");

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:3101";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";

const STAFF = { id: "staff-1", email: "staff@techshot.test", displayName: "Staff Owner", role: "admin" };
const CUSTOMER = { id: "cust-1", email: "cust@techshot.test", displayName: "Customer", role: "customer" };

// 1x1 transparent PNG: smaller than the 1200x1200 product size in
// both dimensions, so processProductImage re-encodes it at its own
// size, never upscaled.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function uploadForm(title = "Test Phone", count = 1) {
  const form = new FormData();
  form.set("title", title);
  for (let i = 0; i < count; i += 1) {
    form.append("photos", new File([TINY_PNG], `photo-${i}.png`, { type: "image/png" }));
  }
  return form;
}

const NOW = Date.now();
const isoMinutesAgo = (minutes) => new Date(NOW - minutes * 60 * 1000).toISOString();
const isoHoursAgo = (hours) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

/** An audit_log row for one successful product photo upload. */
function uploadRow(actorId, createdAt) {
  return { id: `audit-${actorId}-${createdAt}`, actor_id: actorId, action: "product.upload", entity_type: "product", entity_id: null, created_at: createdAt };
}

/** A Storage file object as Storage list returns it. */
function storageFile(name, createdAt) {
  return { name, id: `file-${name}`, created_at: createdAt, updated_at: createdAt, metadata: {} };
}

function uploadClient({
  auditRows = [],
  storageFiles = [],
  failAuditSelect = false,
  failAuditInsert = false,
  failList = false,
  productImagePaths = [],
  variantImagePaths = [],
  failProductRefs = false,
  bannerRows = [],
} = {}) {
  const audit = [...auditRows];
  const storage = makeFakeStorage({
    list: async () => {
      if (failList) return { data: null, error: { message: "dummy storage error" } };
      return { data: [...storageFiles], error: null };
    },
  });
  const applyFilters = (rows, steps) => {
    let out = [...rows];
    for (const [, [col, value]] of steps.filter(([method]) => method === "eq")) {
      out = out.filter((row) => row[col] === value);
    }
    return out;
  };
  const admin = makeFakeAdmin((table, steps) => {
    const op = stepOp(steps);
    if (table === "product_images" || table === "product_variants") {
      if (failProductRefs) return { data: null, error: { message: "dummy DB error" } };
      if (table === "product_images") {
        return { data: productImagePaths.map((storage_path) => ({ storage_path })), error: null };
      }
      return { data: variantImagePaths.map((image_path) => ({ image_path })), error: null };
    }
    if (table === "banners") {
      return { data: bannerRows, error: null };
    }
    if (table === "audit_log") {
      if (op === "select") {
        if (failAuditSelect) return { data: null, error: { message: "dummy DB error" } };
        let rows = applyFilters(audit, steps);
        rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
        const limit = stepArgs(steps, "limit")[0];
        if (typeof limit === "number") rows = rows.slice(0, limit);
        return { data: rows, error: null };
      }
      if (op === "insert") {
        if (failAuditInsert) return { data: null, error: { message: "dummy DB error" } };
        const row = stepArgs(steps, "insert")[0];
        audit.push({ ...row, id: `audit-new-${audit.length + 1}`, created_at: new Date().toISOString() });
        return { data: null, error: null };
      }
    }
    return { data: null, error: null };
  }, storage);
  return { admin, storage, audit };
}

function storageCalls(storage, op) {
  return storage.calls.filter((call) => call.op === op);
}

test.beforeEach(() => {
  __setUser(STAFF);
});

test.afterEach(() => {
  __setAdminClient(null);
  __setUser(STAFF);
});

// ---------------------------------------------------------------------------
// uploadProductImages: the happy path + the two caps
// ---------------------------------------------------------------------------

test("upload succeeds below both caps, stores the files and records one audit row per photo", async () => {
  const { admin, storage, audit } = uploadClient();
  __setAdminClient(admin);
  const result = await upload.uploadProductImages(uploadForm("Test Phone", 2));
  assert.equal(result.ok, true);
  assert.equal(result.files.length, 2);
  for (const file of result.files) {
    assert.match(file, /^test-phone-[0-9a-z]+-[0-9a-z]+\.png$/);
  }
  assert.equal(storageCalls(storage, "upload").length, 2);
  // One audit row per photo, so the daily count counts photos.
  assert.equal(audit.length, 2);
  assert.ok(audit.every((row) => row.actor_id === "staff-1" && row.action === "product.upload"));
});

test("upload is rejected at the daily cap: 49 prior + 2 new is over 50 photos", async () => {
  const rows = Array.from({ length: 49 }, (_, i) => uploadRow("staff-1", isoMinutesAgo(i + 1)));
  const { admin, storage } = uploadClient({ auditRows: rows });
  __setAdminClient(admin);
  const result = await upload.uploadProductImages(uploadForm("Test Phone", 2));
  assert.equal(result.ok, false);
  assert.match(result.error, /today's product photo upload limit \(50 photos\)/);
  assert.equal(storageCalls(storage, "upload").length, 0);
});

test("upload is allowed at exactly 50 photos in 24h: 48 prior + 2 new", async () => {
  const rows = Array.from({ length: 48 }, (_, i) => uploadRow("staff-1", isoMinutesAgo(i + 1)));
  const { admin } = uploadClient({ auditRows: rows });
  __setAdminClient(admin);
  assert.equal((await upload.uploadProductImages(uploadForm("Test Phone", 2))).ok, true);
});

test("uploads older than 24h do not count towards the daily cap", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => uploadRow("staff-1", isoHoursAgo(25 + i)));
  const { admin } = uploadClient({ auditRows: rows });
  __setAdminClient(admin);
  assert.equal((await upload.uploadProductImages(uploadForm("Test Phone", 1))).ok, true);
});

test("another staff member's uploads do not count towards the caller's daily cap", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => uploadRow("staff-2", isoMinutesAgo(i + 1)));
  const { admin } = uploadClient({ auditRows: rows });
  __setAdminClient(admin);
  assert.equal((await upload.uploadProductImages(uploadForm("Test Phone", 1))).ok, true);
});

test("upload is rejected when the daily count cannot be verified (fail closed)", async () => {
  const { admin, storage } = uploadClient({ failAuditSelect: true });
  __setAdminClient(admin);
  const result = await upload.uploadProductImages(uploadForm());
  assert.deepEqual(result, { ok: false, error: "Something went wrong. Please try again." });
  assert.equal(storageCalls(storage, "upload").length, 0);
});

test("upload is rejected at the total cap: 500 stored product files is enough", async () => {
  const files = Array.from({ length: 500 }, (_, i) => storageFile(`product-old-${i}.png`, isoHoursAgo(30)));
  const { admin, storage } = uploadClient({ storageFiles: files });
  __setAdminClient(admin);
  const result = await upload.uploadProductImages(uploadForm());
  assert.equal(result.ok, false);
  assert.match(result.error, /product photo store is full \(500 photos\)/);
  assert.equal(storageCalls(storage, "upload").length, 0);
});

test("upload is allowed at 499 stored product files", async () => {
  const files = Array.from({ length: 499 }, (_, i) => storageFile(`product-old-${i}.png`, isoHoursAgo(30)));
  const { admin } = uploadClient({ storageFiles: files });
  __setAdminClient(admin);
  assert.equal((await upload.uploadProductImages(uploadForm())).ok, true);
});

test("banner files do not count towards the product total cap", async () => {
  const files = Array.from({ length: 500 }, (_, i) => storageFile(`banner-promotion-old-${i}.png`, isoHoursAgo(30)));
  const { admin } = uploadClient({ storageFiles: files });
  __setAdminClient(admin);
  assert.equal((await upload.uploadProductImages(uploadForm())).ok, true);
});

test("a banner-* file a product references DOES count towards the product total cap", async () => {
  const files = [
    ...Array.from({ length: 499 }, (_, i) => storageFile(`product-old-${i}.png`, isoHoursAgo(30))),
    storageFile("banner-lamp-old-0.jpg", isoHoursAgo(30)),
  ];
  const { admin, storage } = uploadClient({
    storageFiles: files,
    productImagePaths: ["banner-lamp-old-0.jpg"],
  });
  __setAdminClient(admin);
  // 499 plain product files + the banner-* file a product
  // references = 500 product files, so the store is full.
  const result = await upload.uploadProductImages(uploadForm());
  assert.equal(result.ok, false);
  assert.match(result.error, /product photo store is full \(500 photos\)/);
  assert.equal(storageCalls(storage, "upload").length, 0);
});

test("a failed Storage list does not block the upload (daily cap is the hard bound)", async () => {
  const { admin } = uploadClient({ failList: true });
  __setAdminClient(admin);
  assert.equal((await upload.uploadProductImages(uploadForm())).ok, true);
});

test("a failed audit record removes the uploaded files and fails the upload", async () => {
  const { admin, storage } = uploadClient({ failAuditInsert: true });
  __setAdminClient(admin);
  const result = await upload.uploadProductImages(uploadForm("Test Phone", 2));
  assert.equal(result.ok, false);
  assert.equal(storageCalls(storage, "upload").length, 2);
  const removes = storageCalls(storage, "remove");
  assert.equal(removes.length, 1);
  assert.deepEqual(
    [...removes[0].args[0]].sort(),
    storageCalls(storage, "upload").map((call) => call.args[0]).sort(),
  );
});

test("upload is rejected for a non-staff caller", async () => {
  __setUser(CUSTOMER);
  const { admin, storage } = uploadClient({});
  __setAdminClient(admin);
  const result = await upload.uploadProductImages(uploadForm());
  assert.equal(result.ok, false);
  assert.match(result.error, /You do not have permission/);
  assert.equal(storageCalls(storage, "upload").length, 0);
});

// ---------------------------------------------------------------------------
// cleanupOrphanProductPhotos: the manual sweep
// ---------------------------------------------------------------------------

test("sweep removes only old unreferenced product files", async () => {
  const { admin, storage } = uploadClient({
    storageFiles: [
      storageFile("prod-old-orphan.png", isoHoursAgo(30)),
      storageFile("prod-fresh-orphan.png", isoMinutesAgo(10)),
      storageFile("prod-kept.png", isoHoursAgo(30)),
      storageFile("banner-promotion-old.png", isoHoursAgo(30)),
      { name: "prod-no-date.png", id: "file-x", created_at: null, updated_at: null, metadata: {} },
    ],
    productImagePaths: ["prod-kept.png"],
  });
  __setAdminClient(admin);
  const result = await upload.cleanupOrphanProductPhotos();
  assert.deepEqual(result, { ok: true, removed: 1, kept: 3 });
  const removes = storageCalls(storage, "remove");
  assert.equal(removes.length, 1);
  assert.deepEqual(removes[0].args[0], ["prod-old-orphan.png"]);
});

test("sweep reports zero removals when nothing is orphaned", async () => {
  const { admin, storage } = uploadClient({
    storageFiles: [storageFile("prod-kept.png", isoHoursAgo(30))],
    productImagePaths: ["prod-kept.png"],
  });
  __setAdminClient(admin);
  assert.deepEqual(await upload.cleanupOrphanProductPhotos(), { ok: true, removed: 0, kept: 1 });
  assert.equal(storageCalls(storage, "remove").length, 0);
});

test("sweep keeps a file referenced by a variant photo stored as a legacy path", async () => {
  const { admin, storage } = uploadClient({
    storageFiles: [storageFile("prod-variant.jpg", isoHoursAgo(30))],
    variantImagePaths: ["/images/products/prod-variant.jpg"],
  });
  __setAdminClient(admin);
  assert.deepEqual(await upload.cleanupOrphanProductPhotos(), { ok: true, removed: 0, kept: 1 });
  assert.equal(storageCalls(storage, "remove").length, 0);
});

test("sweep keeps a file a banner still references", async () => {
  const { admin, storage } = uploadClient({
    storageFiles: [storageFile("prod-shared.jpg", isoHoursAgo(30))],
    bannerRows: [{ image_path: "prod-shared.jpg" }],
  });
  __setAdminClient(admin);
  assert.deepEqual(await upload.cleanupOrphanProductPhotos(), { ok: true, removed: 0, kept: 1 });
  assert.equal(storageCalls(storage, "remove").length, 0);
});

test("sweep fails and removes nothing when the product-reference read fails", async () => {
  const { admin, storage } = uploadClient({
    storageFiles: [storageFile("prod-old-orphan.png", isoHoursAgo(30))],
    failProductRefs: true,
  });
  __setAdminClient(admin);
  const result = await upload.cleanupOrphanProductPhotos();
  assert.deepEqual(result, { ok: false, error: "Something went wrong. Please try again." });
  assert.equal(storageCalls(storage, "remove").length, 0);
});

test("sweep refuses a non-staff caller", async () => {
  __setUser(CUSTOMER);
  const { admin, storage } = uploadClient({});
  __setAdminClient(admin);
  const result = await upload.cleanupOrphanProductPhotos();
  assert.equal(result.ok, false);
  assert.match(result.error, /You do not have permission/);
  assert.equal(storageCalls(storage, "list").length, 0);
});
