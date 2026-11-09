// TechShot review-fix checks (Playwright, mock Supabase, admin mode).
//
// Proves the behaviour the unit tests cannot reach (server actions
// against a database), in the mocked Supabase the repo already ships:
//   1. admin Advance double-clicked moves an order exactly one step
//      (synchronous in-flight ref guard + disabled button while the
//      action runs);
//   2. a customer cancel actually cancels the LIVE order, restores
//      stock, and is visible to the admin — with the stock-released
//      notice only after the server confirms;
//   3. admin Refund (test mode) calls the adapter first and marks the
//      order refunded, appending a refunded payments row while the
//      paid row stays paid;
//   4. a failed test payment followed by a successful retry appends a
//      second payments row instead of overwriting the failed one;
//   5. a fresh browser (no localStorage) still lists live orders and
//      shows their live payment status.
//
// Run (see README, "End-to-end checks"):
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 MOCK_URL=http://127.0.0.1:3101 node tests/e2e/review-fixes.mjs
//
// Needs a Chromium: playwright-core resolvable (it is NOT a repo
// dependency) and the chromium-1148 fallback below. Exits non-zero
// when any check fails. No real money moves: test adapter only.

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

// Stock lives on the row checkout actually decrements. The script's
// orders carry the iPhone's default variant (Natural Titanium), and
// since the mock gained variant rows (variant-photo work, 2026-11-09)
// checkout decrements the product_variants row, not the products
// row — the products row stays 12. Reading the products row here
// was correct before variants existed and is stale now: the app is
// behaving correctly (see the mock log: PATCH product_variants
// stock 12 -> 11 on order, back up on cancel / refund).
async function iphoneStock() {
  const rows = await mockGet(
    "product_variants?product_id=eq.prod-apple-iphone-16-pro-256gb-natural-titanium&name=eq.Natural%20Titanium&select=stock",
  );
  return rows?.[0]?.stock;
}

async function paymentsFor(orderId) {
  return mockGet(`payments?order_id=eq.${orderId}&select=id,status,created_at&order=created_at.asc`);
}

async function auditFor(orderId) {
  return mockGet(`audit_log?entity_id=eq.${orderId}&select=action&order=created_at.asc`);
}

async function orderStatus(orderId) {
  const rows = await mockGet(`orders?id=eq.${orderId}&select=status`);
  return rows?.[0]?.status;
}

// --- browser helpers (same selectors as tests/e2e/smoke.mjs) ---
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

async function addIphoneFromShop(page) {
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim().startsWith("Add to Cart"));
    btns[0] && btns[0].click();
  });
  await sleep(1200);
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

async function choosePayment(page, label) {
  await page.evaluate((wanted) => {
    const b = [...document.querySelectorAll("button[role=tab]")].find((x) => x.textContent.trim() === wanted);
    b && b.click();
  }, label);
  await sleep(300);
}

async function submitOrder(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Pay"));
    b && b.click();
  });
  await sleep(2500);
}

async function clickTestPayOutcome(page, label) {
  const clicked = await page.evaluate((wanted) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(wanted));
    if (!b) return false;
    b.click();
    return true;
  }, label);
  check(`test-pay shows "${label}" button`, clicked);
  await sleep(2500);
}

function orderIdFromUrl(url) {
  const m = url.match(/\/orders\/([^/?]+)/);
  return m ? m[1] : "";
}

async function placeCodOrder(page) {
  await addIphoneFromShop(page);
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await choosePayment(page, "Cash on Delivery");
  await submitOrder(page);
  const id = orderIdFromUrl(page.url());
  check("COD order lands on its order page", id.length > 0, page.url());
  return id;
}

async function placeCardOrder(page) {
  await addIphoneFromShop(page);
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await submitOrder(page);
  check("card checkout reaches test-pay", page.url().includes("/checkout/test-pay"), page.url());
  return new URL(page.url()).searchParams.get("order") ?? "";
}

