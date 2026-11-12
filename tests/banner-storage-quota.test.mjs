// Banner storage-quota tests — TechShot.
//
// Covers the 2026-11-12 fix for audit run-1 finding #13
// (techshot:banners:uploadBannerImage:unbounded-storage-exhaustion):
// any staff account could upload unlimited banner photos into the
// shared 1 GB Supabase Storage bucket, and deleting a banner never
// reclaimed its file.
//
// These tests run the REAL actions (lib/banners-server.ts) against
// a fake admin client (tests/fake-supabase.mjs) with a stub staff
// user, under the stub hook in tests/next-stub-hooks.mjs (next/cache
// + auth + Supabase factories are stubbed because plain Node cannot
// import them). The fake keeps an in-memory audit_log and banners
// table and a fake Storage bucket, so the quota and reclamation
// behaviour is exercised end to end at the action level —
// including the real sharp crop of the uploaded photo (a 1x1 PNG
// fixture passes through unchanged, per
// lib/banners/process-banner-image.ts).
//
// What is proven here:
//   - uploadBannerImage succeeds below both caps, stores the file,
//     and records the upload in audit_log (action "banner.upload");
//   - the daily cap rejects the 21st upload in 24h for the same
//     staff member, counts only that member's uploads, counts
//     only uploads inside the 24h window, and is fail-closed when
//     the count cannot be verified;
//   - the total cap rejects an upload when 100 banner files are
//     already stored, and lets one through at 99;
//   - a failed audit record removes the uploaded file again and
//     fails the upload, so no upload is invisible to the quota;
//   - deleteBanner removes the banner's Storage file when it is a
//     bare "banner-*" filename and no other banner references it,
//     keeps the file when another banner references it, never
//     touches legacy "/images/..." paths, and errors on a missing
//     banner instead of a silent success;
//   - cleanupOrphanBannerPhotos removes only unreferenced banner
//     files older than 24h, keeps fresh orphans, referenced files
//     and files with no timestamp, and refuses non-staff callers.
//
// What is NOT proven here: the caps against real Supabase (the
// mock in tests/e2e covers the live-shaped flow instead — see
// tests/e2e/admin-storage-cache.mjs). No new table is used: the
// daily count reads the existing audit_log table (migration 0001:
// actor_id + action + created_at), so no migration was written.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./next-stub-hooks.mjs", import.meta.url);

import { __setAdminClient } from "./stubs/supabase-server-stub.mjs";
import { __setUser } from "./stubs/auth-server-stub.mjs";
import { revalidateTagCalls } from "./stubs/next-cache.mjs";
import { makeFakeAdmin, makeFakeStorage, stepArgs, stepOp } from "./fake-supabase.mjs";

const banners = await import("../lib/banners-server.ts");

// The banner writes check isAdminConfigured() — the Supabase env
// vars must be present (dummy values: the stubbed factory never
// reads them, and the fake client never touches the network).
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:3101";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";

const STAFF = { id: "staff-1", email: "staff@techshot.test", displayName: "Staff Owner", role: "admin" };
const CUSTOMER = { id: "cust-1", email: "cust@techshot.test", displayName: "Customer", role: "customer" };

// 1x1 transparent PNG: smaller than the 1600x640 banner size in
// both dimensions, so processBannerImage stores it unchanged.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function bannerForm(kind = "promotion") {
  const form = new FormData();
  form.set("kind", kind);
  form.set("banner", new File([TINY_PNG], "banner.png", { type: "image/png" }));
  return form;
}

const NOW = Date.now();
const isoMinutesAgo = (minutes) => new Date(NOW - minutes * 60 * 1000).toISOString();
const isoHoursAgo = (hours) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

/** An audit_log row for one successful banner upload. */
function uploadRow(actorId, createdAt) {
  return { id: `audit-${actorId}-${createdAt}`, actor_id: actorId, action: "banner.upload", entity_type: "banner", entity_id: null, created_at: createdAt };
}

/** A Storage file object as Storage list returns it. */
function storageFile(name, createdAt) {
  return { name, id: `file-${name}`, created_at: createdAt, updated_at: createdAt, metadata: {} };
}

/**
 * A fake admin client with an in-memory audit_log + banners table
 * and a fake Storage bucket. `auditRows` / `bannerRows` seed the
 * tables; `storageFiles` seed the bucket listing. `failAuditSelect`
 * / `failAuditInsert` make the audit queries fail. The select
 * handler applies the caller's eq / neq filters, created_at
 * ordering and limit, like PostgREST would.
 */
