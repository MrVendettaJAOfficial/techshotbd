// /orders lists live Supabase orders — Playwright regression check.
//
// Bug fixed 2026-11-08: /orders read orders only from the browser's
// localStorage, so on a new device/browser it showed "No orders yet"
// even though the order existed in Supabase (while /account history
// showed it). The page now merges listSupabaseOrders() over the
// browser list (see app/orders/page.tsx).
//
// What this script proves, in mock-Supabase mode (MOCK_ORDERS=1):
//   1. a signed-in user places a COD order;
//   2. a FRESH browser context (empty localStorage, no cookies) signs
//      in as the same user and opens /orders — the order MUST be
//      listed there, not "No orders yet";
//   3. /orders/<id> in that fresh context shows the order and its
//      live status.
// In fallback mode (no env vars) it proves the local path still works:
// a guest COD order is listed on /orders.
//
// Run (see README, "End-to-end checks"):
//   Fallback:  build + serve with no env vars, then
//                BASE_URL=http://127.0.0.1:3100 node tests/e2e/orders-fresh-browser.mjs
//   Mock:      node tests/e2e/mock-supabase.mjs  (port 3101)
//              build + serve pointed at the mock, then
//                BASE_URL=http://127.0.0.1:3100 MOCK_ORDERS=1 node tests/e2e/orders-fresh-browser.mjs
//
// Needs a Chromium (npx playwright install chromium once, and
// playwright-core resolvable — it is NOT a repo dependency). When the
// installed Playwright expects a newer Chromium than is downloaded,
// set CHROMIUM_PATH to an installed chrome binary. Exits non-zero
// when any check fails.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
const candidates = ["playwright-core", "playwright"];
for (const name of candidates) {
  try {
    ({ chromium } = require(name));
    break;
  } catch {
    // try next candidate
  }
}
if (!chromium) {
  try {
    ({ chromium } = require("/home/hatch/workspace/tools/playwright-mcp/node_modules/playwright-core"));
  } catch {
    console.error(
      "Playwright is not installed. Install it once:\n  npm i -D playwright-core && npx playwright install chromium",
    );
    process.exit(2);
  }
}

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const MOCK_MODE = process.env.MOCK_ORDERS === "1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(name);
}

async function text(page, selector = "main") {
  return (await page.evaluate((sel) => document.querySelector(sel)?.innerText ?? "", selector)).replace(/\s+/g, " ");
}

async function launchBrowser() {
  const opts = { args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  try {
    return await chromium.launch(opts);
  } catch (e) {
    const exe = process.env.CHROMIUM_PATH ?? "/home/hatch/.cache/ms-playwright/chromium-1148/chrome-linux/chrome";
    console.log(`Default Chromium launch failed (${String(e).slice(0, 120)}); retrying with ${exe}`);
    return await chromium.launch({ ...opts, executablePath: exe });
  }
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
  check("sign-in lands on /account", page.url().includes("/account"), page.url());
}

async function fillAddress(page) {
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const setSel = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("firstName", "Test");
    set("lastName", "User");
    set("email", "test@example.com");
    set("mobile", "01712345678");
    set("address", "House 1, Road 2");
    set("area", "Dhanmondi");
    setSel("division", "Dhaka");
    set("city", "Dhaka");
  });
  await sleep(300);
  await page.evaluate(() => {
    const sel = document.getElementById("district");
    if (sel) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      setter.call(sel, "Dhaka");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Continue to delivery"));
    b && b.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Continue to payment"));
    b && b.click();
  });
  await sleep(400);
}

async function placeCodOrder(page) {
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim().startsWith("Add to Cart"));
    btns[0] && btns[0].click();
  });
  await sleep(1200);
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[role=tab]")].find((x) => x.textContent.trim() === "Cash on Delivery");
    b && b.click();
  });
  await sleep(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Pay"));
    b && b.click();
  });
  await sleep(2500);
  check("COD goes straight to the order page (no test-pay)", /\/orders\/.+/.test(page.url()) && !page.url().includes("test-pay"), page.url());
  const orderText = await text(page);
  const match = orderText.match(/TS-\d+-\d+/);
  check("COD order page shows an order number", Boolean(match), match?.[0] ?? "");
  return { orderUrl: page.url(), orderNumber: match?.[0] ?? "" };
}

async function main() {
  const browser = await launchBrowser();

  // Route smoke: /seller must 404 (single-seller store).
  const sellerPage = await browser.newPage();
  const sellerRes = await sellerPage.goto(`${BASE}/seller`, { waitUntil: "domcontentloaded" });
  check("/seller returns 404", sellerRes.status() === 404, `status=${sellerRes.status()}`);
  await sellerPage.close();

  if (MOCK_MODE) {
    // --- Place an order as the signed-in user. ---
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.setViewportSize({ width: 1280, height: 900 });
    await signIn(pageA);
    const { orderUrl, orderNumber } = await placeCodOrder(pageA);
    const orderId = orderUrl.split("/orders/")[1]?.split("?")[0] ?? "";
    check("order url carries an id", orderId.length > 0, orderId);
    await ctxA.close();

    // --- Fresh browser profile: empty localStorage, no cookies. ---
    // This is the exact bug: it used to show "No orders yet" here.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.setViewportSize({ width: 1280, height: 900 });
    await pageB.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const localCount = await pageB.evaluate(() => window.localStorage.length);
    check("fresh profile starts with empty localStorage", localCount === 0, `keys=${localCount}`);
    await signIn(pageB);
    await pageB.goto(`${BASE}/orders`, { waitUntil: "networkidle0" });
    await sleep(2500);
    const listText = await text(pageB);
    check("fresh browser /orders lists the live order", listText.includes(orderNumber), listText.slice(0, 300));
    check("fresh browser /orders does not say 'No orders yet'", !listText.includes("No orders yet"));
    await pageB.goto(`${BASE}/orders/${orderId}`, { waitUntil: "networkidle0" });
    await sleep(2000);
    const detailText = await text(pageB);
    check("fresh browser order detail shows the order", detailText.includes(orderNumber), detailText.slice(0, 300));
    check("fresh browser order detail shows live status", /Confirmed|Processing|Shipped|Delivered/.test(detailText));
    await ctxB.close();
  } else {
    // --- Fallback mode: guest COD order is listed on /orders. ---
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    const { orderNumber } = await placeCodOrder(page);
    await page.goto(`${BASE}/orders`, { waitUntil: "networkidle0" });
    await sleep(2000);
    const listText = await text(page);
    check("fallback /orders lists the guest order", listText.includes(orderNumber), listText.slice(0, 300));
    await ctx.close();
  }

  await browser.close();
  if (failures.length > 0) {
    console.error(`\nFAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nAll /orders checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
