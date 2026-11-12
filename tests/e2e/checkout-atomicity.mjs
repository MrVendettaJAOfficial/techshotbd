// Checkout atomicity — Playwright regression check (2026-11-12 fix
// for mediums #1–#7, audit run-1, head 9c305966).
//
// What this script proves, in mock-Supabase mode (mock on :3101,
// app on :3100, both with the mock env vars from the README,
// TEST_PAYMENT_SIGNING_SECRET set, mock started with MOCK_ROLE=admin):
//   #1 duplicate checkout: a replayed checkout POST (same
//       idempotency key) returns the ORIGINAL order — the mock DB
//       holds exactly one order for the key and iPhone stock drops
//       by exactly 1. The flight payload is also asserted to carry
//       an idempotencyKey field.
//   #2 guest COD: a guest order is a REAL orders row (user_id NULL)
//       with stock decremented, and the COD redirect carries
//       ?key=<buyerToken> (the same token the browser copy holds).
//   #3 coupon limit-1: the first checkout claims LIMIT1 (used_count
//       1, one discounted order); a second buyer with the same code
//       is rejected with "This coupon code is not valid." and no
//       second discounted order appears.
//   #5 guest coupon state: with FIRST2000 deactivated in the DB, a
//       guest checkout with the code is rejected exactly like a
//       signed-in one (the row is re-activated afterwards).
//   #4 FIRST2000 retirement: with the FIRST2000 row DELETED, a
//       signed-in checkout with the code is rejected (the row is
//       re-seeded afterwards).
//   #6 callback on a paid order: a signed 'cancelled' callback for
//       a confirmed+paid order returns 400 — the order stays
//       confirmed, keeps exactly its paid row, stock unchanged.
//       Control: the same callback for an UNPAID pending order
//       cancels it (200) AND restores the stock it claimed.
//   #7 advance double-submit: with the admin list open in TWO
//       pages, advancing in page A then advancing the STALE render
//       in page B is rejected ("This order was already changed.
//       Please reload and try again.") — one step, one audit row.
//
// Run (see README, "End-to-end checks"):
//   node tests/e2e/mock-supabase.mjs  (port 3101, MOCK_ROLE=admin)
//   build + serve pointed at the mock with TEST_PAYMENT_SIGNING_SECRET
//   set, then:
//     BASE_URL=http://127.0.0.1:3100 TEST_PAYMENT_SIGNING_SECRET=<redacted> \
//       node tests/e2e/checkout-atomicity.mjs
//
// Needs a Chromium (npx playwright install chromium once, and
// playwright-core resolvable — it is NOT a repo dependency). When the
// installed Playwright expects a newer Chromium than is downloaded,
// set CHROMIUM_PATH to an installed chrome binary. Exits non-zero
// when any check fails. The mock DB is shared across sections, so
// every assertion is relative (before/after), never absolute.

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
const SECRET = process.env.TEST_PAYMENT_SIGNING_SECRET ?? "";
if (!SECRET) {
  console.error("TEST_PAYMENT_SIGNING_SECRET is required: section #6 signs a callback probe with it.");
  process.exit(2);
}
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
  } catch (e) {
    const exe = process.env.CHROMIUM_PATH ?? "/home/hatch/.cache/ms-playwright/chromium-1148/chrome-linux/chrome";
    console.log(`Default Chromium launch failed (${String(e).slice(0, 120)}); retrying with ${exe}`);
    return await chromium.launch({ ...opts, executablePath: exe });
  }
}

async function text(page, selector = "main") {
  return (await page.evaluate((sel) => document.querySelector(sel)?.innerText ?? "", selector)).replace(/\s+/g, " ");
}

// --- Mock REST reads/writes (the mock's DB state, not the browser copy) ---

const mockHeaders = {
  apikey: "mock-anon-key",
  Authorization: "Bearer mock-anon-key",
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function mockGet(path) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, { headers: mockHeaders });
  return res.json();
}

async function mockPost(table, body) {
  const res = await fetch(`${MOCK}/rest/v1/${table}`, {
    method: "POST",
    headers: mockHeaders,
    body: JSON.stringify(body),
  });
  return res.json();
}

async function mockPatch(path, body) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, {
    method: "PATCH",
    headers: mockHeaders,
    body: JSON.stringify(body),
  });
  return res.json();
}

async function mockDelete(path) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, { method: "DELETE", headers: mockHeaders });
  return res.status;
}

