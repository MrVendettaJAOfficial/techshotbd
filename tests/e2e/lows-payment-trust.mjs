// Lows payment-trust — Playwright regression check for the
// TechShot lows batch, group B (audit run-1, 2026-11-18).
//
// What this script proves, in mock-Supabase mode (mock on :3121
// with MOCK_ROLE=admin, app on :3120, both with the mock env vars
// from the README, TEST_PAYMENT_SIGNING_SECRET set):
//
//   (1) LOW 4 — forged ?payment=success: opening
//       /orders/<id>?payment=success for an unpaid order changes
//       nothing — no success notice, no Paid status, the browser
//       copy stays pending_payment/unpaid, the retry link stays,
//       and the database gains no paid row. Signed-in and guest.
//   (1b) LOW 4 — positive control: a real signed-in test-pay
//       success still lands on the order page showing Paid with
//       the server-confirmed success notice.
//   (2) LOW 3 — callback illegal outcomes: a signed "failed"
//       callback for a confirmed/paid order returns 400 and the
//       database stays confirmed with exactly its paid row; a
//       signed "paid" callback for a cancelled order returns 400
//       and the order stays cancelled with no paid row; a signed
//       "paid" callback for a COD order returns 400 with no paid
//       row; a duplicate signed "paid" callback for an
//       already-paid order returns 200 and appends no second paid
//       row; a signed "failed" callback for a still-pending order
//       returns 200 (the legal same-status move).
//   (3) LOW 5 — forged local order: a delivered + paid browser
//       copy with no server record renders labelled "Unverified
//       copy" with "Paid (unverified)", at 1440 / 1280 / 390 with
//       no horizontal overflow; and a totals-inconsistent forged
//       copy is dropped from the orders list entirely.
//   (4) LOW 6 + LOW 11 — refund reporting and race: an admin
//       refund lands exactly one "refunded" payments row and the
//       order refunded; a second refund attempt adds no second
//       row; two admin browsers refunding the same paid order at
//       once produce exactly one refunded row and one refunded
//       order (the loser refunds nothing).
//
// Run (see README, "End-to-end checks"):
//   MOCK_SUPABASE_PORT=3121 MOCK_ROLE=admin node tests/e2e/mock-supabase.mjs  (port 3121)
//   build + serve pointed at the mock with the mock env vars and
//   TEST_PAYMENT_SIGNING_SECRET=mock-signing-secret, then:
//     BASE_URL=http://127.0.0.1:3120 MOCK_URL=http://127.0.0.1:3121 \
//       TEST_PAYMENT_SIGNING_SECRET=mock-signing-secret \
//       node tests/e2e/lows-payment-trust.mjs
//
// Needs a Chromium (npx playwright install chromium once, and
// playwright-core resolvable — it is NOT a repo dependency). When
// the installed Playwright expects a newer Chromium than is
// downloaded, set CHROMIUM_PATH to an installed chrome binary.
// Exits non-zero when any check fails.

import { createRequire } from "node:module";
import { createHmac, randomBytes } from "node:crypto";

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

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3120").replace(/\/$/, "");
const MOCK = (process.env.MOCK_URL ?? "http://127.0.0.1:3121").replace(/\/$/, "");
const SECRET = process.env.TEST_PAYMENT_SIGNING_SECRET ?? "";
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

// --- Mock REST reads (the mock's DB state, not the browser copy) ---

async function mockGet(path) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, {
    headers: {
      apikey: "mock-anon-key",
      Authorization: "Bearer mock-service-key",
      Accept: "application/json",
    },
  });
  return res.json();
}