function bannerClient({ auditRows = [], bannerRows = [], storageFiles = [], failAuditSelect = false, failAuditInsert = false } = {}) {
  const audit = [...auditRows];
  const bannerTable = [...bannerRows];
  const storage = makeFakeStorage({
    list: async () => ({ data: [...storageFiles], error: null }),
  });
  const applyFilters = (rows, steps) => {
    let out = [...rows];
    for (const [, [col, value]] of steps.filter(([method]) => method === "eq")) {
      out = out.filter((row) => row[col] === value);
    }
    for (const [, [col, value]] of steps.filter(([method]) => method === "neq")) {
      out = out.filter((row) => row[col] !== value);
    }
    return out;
  };
  const admin = makeFakeAdmin((table, steps) => {
    const op = stepOp(steps);
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
    if (table === "banners") {
      if (op === "select") {
        const rows = applyFilters(bannerTable, steps);
        const limit = stepArgs(steps, "limit")[0];
        if (steps.some(([method]) => method === "maybeSingle")) {
          return { data: rows[0] ?? null, error: null };
        }
        if (steps.some(([method]) => method === "single")) {
          return { data: rows[0] ?? null, error: null };
        }
        return { data: typeof limit === "number" ? rows.slice(0, limit) : rows, error: null };
      }
      if (op === "insert") {
        const row = stepArgs(steps, "insert")[0];
        const full = {
          id: "banner-new",
          image_path: row.image_path,
          kind: row.kind,
          headline: row.headline,
          subcopy: "",
          cta_label: "",
          cta_href: "/shop",
          sort_order: row.sort_order,
          active: row.active,
          created_at: new Date().toISOString(),
        };
        bannerTable.push(full);
        return { data: full, error: null };
      }
      if (op === "update") {
        const row = stepArgs(steps, "update")[0];
        const target = bannerTable[0] ?? {
          id: "banner-1",
          image_path: "banner-promotion-old.png",
          kind: "promotion",
          headline: "Promotion banner",
          subcopy: "",
          cta_label: "",
          cta_href: "/shop",
          sort_order: 0,
          active: true,
          created_at: isoHoursAgo(2),
        };
        const full = { ...target, ...row };
        if (steps.some(([method]) => method === "single")) return { data: full, error: null };
        return { data: null, error: null };
      }
      if (op === "delete") {
        const id = stepArgs(steps, "eq")[1];
        const index = bannerTable.findIndex((row) => row.id === id);
        if (index >= 0) bannerTable.splice(index, 1);
        return { data: null, error: null };
      }
    }
    return { data: null, error: null };
  }, storage);
  return { admin, storage, audit, bannerTable };
}

function storageCalls(storage, op) {
  return storage.calls.filter((call) => call.op === op);
}

test.beforeEach(() => {
  __setUser(STAFF);
  revalidateTagCalls.length = 0;
});

test.afterEach(() => {
  __setAdminClient(null);
  __setUser(STAFF);
});

// ---------------------------------------------------------------------------
// uploadBannerImage: the happy path + the two caps
// ---------------------------------------------------------------------------

test("upload succeeds below both caps, stores the file and records it in audit_log", async () => {
  const { admin, storage, audit } = bannerClient();
  __setAdminClient(admin);
  const result = await banners.uploadBannerImage(bannerForm());
  assert.equal(result.ok, true);
  assert.match(result.file, /^banner-promotion-[0-9a-z]+-[0-9a-z]+\.png$/);
  assert.equal(storageCalls(storage, "upload").length, 1);
  assert.equal(storageCalls(storage, "upload")[0].args[0], result.file);
  // The upload is recorded, so tomorrow's daily count sees it.
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_id, "staff-1");
  assert.equal(audit[0].action, "banner.upload");
});

test("upload is rejected at the daily cap: 20 uploads in 24h is enough", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => uploadRow("staff-1", isoMinutesAgo(i + 1)));
  const { admin, storage } = bannerClient({ auditRows: rows });
  __setAdminClient(admin);
  const result = await banners.uploadBannerImage(bannerForm());
  assert.equal(result.ok, false);
  assert.match(result.error, /today's banner upload limit \(20 photos\)/);
  assert.equal(storageCalls(storage, "upload").length, 0);
});

test("upload is allowed at 19 uploads in 24h", async () => {
  const rows = Array.from({ length: 19 }, (_, i) => uploadRow("staff-1", isoMinutesAgo(i + 1)));
  const { admin } = bannerClient({ auditRows: rows });
  __setAdminClient(admin);
  const result = await banners.uploadBannerImage(bannerForm());
  assert.equal(result.ok, true);
});

