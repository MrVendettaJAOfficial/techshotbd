// TechShot storefront data-cache verification (Playwright, mock Supabase).
//
// ONE combined run for the site-wide speed batch (2026-11-11): the
// public catalogue + active banners are cached across requests
// (Next.js data cache, tags "catalog" / "banners") and purged on
// demand by every write that changes catalogue-visible data, while
// the home page is static.
//
// What is proven here, measured against the mock's request log:
//   1. repeat visits issue ZERO catalogue queries: with a cold data
//      cache (see the setup below), the first /shop visit fetches
//      the catalogue once (4 calls) and every later visit — /shop,
//      /shop?category=audio, the product page — issues zero
//      catalogue calls. The home page issues zero calls even on
//      the first visit: it is static HTML pre-rendered at build.
//   2. an admin product edit shows on the storefront immediately:
//      changing the iPhone price in /admin lands in the mock DB,
//      and the next plain fetch of / and /shop shows the new price
//      (old price gone); the fetch right after the edit re-reads
//      the catalogue exactly once (4 calls — the tag purge working),
//      the one after that reads zero.
//   3. pause hides, activate restores: pausing the iPhone makes its
//      product page show the not-found page and drops it from /shop;
//      activating brings it back (200, product content). The price is
//      reverted afterwards, so the mock is left as it was found.
//      (Body, not status: this app renders its not-found page with
//      HTTP 200 — proven on the live pre-batch build too, so the
//      status is a pre-existing quirk, not a caching regression.)
//   4. a banner added in /admin takes over the home hero
//      immediately, and deleting it returns the hero to the product
//      fallback slides.
//   5. reviews stay live: the product page shows the two real seeded
//      reviews (average 4.5 — never the fake 4.9 / 1,248), and a
//      repeat visit to the product page still issues the live
//      reviews-list read (it is not cached with the catalogue).
//      Review WRITING is proven by tests/e2e/roles-admin-tabs.mjs
//      (a delivered order lets the signed-in owner submit a review);
//      this script proves the read side stays live after the cache
//      change.
//   6. no horizontal page overflow at 1440 / 1280 / 390, and zero
//      page errors / console errors throughout.
//
// Setup — the data cache must start COLD, or the build would have
// already warmed it and the "first visit fetches once" proof would
// be vacuous (everything would read zero from the start):
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs > /tmp/mock-storefront-cache.log  (port 3101)
//   Build:     NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> npm run build
//   Cold cache: rm -rf .next/cache/fetch-cache
//              (the pre-rendered static HTML is untouched — only the
//              data-cache entries are dropped, so the first dynamic
//              read has to fetch live once)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 MOCK_URL=http://127.0.0.1:3101 MOCK_LOG=/tmp/mock-storefront-cache.log \
//                node tests/e2e/storefront-cache.mjs
//
// Needs a Chromium: playwright-core resolvable (it is NOT a repo
// dependency) and the chromium-1148 fallback below. Exits non-zero
// when any check fails. No real money moves: test adapter only.

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
const MOCK_LOG = process.env.MOCK_LOG ?? "/tmp/mock-storefront-cache.log";
const BANNER_PHOTO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "images", "products", "apple-iphone-16-pro.jpg");
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
// and the banners list. The product page's LIVE reads use different
// shapes and are counted separately: resolveProductId (products
// select=id, twice — by id then by slug), the reviews list
// (select=id,user_id,...) and the author-name profiles read.
function catalogueCalls(requests) {
  return requests.filter((line) =>
    line.includes("/rest/v1/categories") ||
    (line.includes("/rest/v1/products") && line.includes("select=*")) ||
    (line.includes("/rest/v1/reviews") && line.includes("select=product_id")) ||
    line.includes("/rest/v1/product_categories") ||
    line.includes("/rest/v1/banners"),
  );
}
function liveProductCalls(requests) {
  return requests.filter((line) =>
    (line.includes("/rest/v1/products") && line.includes("select=id")) ||
    (line.includes("/rest/v1/reviews") && line.includes("select=id")) ||
    line.includes("/rest/v1/profiles"),
  );
}

