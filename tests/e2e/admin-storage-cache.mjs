// TechShot admin banner storage + catalogue-cache verification
// (Playwright, mock Supabase).
//
// Covers the 2026-11-12 fix for audit run-1 findings #13 and #14
// (3-MEDIUM batch):
//
//   #13 (techshot:banners:uploadBannerImage:unbounded-storage-
//   exhaustion) — banner uploads are now bounded in aggregate
//   (20 uploads per staff member per day, 100 stored banner files
//   in total) and deleting a banner reclaims its Storage file.
//   What is proven here, end to end through the admin Banners tab:
//     1. with 20 of the caller's uploads already recorded in
//        audit_log in the last 24h, the next upload is rejected
//        with the daily-limit message and no file is stored;
//     2. once those audit rows are removed, the same upload
//        succeeds — the cap counts real uploads, and lifts when
//        the count drops;
//     3. deleting the saved banner removes its Storage file: the
//        mock request log shows the DELETE /storage/v1/object/
//        product-images remove attempt for it (the mock answers
//        that endpoint 404 — it stores nothing — so the log line
//        is the proof the action tried; the row delete still
//        succeeds because the removal is best-effort).
//   #14 (techshot-cache-degraded-catalog-pinned) — the cached
//   catalogue now revalidates after 60s, and every banner write
//   purges the catalog tag too. What is proven here:
//     4. creating a banner purges the catalog tag: the next
//        /shop fetch re-reads the catalogue from the mock (the
//        fetch right after the write issues catalogue calls),
//        and the one after that reads zero (re-cached);
//     5. deleting a banner purges the catalog tag too (same
//        re-read / re-cache proof);
//     6. uploading a photo alone does NOT purge the catalog tag
//        (it is not a banner write): the /shop fetch after a
//        bare upload still issues zero catalogue calls.
//   The banner itself still takes over the home hero on save and
//   the hero falls back to product slides after the delete (the
//   same proof as tests/e2e/storefront-cache.mjs step 4, repeated
//   here because the banner is created and deleted by this suite).
//
// The manual orphan sweep (cleanupOrphanBannerPhotos) is wired
// to the "Clean up unused banner photos" button in the Banners tab
// and exercised below (a fresh orphan is too new to sweep, so the
// UI proof is the button calling the action and reporting zero
// removed); the sweep itself (removed / kept) is covered by
// tests/banner-storage-quota.test.mjs.
//
// Setup — the data cache must start COLD, or the "first visit
// fetches once" proof would be vacuous:
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs > /tmp/mock-admin-storage-cache.log  (port 3101)
//   Build:     NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> npm run build
//   Cold cache: rm -rf .next/cache/fetch-cache
//              (the pre-rendered static HTML is untouched — only the
//              data-cache entries are dropped, so the first dynamic
//              read has to fetch live once)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 MOCK_URL=http://127.0.0.1:3101 MOCK_LOG=/tmp/mock-admin-storage-cache.log \
//                node tests/e2e/admin-storage-cache.mjs
//
// The mock is left as it was found: the banner created here is
// deleted again, and the seeded audit rows (plus the one real row
// the successful uploads record) are removed at the end.
//
// Needs a Chromium: playwright-core resolvable (it is NOT a repo
// dependency) and the chromium-1148 fallback below. Exits non-zero
// when any check fails.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  try {
    ({ chromium } = require("playwright"));
  } catch {
    try {
      ({ chromium } = require("/home/hatch/workspace/tools/playwright-mcp/node_modules/playwright-core"));
    } catch {
      console.error("Playwright is not installed.");
      process.exit(2);
    }
  }
}

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const MOCK = (process.env.MOCK_URL ?? "http://127.0.0.1:3101").replace(/\/$/, "");
const MOCK_LOG = process.env.MOCK_LOG ?? "/tmp/mock-admin-storage-cache.log";
const BANNER_PHOTO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "images", "products", "apple-iphone-16-pro.jpg");
const IPHONE_TITLE = "Apple iPhone 16 Pro 256GB Natural Titanium";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(name);
}

