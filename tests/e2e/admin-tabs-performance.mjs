// TechShot admin-tabs performance verification (Playwright, mock Supabase).
//
// ONE combined run for the slow-mobile-admin-tabs fix (2026-11-11):
//   1. round trips per tab, counted from the mock log on plain
//      document loads (node fetch with the signed-in browser's
//      cookies — no JavaScript runs, so no Link prefetch or client
//      auth burst pollutes the count; this is the same method as
//      the pre-fix baseline): Banners / Messages / Orders must have
//      lost the 5 catalogue calls, and Orders must have lost the
//      duplicate profiles read.
//      Baseline (pre-fix): Overview 7, Products 9, Banners 10,
//      Orders 11, Messages 10, Users 7.
//      Expected after:     Overview 7, Products 9, Banners 5,
//      Orders 5, Messages 5, Users 7.
//   2. instant tap feedback at 390px with a 1s mock delay (the
//      slow-server case): the highlight flips and a pending spinner
//      shows within ~100ms of the tap, while the URL is still the
//      old one; the content lands only after the delay. Same check
//      at 1440px. (The waits are generous on purpose: under a
//      per-response delay every sequential server round trip costs
//      the full delay, so a Products render takes ~6s at 1s delay.)
//   3. the dead-tap re-check: something visible changes on screen
//      within ~100ms of a tap (pending spinner + highlight flip),
//      while the old tab's content stays up mid-flight.
//   4. the loading skeleton shows the tab bar on a full /admin load
//      (1s delay, checked before the content arrives).
//   5. button-mode TabBars are untouched: the Products-tab status
//      filter still flips instantly with no navigation.
//   6. no horizontal page overflow at 390px; the tab row still
//      scrolls by design.
//   7. zero page errors / console errors throughout.
//
// Run (see README, "End-to-end checks"):
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs > /tmp/mock-admin-tabs.log  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 MOCK_URL=http://127.0.0.1:3101 MOCK_LOG=/tmp/mock-admin-tabs.log \
//                node tests/e2e/admin-tabs-performance.mjs
//
// Needs a Chromium: playwright-core resolvable (it is NOT a repo
// dependency) and the chromium-1148 fallback below. Exits non-zero
// when any check fails. No real money moves: test adapter only.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

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
const MOCK_LOG = process.env.MOCK_LOG ?? "/tmp/mock-admin-tabs.log";
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
// own /__test/delay calls) and CORS preflights. Marks count
// non-empty lines: the file ends with "\n", so a naive
// split("\n").length is off by one and would drop the first line
// of every window.
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
function countPath(requests, path) {
  return requests.filter((line) => line.includes(path)).length;
}

async function setMockDelay(ms) {
  const res = await fetch(`${MOCK}/__test/delay?ms=${ms}`);
  if (!res.ok) throw new Error(`mock delay ${ms} failed: ${res.status}`);
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

async function activeTab(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[role="tablist"][aria-label="Admin sections"] [role="tab"][aria-selected="true"]');
    return el?.getAttribute("href")?.replace("/admin?tab=", "") ?? el?.textContent?.trim() ?? null;
  });
}