// --- mock REST reads (the mock has no auth on REST) ---
async function mockGet(path) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, { headers: { apikey: "mock-anon-key" } });
  return res.json();
}

// --- browser helpers (same selectors as the manager / roles suites) ---
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

async function setInput(page, id, value) {
  await page.evaluate(
    ({ id, value }) => {
      const el = document.getElementById(id);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { id, value },
  );
}

async function clickProductButton(page, title, label) {
  // The button in the ROW for this product — NOT the first button
  // with that label on the tab. Two traps, both found the hard way:
  // after a save the form shows a notice `<p>"<title>" was
  // updated.</p>` whose text CONTAINS the title and which renders
  // before the list — starting the walk from it (textContent
  // .includes) climbs to the tab container and clicks the FIRST
  // row's button (in this run: YouTube Premium got paused and its
  // price edited instead of the iPhone's). The row's title <p> is
  // the one whose text STARTS with the title (the notice starts
  // with a quote, the description <p> comes later), so the search
  // starts there and the walk stops at the row itself.
  return page.evaluate(
    ({ title, label }) => {
      const titleP = [...document.querySelectorAll("p")].find((el) =>
        el.textContent?.trim().startsWith(title),
      );
      if (!titleP) return false;
      let el = titleP;
      while (el) {
        const btn = [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
        if (btn) {
          if (btn.disabled) return false;
          btn.click();
          return true;
        }
        el = el.parentElement;
      }
      return false;
    },
    { title, label },
  );
}

/**
 * True when the product's own row currently shows a button with this
 * label. The admin UI re-renders the row only after the server
 * action round-trips, so this is the signal that the action (and
 * its revalidation) has finished — polling the DB row alone can
 * fire while the action is still running, and a storefront fetch
 * in that window reads the not-yet-purged cache.
 */
async function rowHasButton(page, title, label) {
  return page.evaluate(
    ({ title, label }) => {
      const titleP = [...document.querySelectorAll("p")].find((el) =>
        el.textContent?.trim().startsWith(title),
      );
      if (!titleP) return false;
      let el = titleP;
      while (el) {
        const btns = [...el.querySelectorAll("button")];
        if (btns.length > 0) {
          return btns.some((b) => b.textContent.trim() === label);
        }
        el = el.parentElement;
      }
      return false;
    },
    { title, label },
  );
}

async function clickGalleryTab(page, label) {
  const clicked = await page.evaluate((wanted) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(wanted));
    if (!b) return false;
    b.click();
    return true;
  }, label);
  await sleep(800);
  return clicked;
}

async function saveProductForm(page) {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Save changes"));
    if (!b) return false;
    b.click();
    return true;
  });
}

async function text(page, selector = "main") {
  return (await page.evaluate((sel) => document.querySelector(sel)?.innerText ?? "", selector)).replace(/\s+/g, " ");
}

const IPHONE_SLUG = "apple-iphone-16-pro-256gb-natural-titanium";
const IPHONE_TITLE = "Apple iPhone 16 Pro 256GB Natural Titanium";
const ORIGINAL_PRICE_TAKA = 119900;
const EDITED_PRICE_TAKA = 115900;

async function productRow() {
  const rows = await mockGet(`products?slug=eq.${IPHONE_SLUG}&select=id,title,slug,price_poisha,status`);
  return rows?.[0];
}

async function fetchHtml(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, html: await res.text() };
}

const browser = await launchBrowser();
const pageErrors = [];
const consoleErrors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (err) => pageErrors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