async function launchBrowser() {
  const opts = { args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  try {
    return await chromium.launch(opts);
  } catch {
    const exe = process.env.CHROMIUM_PATH ?? "/home/hatch/.cache/ms-playwright/chromium-1148/chrome-linux/chrome";
    return await chromium.launch({ ...opts, executablePath: exe });
  }
}

async function waitFor(fn, timeoutMs = 15000, stepMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return true;
    await sleep(stepMs);
  }
  return false;
}

// --- mock log: round-trip counting ---------------------------------------
// The mock logs `METHOD path` per request. Count the lines added
// between two marks, ignoring the test-only endpoints (this script's
// own /__test/* calls) and CORS preflights.
function mockLines() {
  return readFileSync(MOCK_LOG, "utf8").split("\n").filter((line) => line !== "");
}
function mockRequestsSince(mark) {
  return mockLines()
    .slice(mark)
    .filter((line) => /^(GET|POST|PATCH|PUT|DELETE|HEAD) /.test(line) && !line.includes("/__test/"));
}
function mockMark() {
  return mockLines().length;
}
function summarize(requests) {
  const counts = {};
  for (const line of requests) {
    const path = line.replace(/^(GET|POST|PATCH|PUT|DELETE|HEAD) /, "").split("?")[0];
    counts[path] = (counts[path] ?? 0) + 1;
  }
  return counts;
}
// The catalogue reads, by URL shape: the full products select
// (select=* with the images/variants joins), the categories list,
// the reviews aggregate (select=product_id,rating), the join table
// and the banners list.
function catalogueCalls(requests) {
  return requests.filter((line) =>
    line.includes("/rest/v1/categories") ||
    (line.includes("/rest/v1/products") && line.includes("select=*")) ||
    (line.includes("/rest/v1/reviews") && line.includes("select=product_id")) ||
    line.includes("/rest/v1/product_categories") ||
    line.includes("/rest/v1/banners"),
  );
}

// --- mock REST (the mock has no auth on REST) ----------------------------
async function mockPost(path, body) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: "mock-anon-key", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`mock POST ${path} failed: ${res.status}`);
  return res.json();
}
async function mockDelete(path) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, { method: "DELETE", headers: { apikey: "mock-anon-key" } });
  if (!res.ok) throw new Error(`mock DELETE ${path} failed: ${res.status}`);
  return res.json();
}

// --- browser helpers ------------------------------------------------------
async function signIn(page) {
  await page.goto(`${BASE}/auth/sign-in`, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("email", "test@example.com");
    set("password", "password123");
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Sign in"));
    b && b.click();
  });
  await sleep(3000);
}

async function fetchHtml(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, html: await res.text() };
}

async function uploadBannerPhoto(page) {
  await page.locator('[data-testid="banner-upload-input"]').setInputFiles(BANNER_PHOTO);
  await page.locator('[data-testid="banner-upload-button"]').click();
}

async function uploadAlertText(page) {
  return page.evaluate(() => {
    const alerts = [...document.querySelectorAll('p[role="alert"]')];
    return alerts.map((el) => el.textContent ?? "").join(" ");
  });
}

const browser = await launchBrowser();
const pageErrors = [];
const consoleErrors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(String(err)));

