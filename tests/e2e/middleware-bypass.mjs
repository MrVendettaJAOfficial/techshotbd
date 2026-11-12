// Middleware-bypass regression (Playwright, mock Supabase).
//
// Regression for audit run-1 finding #11
// (techshot:next-14.2.5-cve-2025-29927-middleware-bypass-admin-stats):
// on Next.js 14.2.5, an anonymous request carrying the internal
// header x-middleware-subrequest skipped middleware entirely and
// reached /admin, and the overview branch ran the ungated
// getAdminStats() service-role reads — the response's RSC flight
// payload serialized the live store totals to an anonymous caller.
// Two fixes compose here, and both are checked:
//   1. Next.js 14.2.25 validates the subrequest header, so
//      middleware runs and anonymous /admin requests redirect to
//      sign-in even with the header attached;
//   2. getAdminStats() checks the caller role itself, so even if
//      middleware were bypassed, no service-role read runs and no
//      totals are serialized for a non-staff caller.
//
// Checks (anonymous, no cookies):
//   1. GET /admin -> 307 to /auth/sign-in (control: middleware runs)
//   2. GET /admin?tab=overview WITH x-middleware-subrequest ->
//      307 to /auth/sign-in, and the response body contains no
//      stats object (no "totalProducts" / "totalOrders" keys)
//   3. GET /admin?tab=banners WITH the header -> 307, no stats
//      keys in the body (the audit saw this tab leak overview stats
//      too, because non-staff tabs fall back to overview)
//   4. Positive control: a signed-in admin (MOCK_ADMIN=1) still
//      gets HTTP 200 on /admin?tab=overview and sees the real
//      totals — the gate must not lock staff out. Expected totals
//      are read from the mock at runtime, so the check does not
//      depend on the seed size.
//
// Run (see README, "End-to-end checks"):
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 MOCK_URL=http://127.0.0.1:3101 node tests/e2e/middleware-bypass.mjs
//
// The app must be built and started from the real 14.2.25 install
// (npm install, then npm run build && npm run start): the unit
// suite only proves the role gate in lib/admin/stats.ts, while
// this file proves the patched Next.js actually runs middleware
// for a request carrying the bypass header. Exits non-zero when
// any check fails. No real money moves: test adapter only.

import { createRequire } from "node:module";

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The exact header value from the audit's reproduction: the
// middleware module path repeated to the recursion limit.
const BYPASS_HEADER = "middleware:middleware:middleware:middleware:middleware";

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

// --- mock REST reads (the mock has no auth on REST) ---
async function mockGet(path) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, { headers: { apikey: "mock-anon-key" } });
  return res.json();
}

// --- raw HTTP checks (no browser: fetch with manual redirects) ---
async function rawGet(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { headers, redirect: "manual" });
  const body = await res.text();
  return { status: res.status, location: res.headers.get("location"), body };
}

function bodyLeaksStats(body) {
  return body.includes("totalProducts") || body.includes("totalOrders");
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

async function pageText(page, selector = "main") {
  return (await page.evaluate((sel) => document.querySelector(sel)?.innerText ?? "", selector)).replace(/\s+/g, " ");
}

async function main() {
  // 1. Control: anonymous GET /admin redirects to sign-in.
  const control = await rawGet("/admin");
  check("anonymous GET /admin -> 307", control.status === 307, `status ${control.status}`);
  check(
    "anonymous GET /admin redirects to sign-in",
    (control.location ?? "").includes("/auth/sign-in"),
    `location ${control.location}`,
  );

  // 2. Bypass attempt: the header that skipped middleware on 14.2.5.
  const bypass = await rawGet("/admin?tab=overview", { "x-middleware-subrequest": BYPASS_HEADER });
  check("bypass header GET /admin?tab=overview -> 307", bypass.status === 307, `status ${bypass.status}`);
  check(
    "bypass header GET /admin?tab=overview redirects to sign-in",
    (bypass.location ?? "").includes("/auth/sign-in"),
    `location ${bypass.location}`,
  );
  check("bypass response body contains no stats object", !bodyLeaksStats(bypass.body), bypass.body.slice(0, 200));

  // 3. Same bypass on the banners tab (audit: it leaked overview stats too).
  const banners = await rawGet("/admin?tab=banners", { "x-middleware-subrequest": BYPASS_HEADER });
  check("bypass header GET /admin?tab=banners -> 307", banners.status === 307, `status ${banners.status}`);
  check(
    "bypass header GET /admin?tab=banners redirects to sign-in",
    (banners.location ?? "").includes("/auth/sign-in"),
    `location ${banners.location}`,
  );
  check("banners bypass body contains no stats object", !bodyLeaksStats(banners.body), banners.body.slice(0, 200));

  // 4. Positive control: a signed-in admin still sees the real totals.
  const products = await mockGet("products?select=id");
  const orders = await mockGet("orders?select=id,status");
  const paidPayments = await mockGet("payments?status=eq.paid&select=order_id");
  const totalProducts = Array.isArray(products) ? products.length : 0;
  const totalOrders = Array.isArray(orders) ? orders.length : 0;
  const paid = new Set((Array.isArray(paidPayments) ? paidPayments : []).map((row) => row.order_id)).size;

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await signIn(page);
    check("sign-in lands on /account", page.url().includes("/account"), page.url());
    await page.goto(`${BASE}/admin?tab=overview`, { waitUntil: "networkidle0" });
    check("signed-in admin /admin?tab=overview -> 200, not redirected", page.url().includes("/admin"), page.url());
    const overview = await pageText(page);
    check("admin overview shows Total products", overview.includes("Total products"), overview.slice(0, 200));
    check(
      `admin overview shows the real product total (${totalProducts})`,
      overview.includes(`Total products ${totalProducts}`),
      overview.slice(0, 300),
    );
    check(
      `admin overview shows the real order total (${totalOrders})`,
      overview.includes(`Total orders ${totalOrders}`),
      overview.slice(0, 300),
    );
    check(
      `admin overview shows the real paid count (${paid})`,
      overview.includes(`Paid ${paid}`),
      overview.slice(0, 300),
    );
    await page.close();
  } finally {
    await browser.close();
  }
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`\n${failures.length} check(s) failed: ${failures.join("; ")}`);
      process.exit(1);
    }
    console.log("\nAll middleware-bypass checks passed.");
  })
  .catch((error) => {
    console.error("middleware-bypass run failed:", error);
    process.exit(1);
  });
