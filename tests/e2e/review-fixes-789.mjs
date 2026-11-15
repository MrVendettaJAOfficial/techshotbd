// TechShot review-fix checks for Ponytail findings 7, 8 and 9
// (Playwright, mock Supabase, admin mode).
//
//   7. Banner orphan sweep / 100-file cap: a banner-* filename may
//      be a product photo (a product titled "Banner lamp" uploads
//      banner-lamp-*.jpg). The sweep and the cap now exclude any
//      file product_images / product_variants references. The
//      exclusion logic itself (old product-referenced file kept,
//      true orphan removed, cap counting) is pinned by
//      tests/banner-storage-quota.test.mjs; this suite proves the
//      live path: a banner upload succeeds (the cap read consults
//      the product tables without blocking it) and the sweep
//      button's run issues product_images + product_variants reads
//      in the mock log before reporting.
//   8. A failed photo/variant read fails the whole admin product
//      fetch instead of returning a product with empty extras
//      (pinned by tests/product-extras-failure.test.mjs). This
//      suite proves the live happy path end to end: Edit on the
//      iPhone populates the form with its real photos and variants,
//      so a save from that form cannot wipe them.
//   9. An empty price or stock box must not save as ৳0 / 0
//      (pinned by tests/product-form-required-fields.test.mjs).
//      This suite proves it in the browser: clearing the price
//      (then the stock) in Edit mode shows the form error and the
//      mock product row is unchanged — no save happened.
//
// Responsiveness: the admin Products and Banners tabs are checked
// for horizontal overflow at 1440 / 1280 / 390, with zero page
// JS errors.
//
// Run (see README, "End-to-end checks"):
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs > /tmp/mock-review-fixes-789.log  (port 3101)
//   Build:     NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> npm run build
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 MOCK_URL=http://127.0.0.1:3101 MOCK_LOG=/tmp/mock-review-fixes-789.log \
//                node tests/e2e/review-fixes-789.mjs
//
// Needs a Chromium: playwright-core resolvable (it is NOT a repo
// dependency) and the chromium-1148 fallback below. Exits non-zero
// when any check fails. No real money moves.

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
const MOCK_LOG = process.env.MOCK_LOG ?? "/tmp/mock-review-fixes-789.log";
const BANNER_PHOTO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "images", "products", "apple-iphone-16-pro.jpg");
const IPHONE_SLUG = "apple-iphone-16-pro-256gb-natural-titanium";
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

// --- mock log: the mock logs `METHOD path` per request ---
function mockLines() {
  try {
    return readFileSync(MOCK_LOG, "utf8").split("\n").filter((line) => line !== "");
  } catch {
    return [];
  }
}
function mockMark() {
  return mockLines().length;
}
function mockRequestsSince(mark) {
  return mockLines()
    .slice(mark)
    .filter((line) => /^(GET|POST|PATCH|PUT|DELETE|HEAD) /.test(line) && !line.includes("/__test/"));
}

// --- mock REST reads (the mock has no auth on REST) ---
async function mockGet(path) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, { headers: { apikey: "mock-anon-key" } });
  return res.json();
}

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
  return page.evaluate(
    ({ title, label }) => {
      const cards = [...document.querySelectorAll("main *")].filter((el) => el.textContent?.includes(title));
      const card = cards
        .filter((el) => el.querySelector("button"))
        .sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (!card) return false;
      const button = [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
      if (!button || button.disabled) return false;
      button.click();
      return true;
    },
    { title, label },
  );
}