test("uploads older than 24h do not count towards the daily cap", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => uploadRow("staff-1", isoHoursAgo(25 + i)));
  const { admin } = bannerClient({ auditRows: rows });
  __setAdminClient(admin);
  assert.equal((await banners.uploadBannerImage(bannerForm())).ok, true);
});

test("another staff member's uploads do not count towards the caller's daily cap", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => uploadRow("staff-2", isoMinutesAgo(i + 1)));
  const { admin } = bannerClient({ auditRows: rows });
  __setAdminClient(admin);
  assert.equal((await banners.uploadBannerImage(bannerForm())).ok, true);
});

test("upload is rejected when the daily count cannot be verified (fail closed)", async () => {
  const { admin, storage } = bannerClient({ failAuditSelect: true });
  __setAdminClient(admin);
  const result = await banners.uploadBannerImage(bannerForm());
  assert.deepEqual(result, { ok: false, error: "Something went wrong. Please try again." });
  assert.equal(storageCalls(storage, "upload").length, 0);
});

test("upload is rejected at the total cap: 100 stored banner files is enough", async () => {
  const files = Array.from({ length: 100 }, (_, i) => storageFile(`banner-promotion-old-${i}.png`, isoHoursAgo(30)));
  const { admin, storage } = bannerClient({ storageFiles: files });
  __setAdminClient(admin);
  const result = await banners.uploadBannerImage(bannerForm());
  assert.equal(result.ok, false);
  assert.match(result.error, /photo store is full \(100 photos\)/);
  assert.equal(storageCalls(storage, "upload").length, 0);
});

test("upload is allowed at 99 stored banner files", async () => {
  const files = Array.from({ length: 99 }, (_, i) => storageFile(`banner-promotion-old-${i}.png`, isoHoursAgo(30)));
  const { admin } = bannerClient({ storageFiles: files });
  __setAdminClient(admin);
  assert.equal((await banners.uploadBannerImage(bannerForm())).ok, true);
});

test("a failed Storage list does not block the upload (daily cap is the hard bound)", async () => {
  const storage = makeFakeStorage({
    list: async () => ({ data: null, error: { message: "dummy storage error" } }),
  });
  const { admin } = bannerClient({});
  admin.storage = storage;
  __setAdminClient(admin);
  assert.equal((await banners.uploadBannerImage(bannerForm())).ok, true);
});

test("a failed audit record removes the uploaded file and fails the upload", async () => {
  const { admin, storage } = bannerClient({ failAuditInsert: true });
  __setAdminClient(admin);
  const result = await banners.uploadBannerImage(bannerForm());
  assert.equal(result.ok, false);
  const uploads = storageCalls(storage, "upload");
  const removes = storageCalls(storage, "remove");
  assert.equal(uploads.length, 1);
  assert.equal(removes.length, 1);
  assert.deepEqual(removes[0].args[0], [uploads[0].args[0]]);
});

test("upload is rejected for a non-staff caller", async () => {
  __setUser(CUSTOMER);
  const { admin, storage } = bannerClient({});
  __setAdminClient(admin);
  const result = await banners.uploadBannerImage(bannerForm());
  assert.equal(result.ok, false);
  assert.match(result.error, /Only store staff/);
  assert.equal(storageCalls(storage, "upload").length, 0);
});

// ---------------------------------------------------------------------------
// deleteBanner: the Storage file is reclaimed with the row
// ---------------------------------------------------------------------------

function bannerRow(id, imagePath) {
  return {
    id,
    image_path: imagePath,
    kind: "promotion",
    headline: "Promotion banner",
    subcopy: "",
    cta_label: "",
    cta_href: "/shop",
    sort_order: 0,
    active: true,
    created_at: isoHoursAgo(2),
  };
}

test("deleteBanner removes the banner's Storage file when nothing else references it", async () => {
  const { admin, storage, bannerTable } = bannerClient({
    bannerRows: [bannerRow("banner-1", "banner-promotion-abc.png")],
  });
  __setAdminClient(admin);
  assert.deepEqual(await banners.deleteBanner("banner-1"), { ok: true });
  assert.equal(bannerTable.length, 0);
  const removes = storageCalls(storage, "remove");
  assert.equal(removes.length, 1);
  assert.deepEqual(removes[0].args[0], ["banner-promotion-abc.png"]);
});