try {
  // --- #14 setup: warm the catalogue cache, then prove it is cached ---
  // Plain document fetches FIRST, before any browser visit: signing
  // in (and the client cart pricing that runs on any browser page)
  // already warms the catalogue cache, which would make the
  // "first visit fetches" proof vacuous. Same shape as
  // tests/e2e/storefront-cache.mjs step 1.
  let mark = mockMark();
  let shop = await fetchHtml("/shop");
  let requests = mockRequestsSince(mark);
  check("shop: HTTP 200", shop.status === 200, `HTTP ${shop.status}`);
  check("shop: first visit fetches the catalogue once", catalogueCalls(requests).length > 0, `${catalogueCalls(requests).length} catalogue calls`);
  mark = mockMark();
  shop = await fetchHtml("/shop");
  requests = mockRequestsSince(mark);
  check("shop: repeat visit issues zero catalogue calls", catalogueCalls(requests).length === 0, `${catalogueCalls(requests).length} calls: ${JSON.stringify(summarize(requests))}`);

  await signIn(page);

  // --- #13: the daily cap rejects the 21st upload in 24h ---
  // Seed 20 successful uploads for the signed-in admin (user-1)
  // in audit_log, exactly as a real day of uploads would record
  // them (the app's daily count reads this table).
  const nowIso = new Date().toISOString();
  for (let i = 0; i < 20; i += 1) {
    await mockPost("audit_log", {
      actor_id: "user-1",
      action: "banner.upload",
      entity_type: "banner",
      entity_id: null,
      created_at: nowIso,
    });
  }
  await page.goto(`${BASE}/admin?tab=banners`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("admin: banners tab renders (kind select present)", (await page.locator('[data-testid="banner-kind"]').count()) === 1);
  mark = mockMark();
  await uploadBannerPhoto(page);
  const capped = await waitFor(async () => (await uploadAlertText(page)).includes("today's banner upload limit (20 photos)"), 15000);
  check("quota: 21st upload in 24h is rejected with the daily-limit message", capped, await uploadAlertText(page));
  check("quota: a rejected upload stores no file", !mockRequestsSince(mark).some((line) => line.startsWith("POST /storage/v1/object/product-images/")), JSON.stringify(summarize(mockRequestsSince(mark))));
  check("quota: the image path stays empty after a rejection", (await page.locator('[data-testid="banner-image-path"]').inputValue()) === "");

  // Remove the seeded rows: the same upload must now succeed.
  await mockDelete("audit_log?actor_id=eq.user-1&action=eq.banner.upload");
  await uploadBannerPhoto(page);
  const uploaded = await waitFor(async () => {
    const v = await page.locator('[data-testid="banner-image-path"]').inputValue();
    return v.startsWith("banner-promotion-");
  });
  const uploadedPath = await page.locator('[data-testid="banner-image-path"]').inputValue();
  check("quota: the same upload succeeds once the count drops below 20", uploaded, uploadedPath);

  // --- #14: a bare upload does NOT purge the catalog tag ---
  mark = mockMark();
  shop = await fetchHtml("/shop");
  requests = mockRequestsSince(mark);
  check("catalog: a bare photo upload does not purge the catalog tag (still zero calls)", catalogueCalls(requests).length === 0, `${catalogueCalls(requests).length} calls`);

  // --- #14 + hero: saving the banner purges the catalog tag ---
  await page.locator('[data-testid="banner-save"]').click();
  const bannerSaved = await waitFor(async () => (await page.locator('[data-testid="banner-item"]').count()) === 1, 10000);
  check("admin: banner is saved and listed", bannerSaved);
  mark = mockMark();
  shop = await fetchHtml("/shop");
  requests = mockRequestsSince(mark);
  check("catalog: the next /shop after the banner save re-reads the catalogue (tag purged)", catalogueCalls(requests).length > 0, `${catalogueCalls(requests).length} catalogue calls`);
  mark = mockMark();
  shop = await fetchHtml("/shop");
  requests = mockRequestsSince(mark);
  check("catalog: the /shop after that reads zero catalogue calls (re-cached)", catalogueCalls(requests).length === 0, `${catalogueCalls(requests).length} calls`);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await sleep(800);
  check(
    "storefront: home hero shows the new banner immediately (alt Promotion banner)",
    (await page.locator('[data-testid="hero-slide"]').first().getAttribute("data-slide-alt")) === "Promotion banner",
  );

  // --- #13 + #14: deleting the banner reclaims its Storage file and purges the catalog tag ---
  await page.goto(`${BASE}/admin?tab=banners`, { waitUntil: "networkidle0" });
  await sleep(1200);
  mark = mockMark();
  await page.locator('[data-testid="banner-delete"]').first().click();
  const bannerDeleted = await waitFor(async () => (await page.locator('[data-testid="banner-item"]').count()) === 0, 10000);
  check("admin: banner is deleted", bannerDeleted);
  requests = mockRequestsSince(mark);
  check("storage: the delete removes the banners row", requests.some((line) => line.startsWith("DELETE /rest/v1/banners")), JSON.stringify(summarize(requests)));
  check(
    "storage: the delete attempts a Storage remove for the banner file",
    requests.some((line) => line.startsWith("DELETE /storage/v1/object/product-images")),
    `no storage DELETE in ${JSON.stringify(summarize(requests))} (uploaded path was ${uploadedPath})`,
  );
  mark = mockMark();
  shop = await fetchHtml("/shop");
  requests = mockRequestsSince(mark);
  check("catalog: the next /shop after the banner delete re-reads the catalogue (tag purged)", catalogueCalls(requests).length > 0, `${catalogueCalls(requests).length} catalogue calls`);
  mark = mockMark();
  shop = await fetchHtml("/shop");
  requests = mockRequestsSince(mark);
  check("catalog: the /shop after that reads zero catalogue calls (re-cached)", catalogueCalls(requests).length === 0, `${catalogueCalls(requests).length} calls`);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await sleep(800);
  check(
    "storefront: home hero falls back to product slides after the delete",
    (await page.locator('[data-testid="hero-slide"]').first().getAttribute("data-slide-alt")) === IPHONE_TITLE,
  );

  // --- #13: the orphan-sweep button calls the action and reports ---
  // The banner deleted above already had its file removed by the
  // delete, and the bare upload earlier is too fresh to sweep
  // (the 24h rule), so the honest result here is zero removed —
  // the proof is that the button calls the action and a result
  // notice appears, not the count.
  await page.goto(`${BASE}/admin?tab=banners`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("admin: cleanup button is present", (await page.locator('[data-testid="banner-cleanup-orphans"]').count()) === 1);
  await page.locator('[data-testid="banner-cleanup-orphans"]').click();
  const sweepReported = await waitFor(
    async () =>
      (await page.locator('[role="status"]').count()) > 0 &&
      /unused banner photos|Cleaned up/.test((await page.locator('[role="status"]').first().textContent()) ?? ""),
    10000,
  );
  check(
    "admin: cleanup button reports a sweep result",
    sweepReported,
    (await page.locator('[role="status"]').first().textContent().catch(() => "")) ?? "",
  );

  // --- error budget ---
  const prefetchAborts = consoleErrors.filter((text) => text.includes("Failed to fetch RSC payload"));
  const realConsoleErrors = consoleErrors.filter((text) => !text.includes("Failed to fetch RSC payload"));
  console.log(`  note: ${prefetchAborts.length} aborted-prefetch RSC warnings (fallback navigation succeeded)`);
  check("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  check("zero console errors (excluding aborted-prefetch fallbacks)", realConsoleErrors.length === 0, realConsoleErrors.slice(0, 3).join(" | "));
} finally {
  // Leave the mock as it was found: the successful uploads recorded
  // one real audit row each — remove every banner.upload row for
  // the admin, and the banner itself was already deleted above.
  try {
    await mockDelete("audit_log?actor_id=eq.user-1&action=eq.banner.upload");
  } catch (error) {
    console.log(`  note: audit_log cleanup failed (${error instanceof Error ? error.message : error}) — the mock may hold banner.upload rows`);
  }
  await browser.close();
}

console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `FAILURES: ${failures.join(", ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