try {
  // --- 1. repeat visits issue zero catalogue queries (cold data cache) ---
  // Plain document fetches with no cookies and no JavaScript: no Link
  // prefetch, no client auth burst — the counts are the server's own.
  let mark = mockMark();
  let home = await fetchHtml("/");
  let requests = mockRequestsSince(mark);
  console.log(`  GET / (cold cache): ${requests.length} mock requests ${JSON.stringify(summarize(requests))}`);
  check("home: HTTP 200", home.status === 200, `HTTP ${home.status}`);
  check("home: static — zero mock requests on the first visit", requests.length === 0, `${requests.length} requests`);
  check("home: shows the iPhone at the seed price", home.html.includes("1,19,900"), "seed price missing from home HTML");

  mark = mockMark();
  let shop = await fetchHtml("/shop");
  requests = mockRequestsSince(mark);
  const shopCatalogue = catalogueCalls(requests);
  console.log(`  GET /shop (1st): ${requests.length} mock requests, ${shopCatalogue.length} catalogue ${JSON.stringify(summarize(requests))}`);
  check("shop: HTTP 200", shop.status === 200, `HTTP ${shop.status}`);
  check("shop: first visit fetches the catalogue exactly once (4 calls)", shopCatalogue.length === 4, `${shopCatalogue.length} catalogue calls: ${shopCatalogue.join("; ")}`);
  check("shop: first visit makes no other mock requests", requests.length === 4, `${requests.length} total`);

  mark = mockMark();
  shop = await fetchHtml("/shop");
  requests = mockRequestsSince(mark);
  console.log(`  GET /shop (2nd): ${requests.length} mock requests ${JSON.stringify(summarize(requests))}`);
  check("shop: repeat visit issues zero catalogue queries", catalogueCalls(requests).length === 0, `${catalogueCalls(requests).length} catalogue calls`);
  check("shop: repeat visit issues zero mock requests at all", requests.length === 0, `${requests.length} requests`);

  mark = mockMark();
  const shopAudio = await fetchHtml("/shop?category=audio");
  requests = mockRequestsSince(mark);
  console.log(`  GET /shop?category=audio: ${requests.length} mock requests ${JSON.stringify(summarize(requests))}`);
  check("shop: a different filter still reads the cache (zero catalogue queries)", catalogueCalls(requests).length === 0, `${catalogueCalls(requests).length} catalogue calls`);

  mark = mockMark();
  let product = await fetchHtml(`/product/${IPHONE_SLUG}`);
  requests = mockRequestsSince(mark);
  console.log(`  GET /product (1st): ${requests.length} mock requests, ${catalogueCalls(requests).length} catalogue, ${liveProductCalls(requests).length} live ${JSON.stringify(summarize(requests))}`);
  check("product: HTTP 200", product.status === 200, `HTTP ${product.status}`);
  check("product: first visit reads the catalogue from the cache (zero catalogue queries)", catalogueCalls(requests).length === 0, `${catalogueCalls(requests).length} catalogue calls`);
  check("product: live reads still happen (resolve + reviews list + author names)", liveProductCalls(requests).length === 4, `${liveProductCalls(requests).length} live calls: ${liveProductCalls(requests).join("; ")}`);

  mark = mockMark();
  product = await fetchHtml(`/product/${IPHONE_SLUG}`);
  requests = mockRequestsSince(mark);
  console.log(`  GET /product (2nd): ${requests.length} mock requests ${JSON.stringify(summarize(requests))}`);
  check("product: repeat visit still issues zero catalogue queries", catalogueCalls(requests).length === 0, `${catalogueCalls(requests).length} catalogue calls`);
  check("product: repeat visit still reads the reviews list live", requests.some((line) => line.includes("/rest/v1/reviews") && line.includes("select=id")), requests.join("; "));

  // --- 2. an admin product edit shows on the storefront immediately ---
  await signIn(page);
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
  await sleep(1500);
  check("admin: iPhone row renders", (await text(page)).includes(IPHONE_TITLE));

  const clickedEdit = await waitFor(async () => (await clickProductButton(page, IPHONE_TITLE, "Edit")) === true);
  check("admin: Edit opens the iPhone form", clickedEdit);
  await setInput(page, "product-price", String(EDITED_PRICE_TAKA));
  check("admin: Save changes submits", await saveProductForm(page));
  const edited = await waitFor(async () => (await productRow())?.price_poisha === EDITED_PRICE_TAKA * 100);
  check("admin: price changed in the DB", edited, JSON.stringify(await productRow()));
  await sleep(1500); // let the admin refresh after the save settle

  mark = mockMark();
  shop = await fetchHtml("/shop");
  requests = mockRequestsSince(mark);
  const afterEditCatalogue = catalogueCalls(requests);
  console.log(`  GET /shop after edit: ${requests.length} mock requests, ${afterEditCatalogue.length} catalogue ${JSON.stringify(summarize(requests))}`);
  check("storefront: new price shows on /shop immediately", shop.html.includes("1,15,900"), "new price missing from /shop");
  check("storefront: old price is gone from /shop", !shop.html.includes("1,19,900"), "old price still on /shop");
  check("storefront: the edit re-read the catalogue exactly once (tag purge worked)", afterEditCatalogue.length === 4, `${afterEditCatalogue.length} catalogue calls: ${afterEditCatalogue.join("; ")}`);

  mark = mockMark();
  shop = await fetchHtml("/shop");
  requests = mockRequestsSince(mark);
  check("storefront: the visit after the re-read is back to zero catalogue queries", catalogueCalls(requests).length === 0, `${catalogueCalls(requests).length} catalogue calls`);

  home = await fetchHtml("/");
  check("storefront: new price shows on / (static home revalidated)", home.html.includes("1,15,900"), "new price missing from home HTML");
  check("storefront: old price is gone from /", !home.html.includes("1,19,900"), "old price still on home HTML");

  // --- 3. pause hides, activate restores (price reverted after) ---
  const clickedPause = await waitFor(async () => (await clickProductButton(page, IPHONE_TITLE, "Pause")) === true);
  check("admin: Pause hides the iPhone", clickedPause);
  const paused = await waitFor(async () => (await productRow())?.status === "paused");
  check("admin: product is paused in the DB", paused, JSON.stringify(await productRow()));
  // Wait for the row to flip to "Activate" — the action (and its tag
  // purge) has only finished when the UI re-renders; a fetch in
  // between the DB update and the purge reads the stale cache.
  const pauseSettled = await waitFor(async () => rowHasButton(page, IPHONE_TITLE, "Activate"));
  check("admin: row flips to Activate (action + revalidation settled)", pauseSettled);
  const pausedPage = await fetchHtml(`/product/${IPHONE_SLUG}`);
  // The paused product must be HIDDEN: the page renders the
  // not-found page (title "Product not found", "Go home", no product
  // title, no Add to Cart). The HTTP status is NOT asserted: this
  // app serves its not-found page with status 200 — a pre-existing
  // quirk, proven on the live pre-batch build (a never-existent slug
  // returns 200 with the same not-found body there too), and no
  // earlier test ever asserted a product 404 status.
  const pausedHidden =
    pausedPage.html.includes("<title>Product not found — TechShot</title>") &&
    pausedPage.html.includes("Go home") &&
    !pausedPage.html.includes(IPHONE_TITLE) &&
    !pausedPage.html.includes("Add to Cart");
  check("storefront: paused product page shows not-found (product hidden)", pausedHidden, `HTTP ${pausedPage.status}`);
  shop = await fetchHtml("/shop");
  check("storefront: paused product is gone from /shop", !shop.html.includes(IPHONE_TITLE), "paused title still on /shop");

  const clickedActivate = await waitFor(async () => (await clickProductButton(page, IPHONE_TITLE, "Activate")) === true);
  check("admin: Activate restores the iPhone", clickedActivate);
  const active = await waitFor(async () => (await productRow())?.status === "active");
  check("admin: product is active in the DB again", active, JSON.stringify(await productRow()));
  const activateSettled = await waitFor(async () => rowHasButton(page, IPHONE_TITLE, "Pause"));
  check("admin: row flips back to Pause (action + revalidation settled)", activateSettled);
  product = await fetchHtml(`/product/${IPHONE_SLUG}`);
  check("storefront: product page is back (200 + product content)", product.status === 200 && product.html.includes(IPHONE_TITLE) && product.html.includes("Add to Cart"), `HTTP ${product.status}`);

  // Revert the price, so the mock is left as it was found.
  const clickedRevert = await waitFor(async () => (await clickProductButton(page, IPHONE_TITLE, "Edit")) === true);
  check("admin: Edit re-opens for the revert", clickedRevert);
  await setInput(page, "product-price", String(ORIGINAL_PRICE_TAKA));
  check("admin: revert submits", await saveProductForm(page));
  const reverted = await waitFor(async () => (await productRow())?.price_poisha === ORIGINAL_PRICE_TAKA * 100);
  check("admin: price is back to the original in the DB", reverted, JSON.stringify(await productRow()));
  shop = await fetchHtml("/shop");
  check("storefront: original price shows on /shop again", shop.html.includes("1,19,900"), "original price missing from /shop");

  // --- 4. a banner takes over the home hero immediately, then goes away ---
  await page.goto(`${BASE}/admin?tab=banners`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("admin: banners tab renders (kind select present)", (await page.locator('[data-testid="banner-kind"]').count()) === 1);
  await page.locator('[data-testid="banner-kind"]').selectOption("offer");
  await page.locator('[data-testid="banner-upload-input"]').setInputFiles(BANNER_PHOTO);
  await page.locator('[data-testid="banner-upload-button"]').click();
  const uploaded = await waitFor(async () => {
    const v = await page.locator('[data-testid="banner-image-path"]').inputValue();
    return v.startsWith("banner-offer-");
  });
  check("admin: banner photo uploads (path starts banner-offer-)", uploaded, await page.locator('[data-testid="banner-image-path"]').inputValue());
  await page.locator('[data-testid="banner-save"]').click();
  const bannerSaved = await waitFor(async () => (await page.locator('[data-testid="banner-item"]').count()) === 1, 10000);
  check("admin: banner is saved and listed", bannerSaved);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await sleep(800);
  check(
    "storefront: home hero shows the new banner immediately (alt Offer banner)",
    (await page.locator('[data-testid="hero-slide"]').first().getAttribute("data-slide-alt")) === "Offer banner",
  );
  await page.goto(`${BASE}/admin?tab=banners`, { waitUntil: "networkidle0" });
  await sleep(1200);
  await page.locator('[data-testid="banner-delete"]').first().click();
  const bannerDeleted = await waitFor(async () => (await page.locator('[data-testid="banner-item"]').count()) === 0, 10000);
  check("admin: banner is deleted", bannerDeleted);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await sleep(800);
  check(
    "storefront: home hero falls back to product slides after the delete",
    (await page.locator('[data-testid="hero-slide"]').first().getAttribute("data-slide-alt")) === IPHONE_TITLE,
  );

  // --- 5. reviews stay live on the product page ---
  await page.goto(`${BASE}/product/${IPHONE_SLUG}`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("product page loads (iPhone)", (await text(page)).includes(IPHONE_TITLE));
  check("reviews tab clicked (iPhone)", await clickGalleryTab(page, "Reviews"));
  const iphoneReviews = await text(page);
  check("reviews show the real average 4.5", iphoneReviews.includes("4.5"), iphoneReviews.slice(0, 400));
  check("reviews show 'Based on 2 real reviews'", iphoneReviews.includes("Based on 2 real reviews"));
  check("reviews show the real reviewer names", iphoneReviews.includes("Reviewer One") && iphoneReviews.includes("Reviewer Two"));
  check("reviews show the seeded review text", iphoneReviews.includes("Excellent phone, the battery lasts all day."));
  check("reviews never show the fake seeded count", !iphoneReviews.includes("1,248") && !iphoneReviews.includes("1248"));

  // --- 6. no overflow at 1440 / 1280 / 390; zero errors ---
  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/shop", `/product/${IPHONE_SLUG}`]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
      await sleep(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${width}px: no overflow on ${path}`, overflow <= 1, `overflow ${overflow}px`);
    }
  }
  const prefetchAborts = consoleErrors.filter((text) => text.includes("Failed to fetch RSC payload"));
  const realConsoleErrors = consoleErrors.filter((text) => !text.includes("Failed to fetch RSC payload"));
  console.log(`  note: ${prefetchAborts.length} aborted-prefetch RSC warnings (fallback navigation succeeded)`);
  check("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  check("zero console errors (excluding aborted-prefetch fallbacks)", realConsoleErrors.length === 0, realConsoleErrors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `FAILURES: ${failures.join(", ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