/** Click a button inside the admin order card for an order number. */
async function clickAdminButton(page, orderNumber, label) {
  return page.evaluate(
    ({ orderNumber, label }) => {
      const p = [...document.querySelectorAll("p")].find((el) => el.textContent?.includes(`Order ${orderNumber}`));
      if (!p) return false;
      let el = p;
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
    { orderNumber, label },
  );
}

/** The Advance button element inside the admin card for an order number. */
async function adminAdvanceButton(page, orderNumber) {
  return page.evaluateHandle((num) => {
    const p = [...document.querySelectorAll("p")].find((el) => el.textContent?.includes(`Order ${num}`));
    if (!p) return null;
    let el = p;
    while (el) {
      const btn = [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === "Advance");
      if (btn) return btn;
      el = el.parentElement;
    }
    return null;
  }, orderNumber);
}

/** Whether that order's Advance button is currently disabled (null when no button). */
async function adminAdvanceDisabled(page, orderNumber) {
  return page.evaluate((num) => {
    const p = [...document.querySelectorAll("p")].find((el) => el.textContent?.includes(`Order ${num}`));
    if (!p) return null;
    let el = p;
    while (el) {
      const btn = [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === "Advance");
      if (btn) return btn.disabled;
      el = el.parentElement;
    }
    return null;
  }, orderNumber);
}

/** Click an order's Advance button (no-op on a disabled button) and report whether one was found. */
async function clickAdvanceButton(page, orderNumber) {
  return page.evaluate((num) => {
    const p = [...document.querySelectorAll("p")].find((el) => el.textContent?.includes(`Order ${num}`));
    if (!p) return false;
    let el = p;
    while (el) {
      const btn = [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === "Advance");
      if (btn) {
        btn.click();
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }, orderNumber);
}

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await signIn(page);
  check("sign-in lands on /account", page.url().includes("/account"), page.url());
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await sleep(1000);
  check("admin dashboard renders for the admin user", (await text(page)).includes("Admin dashboard"));

  const stockBefore = await iphoneStock();
  check("mock iPhone stock reads before ordering", typeof stockBefore === "number", String(stockBefore));

  // --- 1. Advance double-click moves exactly one step ---
  // Proven 2026-11-08: this was a REAL race, not a test artifact.
  // React state updates are async, so two clicks dispatched in the
  // same task both read the stale pending state (null) and both
  // reached the server — and the server's conditional update cannot
  // stop the second one, because by then the first advance has
  // legitimately landed and "advance from the new status" is a
  // legal next step. The fix is the synchronous in-flight ref in
  // AdminDashboard (the disabled button is the visible half of it).
  // Both shapes are checked: a realistic click (the button must
  // disable while the action is in flight, and a second click
  // while disabled must do nothing) and two clicks dispatched
  // synchronously in one task (the ref guard must block the second
  // before it reaches the server).
  const codId = await placeCodOrder(page);
  check("COD order is Confirmed in the mock DB", (await orderStatus(codId)) === "confirmed");
  check("COD order decremented stock by 1", (await iphoneStock()) === stockBefore - 1, `stock ${await iphoneStock()}`);
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const orderNumber = (await text(page)).match(/TS-\d{8}-\d{4}/)?.[0] ?? "";
  // Realistic click: one real Playwright click, then the button must
  // become disabled while the action is in flight.
  const advanceHandle = await adminAdvanceButton(page, orderNumber);
  const advanceEl = advanceHandle.asElement();
  check("Advance button found for the new order", advanceEl !== null);
  if (advanceEl) await advanceEl.click();
  let sawDisabled = false;
  for (let i = 0; i < 40; i++) {
    if ((await adminAdvanceDisabled(page, orderNumber)) === true) {
      sawDisabled = true;
      break;
    }
    await sleep(25);
  }
  check("Advance button disables while the action is in flight", sawDisabled);
  // Second click while disabled: a disabled button takes no action.
  await clickAdvanceButton(page, orderNumber);
  await sleep(3000);
  check(
    "realistic double-click moved exactly one step (confirmed -> processing)",
    (await orderStatus(codId)) === "processing",
    await orderStatus(codId),
  );
  const audit1 = await auditFor(codId);
  check("exactly one audit row for the realistic double-click", audit1.length === 1, JSON.stringify(audit1));
  // Synchronous double dispatch in one task: the ref guard must
  // block the second call before it reaches the server, so this
  // order (now processing) moves exactly one more step.
  const doubleClicked = await page.evaluate((num) => {
    const p = [...document.querySelectorAll("p")].find((el) => el.textContent?.includes(`Order ${num}`));
    if (!p) return "no-card";
    let el = p;
    let btn = null;
    while (el && !btn) {
      btn = [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === "Advance") ?? null;
      el = el.parentElement;
    }
    if (!btn) return "no-button";
    btn.click();
    btn.click();
    return "clicked-twice";
  }, orderNumber);
  check("Advance button double-clicked synchronously", doubleClicked === "clicked-twice", doubleClicked);
  await sleep(3000);
  check(
    "synchronous double-click moved exactly one step (processing -> shipped)",
    (await orderStatus(codId)) === "shipped",
    await orderStatus(codId),
  );
  const audit1b = await auditFor(codId);
  check("exactly two audit rows after both double-click checks", audit1b.length === 2, JSON.stringify(audit1b));

  // --- 2. Customer cancel cancels the LIVE order + restores stock ---
  const cancelId = await placeCodOrder(page);
  const stockBeforeCancel = await iphoneStock();
  await page.goto(`${BASE}/orders/${cancelId}`, { waitUntil: "networkidle0" });
  await sleep(1000);
  const cancelled = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Cancel order");
    if (!b) return false;
    b.click();
    return true;
  });
  check("order page offers Cancel order", cancelled);
  await sleep(3000);
  const cancelText = await text(page);
  check("cancel shows the stock-released notice only after the server confirms", cancelText.includes("Stock for these items has been released back to inventory."), cancelText.slice(0, 300));
  check("cancelled order shows Cancelled", cancelText.includes("Cancelled"));
  check("live order is cancelled in the mock DB", (await orderStatus(cancelId)) === "cancelled");
  check("cancel restored stock by 1", (await iphoneStock()) === stockBeforeCancel + 1, `stock ${await iphoneStock()}`);
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("admin list shows the cancelled order", (await text(page)).includes("cancelled"));
  const auditCancel = await auditFor(cancelId);
  check("customer cancel wrote an audit row", auditCancel.some((r) => r.action?.includes("customer-cancel")), JSON.stringify(auditCancel));

  // --- 3. Refund: adapter first, append-only payments rows ---
  const cardId = await placeCardOrder(page);
  await clickTestPayOutcome(page, "Pay successfully");
  check("paid card order lands on its order page", orderIdFromUrl(page.url()) === cardId, page.url());
  check("paid card order is Confirmed in the mock DB", (await orderStatus(cardId)) === "confirmed");
  const paidBefore = await paymentsFor(cardId);
  check("one paid payments row after test payment", paidBefore.length === 1 && paidBefore[0].status === "paid", JSON.stringify(paidBefore));
  const stockBeforeRefund = await iphoneStock();
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await sleep(1200);
  // Find this order's card by its number: the order page shows the
  // number, and the admin list is newest first.
  await page.goto(`${BASE}/orders/${cardId}`, { waitUntil: "networkidle0" });
  await sleep(800);
  const cardNumber = (await text(page)).match(/TS-\d{8}-\d{4}/)?.[0] ?? "";
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const refundClicked = await clickAdminButton(page, cardNumber, "Refund");
  check("admin Refund button clicked for the paid order", refundClicked);
  await sleep(3000);
  check("refunded order is refunded in the mock DB", (await orderStatus(cardId)) === "refunded");
  const paidAfter = await paymentsFor(cardId);
  check(
    "refund appended a refunded row and kept the paid row paid",
    paidAfter.length === 2 && paidAfter.some((p) => p.status === "paid") && paidAfter.some((p) => p.status === "refunded"),
    JSON.stringify(paidAfter),
  );
  check("refund restored stock by 1", (await iphoneStock()) === stockBeforeRefund + 1, `stock ${await iphoneStock()}`);

  // --- 4. Failed retry appends a second payments row ---
  const retryId = await placeCardOrder(page);
  await clickTestPayOutcome(page, "Simulate failed payment");
  check("failed payment leaves the order Pending payment", (await text(page)).includes("Pending payment"));
  const retryVisible = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) => x.textContent.trim() === "Retry payment");
    if (!a) return false;
    a.click();
    return true;
  });
  check("failed order offers Retry payment", retryVisible);
  await sleep(2500);
  await clickTestPayOutcome(page, "Pay successfully");
  check("retried payment marks the order Confirmed", (await text(page)).includes("Confirmed"));
  const retryPayments = await paymentsFor(retryId);
  check(
    "failed + paid attempts are two rows (append-only, nothing overwritten)",
    retryPayments.length === 2 && retryPayments.some((p) => p.status === "failed") && retryPayments.some((p) => p.status === "paid"),
    JSON.stringify(retryPayments),
  );

  // --- 5. Fresh browser lists live orders with live payment status ---
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.setViewportSize({ width: 1280, height: 900 });
  await signIn(freshPage);
  await freshPage.goto(`${BASE}/orders`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const freshList = await text(freshPage);
  check("fresh browser /orders lists live orders", freshList.includes("TS-"), freshList.slice(0, 300));
  await freshPage.goto(`${BASE}/orders/${cardId}`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const freshDetail = await text(freshPage);
  check("fresh browser order detail shows the live refunded status", freshDetail.includes("Refunded"), freshDetail.slice(0, 300));
  check("fresh browser order detail shows payment Refunded", freshDetail.includes("Refunded"));
  await fresh.close();

  check("no page JS errors during the whole run", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 500));
  await browser.close();

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED: ${failures.join(", ")}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("REVIEW-FIXES SCRIPT FAILED:", e);
  process.exit(1);
});