async function mockOrder(id) {
  const rows = await mockGet(`orders?id=eq.${id}&select=id,status,user_id`);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function mockPaymentStatuses(id) {
  const rows = await mockGet(`payments?order_id=eq.${id}&select=status`);
  return Array.isArray(rows) ? rows.map((r) => r.status) : [];
}

async function setMockDelay(ms) {
  await fetch(`${MOCK}/__test/delay?ms=${ms}`).catch(() => {});
}

// --- Signed callbacks (each POST mints a fresh nonce: the app
// server's in-process nonce store rejects a reused nonce, so a
// re-POST with the same nonce would 400 for the wrong reason). ---

function signedCallback(orderId, status) {
  const timestamp = Date.now();
  const nonce = randomBytes(8).toString("hex");
  const signature = createHmac("sha256", SECRET)
    .update(`${orderId}:${status}:${timestamp}:${nonce}`)
    .digest("hex");
  return { orderId, status, timestamp, nonce, signature };
}

async function postCallback(body) {
  const res = await fetch(`${BASE}/api/payments/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

// --- Browser helpers (same shapes as tests/e2e/test-pay-security.mjs) ---

async function signIn(page, email = "test@example.com") {
  await page.goto(`${BASE}/auth/sign-in`, { waitUntil: "networkidle0" });
  await page.evaluate((addr) => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("email", addr);
    set("password", "password123");
  }, email);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Sign in"));
    b && b.click();
  });
  await sleep(3000);
  check(`sign-in as ${email} lands on /account`, page.url().includes("/account"), page.url());
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

async function addIphoneFromShop(page) {
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim().startsWith("Add to Cart"));
    btns[0] && btns[0].click();
  });
  await sleep(1200);
}

async function choosePayment(page, label) {
  await page.evaluate((wanted) => {
    const b = [...document.querySelectorAll("button[role=tab]")].find(
      (x) => x.textContent.trim() === wanted,
    );
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
  return clicked;
}

function orderIdFromUrl(url) {
  const m = url.match(/\/orders\/([^/?]+)/);
  return m ? m[1] : "";
}

/** Place a card order; returns the test-pay URL the checkout lands on. */
async function placeCardOrder(page) {
  await addIphoneFromShop(page);
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await submitOrder(page);
  check("card checkout lands on the test-pay page", page.url().includes("/checkout/test-pay"), page.url());
  return page.url();
}

/** Place a COD order; returns the order id from the order page URL. */
async function placeCodOrder(page) {
  await addIphoneFromShop(page);
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await choosePayment(page, "Cash on Delivery");
  await submitOrder(page);
  const id = orderIdFromUrl(page.url());
  check("COD goes straight to the order page (no test-pay)", id.length > 0 && !page.url().includes("test-pay"), page.url());
  return id;
}

function orderNumberFromText(t) {
  return t.match(/TS-\d{8}-\d{4}/)?.[0] ?? "";
}

async function adminOrderNumber(page, orderId) {
  await page.goto(`${BASE}/orders/${orderId}`, { waitUntil: "networkidle0" });
  await sleep(800);
  return orderNumberFromText(await text(page));
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

/** Whether the admin card for an order number currently shows a button. */
async function adminHasButton(page, orderNumber, label) {
  return page.evaluate(
    ({ orderNumber, label }) => {
      const p = [...document.querySelectorAll("p")].find((el) => el.textContent?.includes(`Order ${orderNumber}`));
      if (!p) return false;
      let el = p;
      while (el) {
        if ([...el.querySelectorAll("button")].some((b) => b.textContent.trim() === label)) return true;
        el = el.parentElement;
      }
      return false;
    },
    { orderNumber, label },
  );
}

async function waitFor(fn, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(500);
  }
  return false;
}

/** The browser copy of one order, or null. */
async function browserOrder(page, id) {
  return page.evaluate((wanted) => {
    try {
      const raw = window.localStorage.getItem("techshot:orders");
      const list = raw ? JSON.parse(raw) : [];
      return list.find((o) => o.id === wanted) ?? null;
    } catch {
      return null;
    }
  }, id);
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function main() {
  if (!SECRET) {
    console.error("TEST_PAYMENT_SIGNING_SECRET is required for the signed-callback probes.");
    process.exit(2);
  }
  const browser = await launchBrowser();

  // --- (1b) Positive control: a real signed-in test-pay success
  // still shows as paid, with the server-confirmed notice. ---
  const ctxOwner = await browser.newContext();
  const page = await ctxOwner.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const paidTestPayUrl = await placeCardOrder(page);
  const paidId = new URL(paidTestPayUrl).searchParams.get("order") ?? "";
  check("paid control has an order id", paidId.length > 0, paidTestPayUrl);
  await clickTestPayOutcome(page, "Pay successfully (test)");
  check("paid control lands on the order page", page.url().includes(`/orders/${paidId}`), page.url());
  await sleep(1500);
  const paidText = await text(page);
  check("paid control: order page shows the order as paid", /Payment status: Paid/.test(paidText), paidText.slice(0, 300));
  check("paid control: server-confirmed success notice shows", paidText.includes("Test payment successful. Your order is confirmed."), paidText.slice(0, 300));
  check("paid control: test-pay redirect carries no query parameter", !page.url().includes("?"), page.url());
  let db = await mockOrder(paidId);
  check("paid control: DB order is confirmed", db?.status === "confirmed", JSON.stringify(db));
  check("paid control: DB has a paid payments row", (await mockPaymentStatuses(paidId)).includes("paid"));

  // --- (1) LOW 4, signed-in: forged ?payment=success changes nothing. ---
  const forgeTestPayUrl = await placeCardOrder(page);
  const forgeId = new URL(forgeTestPayUrl).searchParams.get("order") ?? "";
  check("forge setup has an order id", forgeId.length > 0, forgeTestPayUrl);
  // Do NOT pay: navigate straight to the forged URL.
  await page.goto(`${BASE}/orders/${forgeId}?payment=success`, { waitUntil: "networkidle0" });
  await sleep(2000);
  const forgeText = await text(page);
  check("forge signed-in: no success notice", !forgeText.includes("Test payment successful"), forgeText.slice(0, 300));
  check("forge signed-in: payment status is not Paid", !/Payment status: Paid/.test(forgeText), forgeText.slice(0, 300));
  check("forge signed-in: order still shows Pending payment", /Pending payment/.test(forgeText), forgeText.slice(0, 300));
  check("forge signed-in: retry payment is still offered", forgeText.includes("Retry payment"), forgeText.slice(0, 300));
  check("forge signed-in: the query parameter sits inert in the URL", page.url().includes("?payment=success"), page.url());
  const forgeBrowser = await browserOrder(page, forgeId);
  check("forge signed-in: browser copy stays pending_payment/unpaid", forgeBrowser?.status === "pending_payment" && forgeBrowser?.paymentStatus === "unpaid", JSON.stringify(forgeBrowser));
  db = await mockOrder(forgeId);
  check("forge signed-in: DB order stays pending_payment", db?.status === "pending_payment", JSON.stringify(db));
  check("forge signed-in: DB gains no paid row", !(await mockPaymentStatuses(forgeId)).includes("paid"));
  await page.goto(`${BASE}/orders/${forgeId}?payment=failed`, { waitUntil: "networkidle0" });
  await sleep(1500);
  check("forge signed-in: ?payment=failed also changes nothing", (await browserOrder(page, forgeId))?.paymentStatus === "unpaid");
  await page.goto(`${BASE}/orders/${forgeId}?payment=cancelled`, { waitUntil: "networkidle0" });
  await sleep(1500);
  check("forge signed-in: ?payment=cancelled also changes nothing", (await browserOrder(page, forgeId))?.status === "pending_payment");

  // --- (1) LOW 4, guest: the same forgery in the guest's browser. ---
  const ctxGuest = await browser.newContext();
  const pageG = await ctxGuest.newPage();
  await pageG.setViewportSize({ width: 1280, height: 900 });
  const guestTestPayUrl = await placeCardOrder(pageG);
  const guestId = new URL(guestTestPayUrl).searchParams.get("order") ?? "";
  check("forge guest has an order id", guestId.length > 0, guestTestPayUrl);
  await pageG.goto(`${BASE}/orders/${guestId}?payment=success`, { waitUntil: "networkidle0" });
  await sleep(2000);
  const guestForgeText = await text(pageG);
  check("forge guest: no success notice", !guestForgeText.includes("Test payment successful"), guestForgeText.slice(0, 300));
  check("forge guest: payment status is not Paid", !/Payment status: Paid/.test(guestForgeText), guestForgeText.slice(0, 300));
  const guestForgeBrowser = await browserOrder(pageG, guestId);
  check("forge guest: browser copy stays pending_payment/unpaid", guestForgeBrowser?.status === "pending_payment" && guestForgeBrowser?.paymentStatus === "unpaid", JSON.stringify(guestForgeBrowser));
  db = await mockOrder(guestId);
  check("forge guest: DB order stays pending_payment", db?.status === "pending_payment", JSON.stringify(db));
  await ctxGuest.close();

  // --- (1) LOW 4, guest legitimate pay: a real guest payment MUST
  // show as paid. The ?payment= removal first broke this: the
  // signed-in status read returns null for guests, so the copy
  // stayed pending_payment/unpaid with a Retry button even though
  // the DB row was confirmed + paid (the two older suites only
  // checked whole-text /Paid/ and the timeline's "Confirmed" step
  // label, so they passed while the display was wrong). The
  // buyerToken fallback (getGuestOrderStatusFromServer) adopts the
  // server's paid state for the proven guest. These checks are
  // precise on purpose: the exact payment line, and the absence of
  // the Retry link.
  const ctxGuestPay = await browser.newContext();
  const pageGP = await ctxGuestPay.newPage();
  await pageGP.setViewportSize({ width: 1280, height: 900 });
  const guestPayUrl = await placeCardOrder(pageGP);
  const guestPayId = new URL(guestPayUrl).searchParams.get("order") ?? "";
  check("guest pay setup has an order id", guestPayId.length > 0, guestPayUrl);
  await clickTestPayOutcome(pageGP, "Pay successfully");
  check("guest pay lands on the order page", pageGP.url().includes(`/orders/${guestPayId}`), pageGP.url());
  await waitFor(async () => /Payment status: Paid/.test(await text(pageGP)));
  const guestPayText = await text(pageGP);
  const guestPayBrowser = await browserOrder(pageGP, guestPayId);
  check("guest pay: order page shows the order as paid", /Payment status: Paid/.test(guestPayText), guestPayText.slice(0, 300));
  check("guest pay: no Retry payment link is offered", !guestPayText.includes("Retry payment"), guestPayText.slice(0, 300));
  check("guest pay: success notice shows", guestPayText.includes("Test payment successful"), guestPayText.slice(0, 300));
  check("guest pay: browser copy is confirmed/paid", guestPayBrowser?.status === "confirmed" && guestPayBrowser?.paymentStatus === "paid", JSON.stringify(guestPayBrowser));
  db = await mockOrder(guestPayId);
  check("guest pay: DB order is confirmed", db?.status === "confirmed", JSON.stringify(db));
  check("guest pay: DB has a paid payments row", (await mockPaymentStatuses(guestPayId)).includes("paid"));
  await ctxGuestPay.close();

  // --- (1) LOW 4, guest legitimate fail: a real guest failure
  // shows the failed notice and keeps the Retry link. Same
  // fallback: the server's failed payment is adopted into the
  // guest copy, and the notice is derived from the copy's own
  // failed state.
  const ctxGuestFail = await browser.newContext();
  const pageGF = await ctxGuestFail.newPage();
  await pageGF.setViewportSize({ width: 1280, height: 900 });
  const guestFailUrl = await placeCardOrder(pageGF);
  const guestFailId = new URL(guestFailUrl).searchParams.get("order") ?? "";
  check("guest fail setup has an order id", guestFailId.length > 0, guestFailUrl);
  await clickTestPayOutcome(pageGF, "Simulate failed payment");
  check("guest fail lands on the order page", pageGF.url().includes(`/orders/${guestFailId}`), pageGF.url());
  await waitFor(async () => /Payment status: Failed/.test(await text(pageGF)));
  const guestFailText = await text(pageGF);
  const guestFailBrowser = await browserOrder(pageGF, guestFailId);
  check("guest fail: payment status is Failed", /Payment status: Failed/.test(guestFailText), guestFailText.slice(0, 300));
  check("guest fail: failed notice shows", guestFailText.includes("still pending payment"), guestFailText.slice(0, 300));
  check("guest fail: Retry payment is offered", guestFailText.includes("Retry payment"));
  check("guest fail: browser copy is pending_payment/failed", guestFailBrowser?.status === "pending_payment" && guestFailBrowser?.paymentStatus === "failed", JSON.stringify(guestFailBrowser));
  db = await mockOrder(guestFailId);
  check("guest fail: DB order stays pending_payment", db?.status === "pending_payment", JSON.stringify(db));
  check("guest fail: DB has a failed payments row", (await mockPaymentStatuses(guestFailId)).includes("failed"));
  await ctxGuestFail.close();

  // --- (2) LOW 3: callback illegal outcomes. ---
  // (a) A signed "failed" callback for the confirmed/paid order.
  const failedOnPaid = await postCallback(signedCallback(paidId, "failed"));
  check("callback: failed-on-paid returns 400", failedOnPaid.status === 400, `status=${failedOnPaid.status} body=${JSON.stringify(failedOnPaid.json)}`);
  db = await mockOrder(paidId);
  check("callback: paid order stays confirmed after refused failed", db?.status === "confirmed", JSON.stringify(db));
  check("callback: paid order keeps exactly its paid row", (await mockPaymentStatuses(paidId)).join(",") === "paid", (await mockPaymentStatuses(paidId)).join(","));
  // (b) A duplicate signed "paid" callback for the same order.
  const duplicatePaid = await postCallback(signedCallback(paidId, "paid"));
  check("callback: duplicate paid returns 200", duplicatePaid.status === 200, `status=${duplicatePaid.status} body=${JSON.stringify(duplicatePaid.json)}`);
  check("callback: duplicate paid appends no second paid row", (await mockPaymentStatuses(paidId)).join(",") === "paid", (await mockPaymentStatuses(paidId)).join(","));

  // (c) A signed "paid" callback for a cancelled order.
  const cancelTestPayUrl = await placeCardOrder(page);
  const cancelledId = new URL(cancelTestPayUrl).searchParams.get("order") ?? "";
  await clickTestPayOutcome(page, "Cancel payment");
  check("callback setup: cancelled order lands on its page", page.url().includes(`/orders/${cancelledId}`), page.url());
  db = await mockOrder(cancelledId);
  check("callback setup: order is cancelled in the DB", db?.status === "cancelled", JSON.stringify(db));
  const paidOnCancelled = await postCallback(signedCallback(cancelledId, "paid"));
  check("callback: paid-on-cancelled returns 400", paidOnCancelled.status === 400, `status=${paidOnCancelled.status} body=${JSON.stringify(paidOnCancelled.json)}`);
  db = await mockOrder(cancelledId);
  check("callback: cancelled order stays cancelled", db?.status === "cancelled", JSON.stringify(db));
  check("callback: cancelled order gains no paid row", !(await mockPaymentStatuses(cancelledId)).includes("paid"));

  // (d) A signed "paid" callback for a COD order (confirmed/unpaid).
  const codId = await placeCodOrder(page);
  db = await mockOrder(codId);
  check("callback setup: COD order is confirmed in the DB", db?.status === "confirmed", JSON.stringify(db));
  check("callback setup: COD order has no payments rows", (await mockPaymentStatuses(codId)).length === 0);
  const paidOnCod = await postCallback(signedCallback(codId, "paid"));
  check("callback: paid-on-COD returns 400", paidOnCod.status === 400, `status=${paidOnCod.status} body=${JSON.stringify(paidOnCod.json)}`);
  check("callback: COD order gains no paid row", (await mockPaymentStatuses(codId)).length === 0);

  // (e) A signed "failed" callback for a still-pending order: legal.
  const pendingId = new URL(await placeCardOrder(page)).searchParams.get("order") ?? "";
  const failedOnPending = await postCallback(signedCallback(pendingId, "failed"));
  check("callback: failed-on-pending returns 200", failedOnPending.status === 200, `status=${failedOnPending.status} body=${JSON.stringify(failedOnPending.json)}`);
  db = await mockOrder(pendingId);
  check("callback: pending order stays pending_payment", db?.status === "pending_payment", JSON.stringify(db));
  check("callback: pending order gains a failed row", (await mockPaymentStatuses(pendingId)).includes("failed"));

  // --- (3) LOW 5: forged local orders. ---
  // (a) A totals-consistent delivered + paid browser copy with no
  // server record renders labelled unverified, at three widths.
  const ctxForge = await browser.newContext();
  const pageF = await ctxForge.newPage();
  const forgedOrder = {
    id: "forged-local-1",
    orderNumber: "TS-20260101-9999",
    items: [{ productId: "apple-iphone-16-pro", title: "Apple iPhone 16 Pro", price_poisha: 11990000, mrp_poisha: 12990000, quantity: 1 }],
    address: { id: "addr_1", firstName: "Victim", lastName: "User", email: "victim@example.com", mobile: "01700000000", address: "1 Secret Road", area: "Agrabad", division: "Chattogram", district: "Chattogram", city: "Chattogram", isDefault: true },
    delivery: "standard",
    paymentMethod: "bkash",
    subtotal_poisha: 11990000,
    savings_poisha: 1000000,
    couponCode: null,
    couponDiscount_poisha: 0,
    deliveryFee_poisha: 0,
    total_poisha: 11990000,
    status: "delivered",
    paymentStatus: "paid",
    userId: null,
    buyerToken: null,
    testMode: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await pageF.goto(`${BASE}/orders`, { waitUntil: "networkidle0" });
  await pageF.evaluate((order) => {
    window.localStorage.setItem("techshot:orders", JSON.stringify([order]));
  }, forgedOrder);
  for (const width of [1440, 1280, 390]) {
    await pageF.setViewportSize({ width, height: 900 });
    await pageF.goto(`${BASE}/orders/forged-local-1`, { waitUntil: "networkidle0" });
    await sleep(2000);
    const forgePageText = await text(pageF);
    check(`forged local order @${width}: renders as delivered`, /Delivered/.test(forgePageText), forgePageText.slice(0, 200));
    check(`forged local order @${width}: labelled unverified`, forgePageText.includes("Unverified copy"), forgePageText.slice(0, 300));
    check(`forged local order @${width}: payment shows Paid (unverified)`, forgePageText.includes("Paid (unverified)"), forgePageText.slice(0, 300));
    check(`forged local order @${width}: no horizontal overflow`, await noHorizontalOverflow(pageF));
  }
  // (b) A totals-INCONSISTENT forged copy is dropped from the list.
  await pageF.evaluate(() => {
    const raw = window.localStorage.getItem("techshot:orders");
    const list = raw ? JSON.parse(raw) : [];
    list[0] = { ...list[0], id: "forged-local-2", orderNumber: "TS-20260101-9998", subtotal_poisha: 100, total_poisha: 100, couponDiscount_poisha: 5000000 };
    window.localStorage.setItem("techshot:orders", JSON.stringify(list));
  });
  await pageF.goto(`${BASE}/orders`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const listText = await text(pageF);
  check("forged local order: inconsistent totals are dropped from /orders", !listText.includes("TS-20260101-9998"), listText.slice(0, 300));
  await ctxForge.close();

  // --- (4) LOW 6 + LOW 11: refund reporting and the refund race. ---
  // A fresh paid order for the single-refund check.
  const refundTestPayUrl = await placeCardOrder(page);
  const refundId = new URL(refundTestPayUrl).searchParams.get("order") ?? "";
  await clickTestPayOutcome(page, "Pay successfully (test)");
  db = await mockOrder(refundId);
  check("refund setup: order is confirmed + paid", db?.status === "confirmed" && (await mockPaymentStatuses(refundId)).includes("paid"), JSON.stringify(db));
  const refundNumber = await adminOrderNumber(page, refundId);
  check("refund setup: order number found", refundNumber.length > 0, refundNumber);
  await page.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
  await sleep(1500);
  check("refund setup: Refund button shows for the paid order", await adminHasButton(page, refundNumber, "Refund"));
  await clickAdminButton(page, refundNumber, "Refund");
  const refunded = await waitFor(async () => (await mockOrder(refundId))?.status === "refunded");
  check("refund: order lands refunded", refunded, JSON.stringify(await mockOrder(refundId)));
  const refundRows = await mockPaymentStatuses(refundId);
  check("refund: exactly one refunded row and the paid row survives", refundRows.filter((s) => s === "refunded").length === 1 && refundRows.includes("paid"), refundRows.join(","));
  // A second refund attempt (manual selector back to refunded)
  // adds no second row.
  await page.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
  await sleep(1500);
  const refundedRowsBefore = (await mockPaymentStatuses(refundId)).filter((s) => s === "refunded").length;
  await page.evaluate((num) => {
    const sel = document.querySelector(`select[aria-label="Change status for order ${num}"]`);
    if (!sel) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, "refunded");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, refundNumber);
  await sleep(2000);
  const refundedRowsAfter = (await mockPaymentStatuses(refundId)).filter((s) => s === "refunded").length;
  check("refund reporting: a second refund attempt adds no second row", refundedRowsAfter === refundedRowsBefore, `before=${refundedRowsBefore} after=${refundedRowsAfter}`);

  // The race: two admin browsers refund the same paid order at once.
  const raceTestPayUrl = await placeCardOrder(page);
  const raceId = new URL(raceTestPayUrl).searchParams.get("order") ?? "";
  await clickTestPayOutcome(page, "Pay successfully (test)");
  const raceNumber = await adminOrderNumber(page, raceId);
  check("race setup: order number found", raceNumber.length > 0, raceNumber);
  const ctxAdmin2 = await browser.newContext();
  const pageA2 = await ctxAdmin2.newPage();
  await pageA2.setViewportSize({ width: 1280, height: 900 });
  await signIn(pageA2);
  await page.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
  await pageA2.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
  await sleep(2000);
  const ready1 = await waitFor(async () => {
    const state = await page.evaluate((num) => {
      const p = [...document.querySelectorAll("p")].find((el) => el.textContent?.includes(`Order ${num}`));
      if (!p) return false;
      let el = p;
      while (el) {
        const btn = [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === "Refund");
        if (btn) return !btn.disabled;
        el = el.parentElement;
      }
      return false;
    }, raceNumber);
    return state;
  });
  const ready2 = await waitFor(async () => {
    const state = await pageA2.evaluate((num) => {
      const p = [...document.querySelectorAll("p")].find((el) => el.textContent?.includes(`Order ${num}`));
      if (!p) return false;
      let el = p;
      while (el) {
        const btn = [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === "Refund");
        if (btn) return !btn.disabled;
        el = el.parentElement;
      }
      return false;
    }, raceNumber);
    return state;
  });
  check("race setup: Refund ready in both admin browsers", ready1 && ready2, `ready1=${ready1} ready2=${ready2}`);
  // Slow the mock down so both server actions overlap between
  // their load and their claim.
  await setMockDelay(75);
  try {
    await Promise.all([
      clickAdminButton(page, raceNumber, "Refund"),
      clickAdminButton(pageA2, raceNumber, "Refund"),
    ]);
  } finally {
    await setMockDelay(0);
  }
  const raceDone = await waitFor(async () => (await mockOrder(raceId))?.status === "refunded", 20000);
  check("race: order lands refunded", raceDone, JSON.stringify(await mockOrder(raceId)));
  const raceRows = await mockPaymentStatuses(raceId);
  check("race: exactly one refunded row (the loser refunded nothing)", raceRows.filter((s) => s === "refunded").length === 1, raceRows.join(","));
  check("race: the paid row survives alongside the refund row", raceRows.includes("paid"), raceRows.join(","));
  await ctxAdmin2.close();

  await ctxOwner.close();
  await browser.close();

  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILURES:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nAll lows-payment-trust checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