test("deleteBanner keeps the file when another banner still references it", async () => {
  const { admin, storage } = bannerClient({
    bannerRows: [bannerRow("banner-1", "banner-promotion-abc.png"), bannerRow("banner-2", "banner-promotion-abc.png")],
  });
  __setAdminClient(admin);
  assert.deepEqual(await banners.deleteBanner("banner-1"), { ok: true });
  assert.equal(storageCalls(storage, "remove").length, 0);
});

test("deleteBanner never touches a legacy /images path", async () => {
  const { admin, storage } = bannerClient({
    bannerRows: [bannerRow("banner-1", "/images/products/legacy.jpg")],
  });
  __setAdminClient(admin);
  assert.deepEqual(await banners.deleteBanner("banner-1"), { ok: true });
  assert.equal(storageCalls(storage, "remove").length, 0);
});

test("deleteBanner errors on a missing banner instead of a silent success", async () => {
  const { admin, storage } = bannerClient({ bannerRows: [] });
  __setAdminClient(admin);
  assert.deepEqual(await banners.deleteBanner("banner-missing"), {
    ok: false,
    error: "Something went wrong. Please try again.",
  });
  assert.equal(storageCalls(storage, "remove").length, 0);
});

// ---------------------------------------------------------------------------
// cleanupOrphanBannerPhotos: the manual sweep
// ---------------------------------------------------------------------------

test("sweep removes only old unreferenced banner files", async () => {
  const { admin, storage } = bannerClient({
    bannerRows: [bannerRow("banner-1", "banner-promotion-kept.png")],
    storageFiles: [
      storageFile("banner-promotion-old-orphan.png", isoHoursAgo(30)),
      storageFile("banner-promotion-fresh-orphan.png", isoMinutesAgo(10)),
      storageFile("banner-promotion-kept.png", isoHoursAgo(30)),
      storageFile("product-photo.jpg", isoHoursAgo(30)),
      { name: "banner-promotion-no-date.png", id: "file-x", created_at: null, updated_at: null, metadata: {} },
    ],
  });
  __setAdminClient(admin);
  const result = await banners.cleanupOrphanBannerPhotos();
  assert.deepEqual(result, { ok: true, removed: 1, kept: 3 });
  const removes = storageCalls(storage, "remove");
  assert.equal(removes.length, 1);
  assert.deepEqual(removes[0].args[0], ["banner-promotion-old-orphan.png"]);
});

test("sweep reports zero removals when nothing is orphaned", async () => {
  const { admin, storage } = bannerClient({
    bannerRows: [bannerRow("banner-1", "banner-promotion-kept.png")],
    storageFiles: [storageFile("banner-promotion-kept.png", isoHoursAgo(30))],
  });
  __setAdminClient(admin);
  assert.deepEqual(await banners.cleanupOrphanBannerPhotos(), { ok: true, removed: 0, kept: 1 });
  assert.equal(storageCalls(storage, "remove").length, 0);
});

test("sweep refuses a non-staff caller", async () => {
  __setUser(CUSTOMER);
  const { admin, storage } = bannerClient({});
  __setAdminClient(admin);
  const result = await banners.cleanupOrphanBannerPhotos();
  assert.equal(result.ok, false);
  assert.match(result.error, /Only store staff/);
  assert.equal(storageCalls(storage, "list").length, 0);
});

// ---------------------------------------------------------------------------
// Banner writes purge the catalog tag too (finding #14b, via the
// recorded revalidateTag calls — the stub next/cache records them)
// ---------------------------------------------------------------------------

test("createBanner, updateBanner, setBannerActive and deleteBanner purge both tags", async () => {
  const { admin } = bannerClient({ bannerRows: [bannerRow("banner-1", "banner-promotion-abc.png")] });
  __setAdminClient(admin);

  const created = await banners.createBanner({ imagePath: "banner-promotion-new.png", kind: "promotion", sortOrder: 0, active: true });
  assert.equal(created.ok, true);
  assert.deepEqual(revalidateTagCalls, ["banners", "catalog"]);
  revalidateTagCalls.length = 0;

  const updated = await banners.updateBanner("banner-1", { imagePath: "banner-promotion-abc.png", kind: "promotion", sortOrder: 0, active: true });
  assert.equal(updated.ok, true);
  assert.deepEqual(revalidateTagCalls, ["banners", "catalog"]);
  revalidateTagCalls.length = 0;

  assert.deepEqual(await banners.setBannerActive("banner-1", false), { ok: true });
  assert.deepEqual(revalidateTagCalls, ["banners", "catalog"]);
  revalidateTagCalls.length = 0;

  assert.deepEqual(await banners.deleteBanner("banner-1"), { ok: true });
  assert.deepEqual(revalidateTagCalls, ["banners", "catalog"]);
});