async function mockOrder(id) {
  const rows = await mockGet(`orders?id=eq.${id}&select=id,status,user_id,order_number,idempotency_key,discount_poisha`);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function mockOrderCount() {
  const rows = await mockGet("orders?select=id");
  return Array.isArray(rows) ? rows.length : -1;
}

async function mockPaymentStatuses(id) {
  const rows = await mockGet(`payments?order_id=eq.${id}&select=status`);
  return Array.isArray(rows) ? rows.map((r) => r.status) : [];
}

async function iphoneStock() {
  // The iPhone is bought with its Natural Titanium variant (the
  // first "Add to Cart" on /shop adds the default variant), so the
  // app decrements the product_variants row, not the products row
  // (lib/orders/server/create.ts + lib/orders/stock.ts: the variant
  // row is the stock of record for a variant purchase, and a later
  // cancel restores exactly that row). Measuring the products row
  // would never move.
  const variants = await mockGet("product_variants?select=id,stock");
  const variant = (Array.isArray(variants) ? variants : []).find(
    (v) => v.id === "var-iphone-natural-titanium",
  );
  return variant ? variant.stock : -1;
}

async function couponRow(code) {
  const rows = await mockGet(`coupons?code=eq.${code}&select=id,code,used_count,usage_limit,is_active`);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function mockFetch(path, init) {
  const res = await fetch(`${MOCK}${path}`, init);
  return res;
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

async function setCoupon(page, code) {
  await page.evaluate((c) => window.localStorage.setItem("techshot:coupon", JSON.stringify(c)), code);
}

function orderIdFromUrl(url) {
  return url.split("/orders/")[1]?.split("?")[0] ?? "";
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

/** POST a signed payment callback; returns the HTTP status. */
async function signedCallback(orderId, status) {
  const timestamp = Date.now();
  const nonce = `atomic-${Date.now()}-${Math.floor(Math.random() * 1e9)}-abcdef12`;
  const signature = createHmac("sha256", SECRET)
    .update(`${orderId}:${status}:${timestamp}:${nonce}`)
    .digest("hex");
  const res = await fetch(`${BASE}/api/payments/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, status, timestamp, nonce, signature }),
  });
  await sleep(800);
  return res.status;
}

async function main() {
  const browser = await launchBrowser();

  // --- #1: duplicate checkout (signed-in COD, replayed server action) ---
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    const stockBefore = await iphoneStock();
    const ordersBefore = await mockOrderCount();

    // Capture the checkout server-action POST so it can be replayed verbatim.
    // The checkout page ALSO fires cart-sync POSTs to /checkout (the
    // cart store uploads the local cart on mount and after clear) —
    // keep the FIRST post carrying an idempotencyKey, which is the
    // placeOrder call. Keeping the last POST would capture a cart
    // sync ([[]] or a quantity update) and the replay would prove
    // nothing.
    let checkoutPost = null;
    page.on("request", (req) => {
      if (checkoutPost) return;
      if (req.method() !== "POST") return;
      try {
        if (new URL(req.url()).pathname !== "/checkout") return;
      } catch {
        return;
      }
      const postData = req.postData() ?? "";
      if (!postData.includes("idempotencyKey")) return;
      checkoutPost = { url: req.url(), headers: req.headers(), postData };
    });
    const orderUrl = await placeCodOrder(page);
    const orderId = orderIdFromUrl(orderUrl);
    check("#1 order id present", orderId.length > 0, orderId);
    const dbOrder = await mockOrder(orderId);
    check("#1 order is confirmed in the mock DB", dbOrder?.status === "confirmed", JSON.stringify(dbOrder));
    check("#1 stock dropped by exactly 1", (await iphoneStock()) === stockBefore - 1, `before=${stockBefore} after=${await iphoneStock()}`);
    check("#1 checkout POST was captured", checkoutPost !== null && typeof checkoutPost.postData === "string");
    if (checkoutPost) {
      check("#1 flight payload carries an idempotencyKey field", checkoutPost.postData.includes("idempotencyKey"), checkoutPost.postData.slice(0, 200));
      const uuids = checkoutPost.postData.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
      check("#1 exactly one UUID in the payload (the idempotency key)", uuids.length === 1, uuids.join(","));
      const key = uuids[0];
      // Replay the identical server-action request: same buyer, same key.
      const headers = { ...checkoutPost.headers };
      delete headers["content-length"];
      const replay = await ctx.request.post(checkoutPost.url, { headers, data: checkoutPost.postData });
      const replayBody = await replay.text();
      check("#1 replayed checkout POST returns 200", replay.status() === 200, `status=${replay.status()}`);
      check("#1 replay returns the ORIGINAL order number", replayBody.includes(dbOrder.order_number), `orderNumber=${dbOrder.order_number}`);
      const keyRows = await mockGet(`orders?idempotency_key=eq.${key}&select=id`);
      check("#1 exactly one DB order holds the replayed key", Array.isArray(keyRows) && keyRows.length === 1, `rows=${JSON.stringify(keyRows)}`);
      check("#1 replay creates no second order", (await mockOrderCount()) === ordersBefore + 1, `before=${ordersBefore} after=${await mockOrderCount()}`);
      check("#1 replay decrements stock no second time", (await iphoneStock()) === stockBefore - 1, `stock=${await iphoneStock()}`);
    }
    await ctx.close();
  }

  // --- #2: guest COD checkout decrements stock and keys the redirect ---
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    const stockBefore = await iphoneStock();
    const ordersBefore = await mockOrderCount();
    const orderUrl = await placeCodOrder(page);
    const orderId = orderIdFromUrl(orderUrl);
    const key = new URL(orderUrl).searchParams.get("key") ?? "";
    check("#2 guest COD lands on the order page", orderId.length > 0, orderUrl);
    check("#2 guest COD redirect carries ?key=", key.length > 0, orderUrl);
    const dbOrder = await mockOrder(orderId);
    check("#2 guest order is a DB row with user_id NULL", dbOrder !== null && dbOrder.user_id === null, JSON.stringify(dbOrder));
    check("#2 guest order is confirmed in the mock DB", dbOrder?.status === "confirmed");
    check("#2 guest order stores its idempotency key", Boolean(dbOrder?.idempotency_key), JSON.stringify(dbOrder));
    check("#2 one DB order was created", (await mockOrderCount()) === ordersBefore + 1);
    check("#2 guest stock dropped by exactly 1", (await iphoneStock()) === stockBefore - 1, `before=${stockBefore} after=${await iphoneStock()}`);
    const browserToken = await page.evaluate((id) => {
      try {
        const orders = JSON.parse(window.localStorage.getItem("techshot:orders") ?? "[]");
        return orders.find((o) => o.id === id)?.buyerToken ?? null;
      } catch {
        return null;
      }
    }, orderId);
    check("#2 browser copy carries the same buyer token as the redirect key", browserToken === key, `browser=${browserToken} url=${key}`);
    await ctx.close();
  }

  // --- #3: coupon usage_limit=1 — first buyer claims it, second is refused ---
  {
    const future = new Date(Date.now() + 365 * 864e5).toISOString();
    await mockPost("coupons", {
      code: "LIMIT1", type: "fixed", value_poisha: 100000, min_spend_poisha: 0,
      usage_limit: 1, used_count: 0, expires_at: future, is_active: true,
    });
    check("#3 LIMIT1 coupon seeded", (await couponRow("LIMIT1"))?.used_count === 0);

    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await page1.setViewportSize({ width: 1280, height: 900 });
    await signIn(page1);
    await page1.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await setCoupon(page1, "LIMIT1");
    const testPayUrl = await placeCardOrder(page1);
    const order1 = new URL(testPayUrl).searchParams.get("order") ?? "";
    check("#3 first LIMIT1 order id present", order1.length > 0, order1);
    const db1 = await mockOrder(order1);
    check("#3 first order got the 100000 discount", db1?.discount_poisha === 100000, JSON.stringify(db1));
    check("#3 LIMIT1 used_count is now 1", (await couponRow("LIMIT1"))?.used_count === 1);
    await ctx1.close();

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.setViewportSize({ width: 1280, height: 900 });
    await signIn(page2, "other@example.com");
    await page2.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await setCoupon(page2, "LIMIT1");
    const ordersBefore = await mockOrderCount();
    await addIphoneFromShop(page2);
    await page2.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
    await sleep(500);
    await fillAddress(page2);
    await choosePayment(page2, "Card");
    await submitOrder(page2);
    const bodyText = await text(page2);
    check("#3 second buyer is refused with the coupon error", bodyText.includes("This coupon code is not valid."), bodyText.slice(0, 300));
    check("#3 second buyer stays on checkout (no order)", page2.url().includes("/checkout"), page2.url());
    check("#3 no second order was created", (await mockOrderCount()) === ordersBefore, `before=${ordersBefore} after=${await mockOrderCount()}`);
    check("#3 LIMIT1 used_count stays 1", (await couponRow("LIMIT1"))?.used_count === 1);
    await ctx2.close();
  }

  // --- #5: guest checkout with a deactivated coupon is refused ---
  {
    await mockPatch("coupons?code=eq.FIRST2000", { is_active: false });
    check("#5 FIRST2000 deactivated in the DB", (await couponRow("FIRST2000"))?.is_active === false);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await setCoupon(page, "FIRST2000");
    const ordersBefore = await mockOrderCount();
    const stockBefore = await iphoneStock();
    await addIphoneFromShop(page);
    await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
    await sleep(500);
    await fillAddress(page);
    await choosePayment(page, "Cash on Delivery");
    await submitOrder(page);
    const bodyText = await text(page);
    check("#5 guest with deactivated coupon is refused", bodyText.includes("This coupon code is not valid."), bodyText.slice(0, 300));
    check("#5 guest stays on checkout (no order)", page.url().includes("/checkout"), page.url());
    check("#5 no order was created", (await mockOrderCount()) === ordersBefore);
    check("#5 stock unchanged", (await iphoneStock()) === stockBefore);
    await ctx.close();
    await mockPatch("coupons?code=eq.FIRST2000", { is_active: true });
    check("#5 FIRST2000 re-activated", (await couponRow("FIRST2000"))?.is_active === true);
  }

  // --- #4: deleting the FIRST2000 row retires it (no hardcoded fallback) ---
  {
    await mockDelete("coupons?code=eq.FIRST2000");
    check("#4 FIRST2000 row deleted", (await couponRow("FIRST2000")) === null);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await setCoupon(page, "FIRST2000");
    const ordersBefore = await mockOrderCount();
    const stockBefore = await iphoneStock();
    await addIphoneFromShop(page);
    await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
    await sleep(500);
    await fillAddress(page);
    await choosePayment(page, "Cash on Delivery");
    await submitOrder(page);
    const bodyText = await text(page);
    check("#4 deleted coupon is refused (no resurrection)", bodyText.includes("This coupon code is not valid."), bodyText.slice(0, 300));
    check("#4 stays on checkout (no order)", page.url().includes("/checkout"), page.url());
    check("#4 no order was created", (await mockOrderCount()) === ordersBefore);
    check("#4 stock unchanged", (await iphoneStock()) === stockBefore);
    await ctx.close();
    const future = new Date(Date.now() + 365 * 864e5).toISOString();
    await mockPost("coupons", {
      id: "coupon-first2000", code: "FIRST2000", type: "fixed", value_poisha: 200000,
      min_spend_poisha: 5000000, usage_limit: null, used_count: 0, expires_at: future, is_active: true,
    });
    check("#4 FIRST2000 row re-seeded", (await couponRow("FIRST2000")) !== null);
  }

  // --- #6: signed cancelled callback — paid order refused, unpaid order cancelled + restocked ---
  {
    // (a) Paid order: pay first, then the late cancellation must fail.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    const testPayUrl = await placeCardOrder(page);
    const paidId = new URL(testPayUrl).searchParams.get("order") ?? "";
    check("#6 paid order id present", paidId.length > 0, paidId);
    await clickTestPayOutcome(page, "Pay successfully (test)");
    check("#6 owner pay lands on the order page", page.url().includes(`/orders/${paidId}`), page.url());
    check("#6 paid order is confirmed in the mock DB", (await mockOrder(paidId))?.status === "confirmed");
    check("#6 paid order has a paid row", (await mockPaymentStatuses(paidId)).join(",") === "paid");
    const stockBeforeCancel = await iphoneStock();
    const cancelStatus = await signedCallback(paidId, "cancelled");
    check("#6 late cancel of a paid order returns 400", cancelStatus === 400, `status=${cancelStatus}`);
    check("#6 paid order stays confirmed", (await mockOrder(paidId))?.status === "confirmed");
    check("#6 paid order keeps exactly its paid row", (await mockPaymentStatuses(paidId)).join(",") === "paid", (await mockPaymentStatuses(paidId)).join(","));
    check("#6 paid cancel restores no stock (nothing was taken)", (await iphoneStock()) === stockBeforeCancel, `stock=${await iphoneStock()}`);
    await ctx.close();

    // (b) Unpaid pending order: the same callback cancels it and restores stock.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.setViewportSize({ width: 1280, height: 900 });
    await signIn(page2);
    const testPayUrl2 = await placeCardOrder(page2);
    const pendingId = new URL(testPayUrl2).searchParams.get("order") ?? "";
    check("#6 pending order id present", pendingId.length > 0, pendingId);
    check("#6 pending order starts pending_payment", (await mockOrder(pendingId))?.status === "pending_payment");
    const stockBefore = await iphoneStock();
    const cancelStatus2 = await signedCallback(pendingId, "cancelled");
    check("#6 unpaid cancel returns 200", cancelStatus2 === 200, `status=${cancelStatus2}`);
    check("#6 unpaid order is cancelled in the mock DB", (await mockOrder(pendingId))?.status === "cancelled");
    check("#6 cancelled order gains a failed payments row, no paid row", (await mockPaymentStatuses(pendingId)).join(",") === "failed", (await mockPaymentStatuses(pendingId)).join(","));
    check("#6 cancelled order's stock is restored", (await iphoneStock()) === stockBefore + 1, `before=${stockBefore} after=${await iphoneStock()}`);
    await ctx2.close();
  }

  // --- #7: advance double-submit — two tabs, the stale one is rejected ---
  {
    await mockFetch("/__test/role?role=admin");
    const ctx = await browser.newContext();
    const pageA = await ctx.newPage();
    await pageA.setViewportSize({ width: 1280, height: 900 });
    await signIn(pageA);
    const orderUrl = await placeCodOrder(pageA);
    const orderId = orderIdFromUrl(orderUrl);
    const dbOrder = await mockOrder(orderId);
    const orderNumber = dbOrder?.order_number ?? "";
    check("#7 COD order id present", orderId.length > 0, orderId);
    check("#7 COD order starts confirmed", dbOrder?.status === "confirmed", JSON.stringify(dbOrder));

    async function openAdmin(page) {
      // The Orders tab: /admin alone is the Overview, which renders
      // totals but no order rows and no Advance button.
      await page.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
      await sleep(1200);
    }
    async function clickAdvanceForOrder(page, number) {
      return page.evaluate((num) => {
        const btns = [...document.querySelectorAll("button")].filter(
          (b) => b.textContent.trim() === "Advance",
        );
        for (const b of btns) {
          let el = b;
          for (let i = 0; i < 8 && el; i += 1) {
            if (el.textContent.includes(num)) {
              b.click();
              return true;
            }
            el = el.parentElement;
          }
        }
        return false;
      }, number);
    }

    await openAdmin(pageA);
    const pageB = await ctx.newPage();
    await pageB.setViewportSize({ width: 1280, height: 900 });
    await openAdmin(pageB);
    const textA = await text(pageA);
    const textB = await text(pageB);
    check("#7 both tabs render the confirmed order", textA.includes(orderNumber) && textB.includes(orderNumber), orderNumber);

    check("#7 advance button found in tab A", await clickAdvanceForOrder(pageA, orderNumber));
    // Wait for the advance to land in the DB.
    let landed = false;
    for (let i = 0; i < 20 && !landed; i += 1) {
      await sleep(500);
      landed = (await mockOrder(orderId))?.status === "processing";
    }
    check("#7 first advance lands: confirmed -> processing", landed);
    // Tab B still renders the STALE confirmed row (no reload): its
    // advance must be rejected, not move the order to shipped.
    check("#7 advance button found in stale tab B", await clickAdvanceForOrder(pageB, orderNumber));
    await sleep(2500);
    const bodyB = await text(pageB);
    check("#7 stale advance is refused with the reload message", bodyB.includes("This order was already changed. Please reload and try again."), bodyB.slice(0, 300));
    check("#7 order stays processing (no second step)", (await mockOrder(orderId))?.status === "processing", JSON.stringify(await mockOrder(orderId)));
    const audit = await mockGet(`audit_log?entity_id=eq.${orderId}&select=action`);
    const advances = (Array.isArray(audit) ? audit : []).filter((r) => String(r.action ?? "").includes("confirmed->processing"));
    check("#7 exactly one advance audit row", advances.length === 1, JSON.stringify(audit));
    await ctx.close();
  }

  await browser.close();
  if (failures.length > 0) {
    console.error(`\nFAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nAll checkout-atomicity checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