// Tap timing via MutationObserver: records, in ms from the click,
// when the pending spinner appears and when the highlight flips.
function tapTimingScript(href) {
  return `(() => {
    return new Promise((resolve) => {
      const tab = [...document.querySelectorAll('[role="tab"][href="${href}"]')][0];
      const t0 = performance.now();
      const events = { pendingAt: null, flipAt: null, urlAtFlip: null };
      const finish = () => {
        if (events.pendingAt !== null && events.flipAt !== null) resolve(events);
      };
      const obs = new MutationObserver(() => {
        if (events.pendingAt === null && tab.getAttribute("data-pending") === "true") {
          events.pendingAt = Math.round(performance.now() - t0);
        }
        if (events.flipAt === null && tab.getAttribute("aria-selected") === "true") {
          events.flipAt = Math.round(performance.now() - t0);
          events.urlAtFlip = window.location.search;
        }
        finish();
      });
      obs.observe(tab, { attributes: true, attributeFilter: ["aria-selected", "data-pending"] });
      tab.click();
      setTimeout(() => {
        obs.disconnect();
        resolve({ ...events, timeout: true });
      }, 5000);
    });
  })()`;
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
  await signIn(page);

  // --- 1. round trips per tab (plain document loads, baseline method) ---
  // The browser's own cookie jar, sent with a server-side fetch, so
  // the document render runs exactly as a browser load — minus the
  // JavaScript, Link prefetching and client auth burst.
  const cookies = await context.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const expected = { overview: 7, products: 9, banners: 5, orders: 5, messages: 5, users: 7 };
  for (const tab of ["overview", "products", "banners", "orders", "messages", "users"]) {
    const mark = mockMark();
    const res = await fetch(`${BASE}/admin?tab=${tab}`, { headers: { Cookie: cookieHeader } });
    const html = await res.text();
    const requests = mockRequestsSince(mark);
    const summary = summarize(requests);
    console.log(`  round trips /admin?tab=${tab}: ${requests.length} ${JSON.stringify(summary)}`);
    check(`round trips ${tab} == expected ${expected[tab]} (baseline ${tab === "banners" || tab === "orders" || tab === "messages" ? "minus 5" : "unchanged"})`, requests.length === expected[tab], `${requests.length} vs ${expected[tab]}`);
    // The server-rendered HTML is the shell's loading state (the
    // dashboard is a client component gated on useAuth, so the h1
    // only appears after hydration) — the render itself is proven
    // by the tab's data query in the mock log above.
    check(`document /admin?tab=${tab} renders the shell`, res.ok && html.includes("Loading the admin dashboard"), `HTTP ${res.status}`);
    if (tab === "banners" || tab === "orders" || tab === "messages") {
      const catalogue = requests.filter((line) =>
        /\/rest\/v1\/(products|product_images|product_variants|categories|product_categories)/.test(line),
      );
      check(`no catalogue calls on ${tab}`, catalogue.length === 0, catalogue.join("; "));
    }
    if (tab === "orders") {
      check("orders: exactly 2 profiles reads (middleware + page cache)", countPath(requests, "/rest/v1/profiles") === 2, `${countPath(requests, "/rest/v1/profiles")} profiles reads`);
      check("orders: exactly 2 getUser calls (middleware + page)", countPath(requests, "/auth/v1/user") === 2, `${countPath(requests, "/auth/v1/user")} getUser calls`);
    }
  }

  // Warm-up browser load (not measured) so the first timing test
  // does not pay for one-time client auth work.
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await sleep(1500);
  check("admin dashboard loads for the owner", (await activeTab(page)) === "overview");

  // --- 2+3. instant tap feedback with a slow server (390px mobile) ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin?tab=overview`, { waitUntil: "networkidle0" });
  await sleep(1500);
  await waitFor(async () => (await activeTab(page)) === "overview");
  // No horizontal page overflow at mobile width; the tab row itself
  // scrolls by design.
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    tablist: (() => {
      const el = document.querySelector('[role="tablist"][aria-label="Admin sections"]');
      return el ? { scroll: el.scrollWidth, client: el.clientWidth } : null;
    })(),
  }));
  check("390px: no page overflow", overflow.doc <= 391, `scrollWidth ${overflow.doc}`);
  check("390px: tab row scrolls", overflow.tablist && overflow.tablist.scroll > overflow.tablist.client, JSON.stringify(overflow.tablist));

  await setMockDelay(1000);
  const clickMark = mockMark();
  const timing = await page.evaluate(tapTimingScript("/admin?tab=products"));
  console.log(`  tap timing (390px, 1s mock delay): ${JSON.stringify(timing)}`);
  check("mobile: pending spinner shows within 100ms of the tap", typeof timing.pendingAt === "number" && timing.pendingAt <= 100, `${timing.pendingAt}ms`);
  check("mobile: highlight flips within 100ms of the tap", typeof timing.flipAt === "number" && timing.flipAt <= 100, `${timing.flipAt}ms`);
  check("mobile: highlight flips before the URL changes", timing.urlAtFlip === "?tab=overview", `url at flip: "${timing.urlAtFlip}"`);
  // Dead-tap re-check: the old content is still on screen while the
  // new tab loads (the shell stays mounted), but the tab row already
  // shows the tap — the tap visibly did something.
  await sleep(500);
  const midFlight = await page.evaluate(() => ({
    overviewStillThere: document.body.innerText.includes("Store totals"),
    productsTabPending: document.querySelector('[role="tab"][href="/admin?tab=products"]')?.getAttribute("data-pending"),
    url: window.location.search,
  }));
  check("mobile: old tab content stays visible mid-flight", midFlight.overviewStillThere, JSON.stringify(midFlight));
  check("mobile: pending spinner still showing mid-flight", midFlight.productsTabPending === "true", JSON.stringify(midFlight));
  // The new tab lands after the delay; pending clears, content swaps.
  const landed = await waitFor(async () => (await activeTab(page)) === "products" && (await page.evaluate(() => !document.querySelector('[role="tab"][href="/admin?tab=products"]')?.getAttribute("data-pending"))), 25000);
  check("mobile: products tab lands after the delay, pending clears", landed);
  const clickRequests = mockRequestsSince(clickMark);
  console.log(`  round trips for the products click (1s delay): ${clickRequests.length} ${JSON.stringify(summarize(clickRequests))}`);
  await setMockDelay(0);

  // Same tap check at desktop width.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/admin?tab=overview`, { waitUntil: "networkidle0" });
  await sleep(1500);
  await setMockDelay(1000);
  const desktopTiming = await page.evaluate(tapTimingScript("/admin?tab=orders"));
  console.log(`  tap timing (1440px, 1s mock delay): ${JSON.stringify(desktopTiming)}`);
  check("desktop: pending spinner shows within 100ms of the tap", typeof desktopTiming.pendingAt === "number" && desktopTiming.pendingAt <= 100, `${desktopTiming.pendingAt}ms`);
  check("desktop: highlight flips within 100ms of the tap", typeof desktopTiming.flipAt === "number" && desktopTiming.flipAt <= 100, `${desktopTiming.flipAt}ms`);
  const ordersLanded = await waitFor(async () => (await activeTab(page)) === "orders", 25000);
  check("desktop: orders tab lands after the delay", ordersLanded);
  await setMockDelay(0);

  // --- 4. loading skeleton on a full /admin load ---
  await setMockDelay(1000);
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "commit" });
  await sleep(300);
  const skeleton = await page.evaluate(() => {
    const main = document.querySelector('main[aria-label="Loading"]');
    if (!main) return null;
    return {
      tabs: [...main.querySelectorAll('[role="tab"]')].map((el) => el.textContent.trim()),
      hasTablist: !!main.querySelector('[role="tablist"]'),
    };
  });
  check("full load: admin skeleton renders while loading", skeleton !== null, JSON.stringify(skeleton));
  check("full load: skeleton shows the six-tab bar", skeleton !== null && skeleton.tabs.length === 6, JSON.stringify(skeleton?.tabs));
  const skeletonGone = await waitFor(async () => (await activeTab(page)) === "products", 25000);
  check("full load: products content replaces the skeleton", skeletonGone);
  await setMockDelay(0);

  // --- 5. button-mode TabBar untouched (Products status filter) ---
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const buttonTiming = await page.evaluate(() => {
    return new Promise((resolve) => {
      const list = document.querySelector('[role="tablist"][aria-label="Filter products by status"]');
      if (!list) return resolve({ noButtonTabs: true });
      const target = [...list.querySelectorAll('[role="tab"]')].find((el) => el.textContent.trim().startsWith("Paused"));
      if (!target) return resolve({ noPausedTab: true });
      const urlBefore = window.location.search;
      const t0 = performance.now();
      const obs = new MutationObserver(() => {
        if (target.getAttribute("aria-selected") === "true") {
          obs.disconnect();
          resolve({ flipAt: Math.round(performance.now() - t0), urlBefore, urlAfter: window.location.search });
        }
      });
      obs.observe(target, { attributes: true, attributeFilter: ["aria-selected"] });
      target.click();
      setTimeout(() => {
        obs.disconnect();
        resolve({ timeout: true });
      }, 3000);
    });
  });
  console.log(`  button-mode tab timing (products filter): ${JSON.stringify(buttonTiming)}`);
  check("button-mode tabs still flip instantly", typeof buttonTiming.flipAt === "number" && buttonTiming.flipAt <= 100, `${buttonTiming.flipAt}ms`);
  check("button-mode tabs do not navigate", buttonTiming.urlAfter === buttonTiming.urlBefore, `${buttonTiming.urlBefore} -> ${buttonTiming.urlAfter}`);

  // --- 6. 1280px: no overflow, tabs present ---
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const w1280 = await page.evaluate(() => document.documentElement.scrollWidth);
  check("1280px: no page overflow", w1280 <= 1281, `scrollWidth ${w1280}`);
  check("1280px: six admin tabs render", (await page.$$('[role="tablist"][aria-label="Admin sections"] [role="tab"]')).length === 6);

  // --- 7. zero page / console errors ---
  // "Failed to fetch RSC payload ... Falling back to browser
  // navigation" is Next logging a prefetch that a later navigation
  // superseded: the fallback navigation succeeds and no content is
  // lost (every content check above passed). It is not a page
  // failure, so it is counted separately from real console errors.
  const prefetchAborts = consoleErrors.filter((text) => text.includes("Failed to fetch RSC payload"));
  const realConsoleErrors = consoleErrors.filter((text) => !text.includes("Failed to fetch RSC payload"));
  console.log(`  note: ${prefetchAborts.length} aborted-prefetch RSC warnings (fallback navigation succeeded)`);
  check("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  check("zero console errors (excluding aborted-prefetch fallbacks)", realConsoleErrors.length === 0, realConsoleErrors.slice(0, 3).join(" | "));
} finally {
  await setMockDelay(0).catch(() => {});
  await browser.close();
}

console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `FAILURES: ${failures.join(", ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