async function formAlertText(page) {
  const alert = page.locator('[role="alert"]').first();
  if ((await alert.count()) === 0) return "";
  return (await alert.textContent()) ?? "";
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function main() {
  const browser = await launchBrowser();
  const pageErrors = [];
  const consoleErrors = [];
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on("pageerror", (e) => pageErrors.push(String(e.message ?? e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  try {
    await signIn(page);
    check("sign-in lands on /account", page.url().includes("/account"), page.url());

    const before = (await mockGet(`products?slug=eq.${IPHONE_SLUG}&select=id,price_poisha,stock`))?.[0];
    check("iPhone seed row exists in the mock", !!before, JSON.stringify(before));
    const originalPricePoisha = before?.price_poisha;
    const originalStock = before?.stock;

    // --- Finding 8 (live happy path): Edit populates real extras ---
    await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
    await sleep(1200);
    check("products tab lists the iPhone", (await page.evaluate(() => document.querySelector("main")?.innerText ?? "")).includes(IPHONE_TITLE));
    check("clicks Edit on the iPhone", await waitFor(() => clickProductButton(page, IPHONE_TITLE, "Edit"), 10000));
    await sleep(800);
    const photo0 = await page.evaluate(() => document.getElementById("product-photo-0")?.value ?? "");
    check("finding 8: edit form shows the real main photo (extras loaded)", photo0 !== "", photo0);
    const variantsText = await page.evaluate(() => document.getElementById("product-variants")?.value ?? "");
    check("finding 8: edit form shows the real variants (extras loaded)", variantsText.includes("Titanium"), variantsText);

    // --- Finding 9: empty price / stock are rejected, nothing saves ---
    await setInput(page, "product-price", "");
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Save changes"));
      b && b.click();
    });
    const priceRejected = await waitFor(async () => (await formAlertText(page)).includes("Enter a price"), 10000);
    check("finding 9: empty price shows the form error", priceRejected, await formAlertText(page));
    const afterPrice = (await mockGet(`products?slug=eq.${IPHONE_SLUG}&select=price_poisha,stock`))?.[0];
    check(
      "finding 9: empty price saved nothing (mock row unchanged)",
      afterPrice?.price_poisha === originalPricePoisha && afterPrice?.stock === originalStock,
      JSON.stringify(afterPrice),
    );

    // Restore a valid price, then clear stock: same rejection.
    await setInput(page, "product-price", String(Math.round(originalPricePoisha / 100)));
    await setInput(page, "product-stock", "");
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Save changes"));
      b && b.click();
    });
    const stockRejected = await waitFor(async () => (await formAlertText(page)).includes("Enter the stock quantity"), 10000);
    check("finding 9: empty stock shows the form error", stockRejected, await formAlertText(page));
    const afterStock = (await mockGet(`products?slug=eq.${IPHONE_SLUG}&select=price_poisha,stock`))?.[0];
    check(
      "finding 9: empty stock saved nothing (mock row unchanged)",
      afterStock?.price_poisha === originalPricePoisha && afterStock?.stock === originalStock,
      JSON.stringify(afterStock),
    );
    // Leave the form without saving: cancel the edit.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Cancel edit");
      b && b.click();
    });
    await sleep(500);

    // --- Finding 7 (live path): upload + sweep consult product tables ---
    await page.goto(`${BASE}/admin?tab=banners`, { waitUntil: "networkidle0" });
    await sleep(1200);
    check("banners tab renders (kind select present)", (await page.locator('[data-testid="banner-kind"]').count()) === 1);
    await page.locator('[data-testid="banner-upload-input"]').setInputFiles(BANNER_PHOTO);
    await page.locator('[data-testid="banner-upload-button"]').click();
    const uploaded = await waitFor(async () => {
      const v = await page.locator('[data-testid="banner-image-path"]').inputValue();
      return v.startsWith("banner-promotion-");
    }, 15000);
    check("finding 7: banner upload succeeds (cap read tolerates product refs)", uploaded, await page.locator('[data-testid="banner-image-path"]').inputValue());
    const mark = mockMark();
    await page.locator('[data-testid="banner-cleanup-orphans"]').click();
    const sweepReported = await waitFor(
      async () =>
        (await page.locator('[role="status"]').count()) > 0 &&
        /unused banner photos|Cleaned up/.test((await page.locator('[role="status"]').first().textContent()) ?? ""),
      15000,
    );
    check("finding 7: sweep button reports a result", sweepReported, (await page.locator('[role="status"]').first().textContent().catch(() => "")) ?? "");
    const sweepRequests = mockRequestsSince(mark);
    check(
      "finding 7: the sweep read product_images (exclusion consults products)",
      sweepRequests.some((line) => line.includes("/rest/v1/product_images")),
      JSON.stringify(sweepRequests),
    );
    check(
      "finding 7: the sweep read product_variants (exclusion consults variants)",
      sweepRequests.some((line) => line.includes("/rest/v1/product_variants")),
      JSON.stringify(sweepRequests),
    );

    // --- Responsiveness: no horizontal overflow at 1440 / 1280 / 390 ---
    for (const width of [1440, 1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tab of ["products", "banners"]) {
        await page.goto(`${BASE}/admin?tab=${tab}`, { waitUntil: "networkidle0" });
        await sleep(800);
        check(`responsive: no horizontal overflow at ${width} on ?tab=${tab}`, await noHorizontalOverflow(page));
      }
    }

    const realConsoleErrors = consoleErrors.filter((text) => !text.includes("Failed to fetch RSC payload"));
    check("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
    check("zero console errors (excluding aborted-prefetch fallbacks)", realConsoleErrors.length === 0, realConsoleErrors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
  }

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `FAILURES: ${failures.join(", ")}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

await main();
