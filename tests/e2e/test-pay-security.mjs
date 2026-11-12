// Test-pay security — Playwright regression check (2026-11-12 fix
// for the 3 HIGH findings in app/checkout/test-pay/page.tsx,
// audit run-1, head 9c305966).
//
// What this script proves, in mock-Supabase mode (MOCK_ORDERS=1
// style setup — mock on :3101, app on :3100, both with the mock env
// vars from the README, TEST_PAYMENT_SIGNING_SECRET set):
//   (a) signed-in buyer end to end: sign in as test@example.com
//       (mock user-1), shop -> checkout with card -> test-pay page
//       (no ?key= — the session proves ownership) -> pay ->
//       order confirmed + paid payments row, order page shows it;
//   (b) guest buyer end to end: no sign-in, same flow with card ->
//       test-pay URL carries ?key=, the browser copy carries the
//       same token, pay -> confirmed + paid row;
//   (c) anonymous attack: fresh browser context, open the victim's
//       test-pay URL and click pay -> rejected, order stays
//       pending_payment with no paid row;
//   (d) non-owner attack: sign in as a second mock user
//       (other@example.com — the mock gives it a different user id,
//       user-<hash>, not user-1), open the victim's test-pay URL,
//       click pay -> rejected, no change;
//   (e) illegal state: a paid order -> cancel via test-pay ->
//       refused (stays confirmed/paid, stock unchanged); a cancelled
//       order -> pay via test-pay -> refused; a COD order -> pay via
//       test-pay URL -> refused (stays confirmed/unpaid, no paid row);
//   (b2) guest retry: a failed guest payment shows a "Retry
//       payment" link on /orders/<id> that carries the ?key=, and
//       following it pays the order.
//   (f) secret unset: run with TEST_PAY_NO_SECRET=1 against an app
//       server started WITHOUT TEST_PAYMENT_SIGNING_SECRET: the
//       test-pay page shows the error state with no pay buttons, a
//       forged plain POST to the page changes nothing, and a signed
//       public-callback POST returns 400 with no order change.
//
// Run (see README, "End-to-end checks"):
//   node tests/e2e/mock-supabase.mjs  (port 3101)
//   build + serve pointed at the mock with TEST_PAYMENT_SIGNING_SECRET
//   set, then:
//     BASE_URL=http://127.0.0.1:3100 node tests/e2e/test-pay-security.mjs
//   For (f), restart the app server WITHOUT the secret and run:
//     BASE_URL=http://127.0.0.1:3100 TEST_PAY_NO_SECRET=1 \
//       TEST_PAYMENT_SIGNING_SECRET=mock-signing-secret \
//       node tests/e2e/test-pay-security.mjs
//   (the secret value is only used to sign the forged callback probe;
//   the server has it unset, so the probe must fail.)
//
// Needs a Chromium (npx playwright install chromium once, and
// playwright-core resolvable — it is NOT a repo dependency). When the
// installed Playwright expects a newer Chromium than is downloaded,
// set CHROMIUM_PATH to an installed chrome binary. Exits non-zero
// when any check fails.

import { createRequire } from "node:module";
import { createHmac } from "node:crypto";

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
const MOCK = "http://127.0.0.1:3101";
const NO_SECRET_MODE = process.env.TEST_PAY_NO_SECRET === "1";
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

async function iphoneStock() {
  const products = await mockGet("products?select=id,slug,stock");
  const iphone = (Array.isArray(products) ? products : []).find((p) =>
    String(p.slug ?? "").startsWith("apple-iphone-16-pro"),
  );
  if (!iphone) return "no-iphone-row";
  const variants = await mockGet(`product_variants?product_id=eq.${iphone.id}&select=id,stock`);
  return JSON.stringify({ product: iphone.stock, variants });
}

// --- Browser helpers (same shapes as orders-fresh-browser.mjs) ---

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
  return url.split("/orders/")[1]?.split("?")[0] ?? "";
}

/** Place a card order; returns the test-pay URL the checkout lands on. */
async function placeCardOrder(page) {
  await addIphoneFromShop(page);
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await choosePayment(page, "Card");
  await submitOrder(page);
  check("card checkout lands on the test-pay page", page.url().includes("/checkout/test-pay"), page.url());
  return page.url();
}

/** Place a COD order; returns the order-page URL it lands on. */
async function placeCodOrder(page) {
  await addIphoneFromShop(page);
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await choosePayment(page, "Cash on Delivery");
  await submitOrder(page);
  check("COD goes straight to the order page (no test-pay)", /\/orders\/.+/.test(page.url()) && !page.url().includes("test-pay"), page.url());
  return page.url();
}

async function main() {
  const browser = await launchBrowser();

  if (NO_SECRET_MODE) {
    // --- (f) secret unset: the page must refuse, not fail open. ---
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    const testPayUrl = await placeCardOrder(page);
    const orderId = new URL(testPayUrl).searchParams.get("order") ?? "";
    check("no-secret run has an order id", orderId.length > 0, orderId);
    const bodyText = await text(page);
    check(
      "no-secret test-pay page shows the unavailable error state",
      bodyText.includes("Test payments are unavailable right now"),
      bodyText.slice(0, 200),
    );
    check(
      "no-secret test-pay page renders no pay buttons",
      !bodyText.includes("Pay successfully (test)") && !bodyText.includes("Simulate failed payment"),
    );
    const formCount = await page.evaluate(() => document.querySelectorAll("main form").length);
    check("no-secret test-pay page renders no pay forms", formCount === 0, `main forms=${formCount}`);

    // A forged plain POST to the page (no server-action reference is
    // rendered, so there is no action to invoke) must change nothing.
    await page.evaluate(async (base) => {
      const params = new URLSearchParams(window.location.search);
      const fd = new FormData();
      fd.append("orderId", params.get("order") ?? "");
      fd.append("outcome", "success");
      await fetch(`${base}/checkout/test-pay?order=${params.get("order") ?? ""}`, {
        method: "POST",
        body: fd,
      }).catch(() => {});
    }, BASE);
    await sleep(1500);
    const afterPost = await mockOrder(orderId);
    check("forged POST changes nothing: order stays pending_payment", afterPost?.status === "pending_payment", JSON.stringify(afterPost));
    check("forged POST adds no paid row", !(await mockPaymentStatuses(orderId)).includes("paid"));

    // A correctly signed public callback must also fail closed
    // without the secret (the route's own check).
    if (SECRET) {
      const timestamp = Date.now();
      const nonce = `nosecret-${Date.now()}-abcdef12345678`;
      const signature = createHmac("sha256", SECRET)
        .update(`${orderId}:paid:${timestamp}:${nonce}`)
        .digest("hex");
      const res = await fetch(`${BASE}/api/payments/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status: "paid", timestamp, nonce, signature }),
      });
      check("no-secret public callback returns 400", res.status === 400, `status=${res.status}`);
      const afterCallback = await mockOrder(orderId);
      check("no-secret callback changes nothing", afterCallback?.status === "pending_payment", JSON.stringify(afterCallback));
    } else {
      console.log("SKIP  signed-callback probe (TEST_PAYMENT_SIGNING_SECRET not passed to this run)");
    }
    await ctx.close();
    await browser.close();
    if (failures.length > 0) {
      console.error(`\nFAILED: ${failures.join(", ")}`);
      process.exit(1);
    }
    console.log("\nAll no-secret test-pay checks passed.");
    return;
  }

  // --- Victim context: signed in as test@example.com (mock user-1). ---
  const ctxVictim = await browser.newContext();
  const pageV = await ctxVictim.newPage();
  await pageV.setViewportSize({ width: 1280, height: 900 });
  await signIn(pageV);

  // V1: signed-in card order, left pending for the attack checks.
  const v1TestPayUrl = await placeCardOrder(pageV);
  const v1 = new URL(v1TestPayUrl).searchParams.get("order") ?? "";
  check("V1 order id present", v1.length > 0, v1);
  check("signed-in test-pay URL carries no guest key", !v1TestPayUrl.includes("key="), v1TestPayUrl);
  let db = await mockOrder(v1);
  check("V1 starts pending_payment in the mock DB", db?.status === "pending_payment", JSON.stringify(db));
  check("V1 starts with no payments rows", (await mockPaymentStatuses(v1)).length === 0);

  // --- (c) anonymous attack on V1 (fresh context, never signed in). ---
  const ctxAnon = await browser.newContext();
  const pageAnon = await ctxAnon.newPage();
  await pageAnon.setViewportSize({ width: 1280, height: 900 });
  await pageAnon.goto(v1TestPayUrl, { waitUntil: "networkidle0" });
  await sleep(1000);
  await clickTestPayOutcome(pageAnon, "Pay successfully (test)");
  check("anonymous pay is rejected to /orders", pageAnon.url().replace(/\/$/, "").endsWith("/orders"), pageAnon.url());
  db = await mockOrder(v1);
  check("anonymous attack: V1 stays pending_payment", db?.status === "pending_payment", JSON.stringify(db));
  check("anonymous attack: V1 gains no paid row", !(await mockPaymentStatuses(v1)).includes("paid"), (await mockPaymentStatuses(v1)).join(","));
  await ctxAnon.close();

  // --- (d) non-owner attack on V1 (second mock user). ---
  const ctxOther = await browser.newContext();
  const pageOther = await ctxOther.newPage();
  await pageOther.setViewportSize({ width: 1280, height: 900 });
  await signIn(pageOther, "other@example.com");
  await pageOther.goto(v1TestPayUrl, { waitUntil: "networkidle0" });
  await sleep(1000);
  await clickTestPayOutcome(pageOther, "Pay successfully (test)");
  check("non-owner pay is rejected to /orders", pageOther.url().replace(/\/$/, "").endsWith("/orders"), pageOther.url());
  db = await mockOrder(v1);
  check("non-owner attack: V1 stays pending_payment", db?.status === "pending_payment", JSON.stringify(db));
  check("non-owner attack: V1 gains no paid row", !(await mockPaymentStatuses(v1)).includes("paid"));
  await ctxOther.close();

  // --- (a) the victim pays V1 (signed-in owner). ---
  await pageV.goto(v1TestPayUrl, { waitUntil: "networkidle0" });
  await sleep(1000);
  await clickTestPayOutcome(pageV, "Pay successfully (test)");
  check("owner pay lands on the order page", pageV.url().includes(`/orders/${v1}`), pageV.url());
  const v1Text = await text(pageV);
  check("owner pay: order page shows the order as paid", /Paid/.test(v1Text), v1Text.slice(0, 300));
  db = await mockOrder(v1);
  check("owner pay: V1 is confirmed in the mock DB", db?.status === "confirmed", JSON.stringify(db));
  check("owner pay: V1 has a paid payments row", (await mockPaymentStatuses(v1)).includes("paid"), (await mockPaymentStatuses(v1)).join(","));

  // --- (e1) paid order -> cancel via test-pay: refused, stock unchanged. ---
  const stockBefore = await iphoneStock();
  await pageV.goto(v1TestPayUrl, { waitUntil: "networkidle0" });
  await sleep(1000);
  await clickTestPayOutcome(pageV, "Cancel payment");
  check("paid cancel is refused to the plain order page", pageV.url().includes(`/orders/${v1}`) && !pageV.url().includes("payment="), pageV.url());
  const v1RefusedText = await text(pageV);
  check("paid cancel refused: order page directs to a refund", /Please contact us for a refund/.test(v1RefusedText), v1RefusedText.slice(0, 300));
  db = await mockOrder(v1);
  check("paid cancel refused: V1 stays confirmed", db?.status === "confirmed", JSON.stringify(db));
  const v1Payments = await mockPaymentStatuses(v1);
  check("paid cancel refused: V1 keeps exactly its paid row", v1Payments.length === 1 && v1Payments[0] === "paid", v1Payments.join(","));
  check("paid cancel refused: stock unchanged", (await iphoneStock()) === stockBefore, `before=${stockBefore} after=${await iphoneStock()}`);

  // --- (e2) cancelled order -> pay via test-pay: refused (no resurrection). ---
  const v2TestPayUrl = await placeCardOrder(pageV);
  const v2 = new URL(v2TestPayUrl).searchParams.get("order") ?? "";
  check("V2 order id present", v2.length > 0, v2);
  await clickTestPayOutcome(pageV, "Cancel payment");
  check("V2 cancel lands on the order page", pageV.url().includes(`/orders/${v2}`), pageV.url());
  db = await mockOrder(v2);
  check("V2 is cancelled in the mock DB", db?.status === "cancelled", JSON.stringify(db));
  const v2PaymentsBefore = await mockPaymentStatuses(v2);
  await pageV.goto(v2TestPayUrl, { waitUntil: "networkidle0" });
  await sleep(1000);
  await clickTestPayOutcome(pageV, "Pay successfully (test)");
  check("cancelled-order pay is refused to the plain order page", pageV.url().includes(`/orders/${v2}`) && !pageV.url().includes("payment="), pageV.url());
  db = await mockOrder(v2);
  check("cancelled-order pay refused: V2 stays cancelled", db?.status === "cancelled", JSON.stringify(db));
  const v2PaymentsAfter = await mockPaymentStatuses(v2);
  check("cancelled-order pay refused: no new payments row", JSON.stringify(v2PaymentsAfter) === JSON.stringify(v2PaymentsBefore), `before=${v2PaymentsBefore.join(",")} after=${v2PaymentsAfter.join(",")}`);
  const v2Text = await text(pageV);
  check("cancelled-order pay refused: order page still shows it cancelled", /Cancelled/.test(v2Text), v2Text.slice(0, 300));

  // --- (e3) COD order -> pay via test-pay URL: refused. ---
  const v3OrderUrl = await placeCodOrder(pageV);
  const v3 = orderIdFromUrl(v3OrderUrl);
  check("V3 order id present", v3.length > 0, v3);
  db = await mockOrder(v3);
  check("V3 COD order is confirmed in the mock DB", db?.status === "confirmed", JSON.stringify(db));
  check("V3 COD order has no payments rows", (await mockPaymentStatuses(v3)).length === 0);
  const v3TestPayUrl = `${BASE}/checkout/test-pay?order=${v3}&ref=test-ref-cod`;
  await pageV.goto(v3TestPayUrl, { waitUntil: "networkidle0" });
  await sleep(1000);
  await clickTestPayOutcome(pageV, "Pay successfully (test)");
  check("COD pay is refused to the plain order page", pageV.url().includes(`/orders/${v3}`) && !pageV.url().includes("payment="), pageV.url());
  db = await mockOrder(v3);
  check("COD pay refused: V3 stays confirmed", db?.status === "confirmed", JSON.stringify(db));
  check("COD pay refused: V3 gains no paid row", !(await mockPaymentStatuses(v3)).includes("paid"), (await mockPaymentStatuses(v3)).join(","));
  await ctxVictim.close();

  // --- (b) guest buyer end to end, incl. the retry link carrying the key. ---
  const ctxGuest = await browser.newContext();
  const pageG = await ctxGuest.newPage();
  await pageG.setViewportSize({ width: 1280, height: 900 });
  const guestTestPayUrl = await placeCardOrder(pageG);
  const guestKey = new URL(guestTestPayUrl).searchParams.get("key") ?? "";
  const guestId = new URL(guestTestPayUrl).searchParams.get("order") ?? "";
  check("guest test-pay URL carries the key", guestKey.length > 0, guestTestPayUrl);
  check("guest order id present", guestId.length > 0, guestId);
  const browserToken = await pageG.evaluate((id) => {
    try {
      const orders = JSON.parse(window.localStorage.getItem("techshot:orders") ?? "[]");
      return orders.find((o) => o.id === id)?.buyerToken ?? null;
    } catch {
      return null;
    }
  }, guestId);
  check("guest browser copy carries the same buyer token", browserToken === guestKey, `browser=${browserToken} url=${guestKey}`);
  // Finding #2 changed this: a guest order is now a real DB row
  // with user_id NULL (see lib/orders/server/create.ts), not a
  // browser-only order.
  const guestDb = await mockOrder(guestId);
  check("guest order is a DB row with no owner", guestDb !== null && guestDb.user_id === null, JSON.stringify(guestDb));

  // Failed payment first: the order stays pending and retryable.
  await clickTestPayOutcome(pageG, "Simulate failed payment");
  check("guest failed payment lands on the order page", pageG.url().includes(`/orders/${guestId}`), pageG.url());
  const retryHref = await pageG.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) => x.textContent.includes("Retry payment"));
    return a ? a.getAttribute("href") : null;
  });
  check("guest order page shows a Retry payment link", retryHref !== null, retryHref ?? "");
  check("retry link carries the guest key", Boolean(retryHref && retryHref.includes(`key=${encodeURIComponent(guestKey)}`)), retryHref ?? "");
  check("retry link points at the same order", Boolean(retryHref && retryHref.includes(`order=${guestId}`)), retryHref ?? "");
  await pageG.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) => x.textContent.includes("Retry payment"));
    a && a.click();
  });
  await sleep(2000);
  check("retry link lands on the test-pay page with the key", pageG.url().includes("/checkout/test-pay") && pageG.url().includes(`key=${guestKey}`), pageG.url());
  await clickTestPayOutcome(pageG, "Pay successfully (test)");
  check("guest retry pay lands on the order page", pageG.url().includes(`/orders/${guestId}`), pageG.url());
  const guestText = await text(pageG);
  check("guest retry pay: order page shows the order as paid", /Paid/.test(guestText), guestText.slice(0, 300));
  await ctxGuest.close();

  await browser.close();
  if (failures.length > 0) {
    console.error(`\nFAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nAll test-pay security checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
