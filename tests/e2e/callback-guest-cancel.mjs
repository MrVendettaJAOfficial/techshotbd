// Callback memory-miss + guest-cancel — Playwright regression check
// for the Ponytail review fixes to findings #1 and #2 (TechShot).
//
// Finding #1 — the public callback route 400s when the order is not
// in this server process's memory, so a real paid order stays
// "pending payment" when the callback lands on a different server
// (or after a restart). The fix loads the order from Supabase on a
// memory miss and continues the same flow.
// Finding #2 — a guest's cancel of a live database order was fake:
// cancelMyOrder returned localOnly before even looking for the row,
// so the browser showed "cancelled" while the database order stayed
// confirmed and its stock stayed held. The fix loads the database
// row first and returns a contact-us error for a live guest order.
//
// What this script proves, in mock-Supabase mode (mock on :3101,
// app on :3100, both with the mock env vars from the README,
// TEST_PAYMENT_SIGNING_SECRET set):
//   Finding #1:
//   (1a) a SIGNED callback for a database-only order — seeded
//        straight into the mock, so the app server has NO memory
//        record of it (the different-server / restarted case) —
//        returns 200 and confirms the order with a paid row;
//   (1b) a signed callback for an unknown order still returns 400
//        and creates nothing;
//   (1c) a verified-but-late cancel of the now-paid order is
//        refused (400, refund direction) and the order stays
//        confirmed + paid;
//   (1d) the memory-hit path is unchanged: a guest card order
//        placed through the browser, then a signed callback POST,
//        returns 200 and confirms it with a paid row.
//   Finding #2:
//   (2a) a guest COD order (real DB row, user_id NULL) cancelled
//        from the order page shows the contact-us notice, the page
//        still shows Confirmed, the mock DB row stays confirmed
//        and the stock is unchanged;
//   (2b) a browser-only guest order (no DB row) still cancels in
//        the browser with the honest local-only notice;
//   (2c) the signed-in owner cancel is unchanged: live cancel,
//        stock restored, stock-released notice.
//
// Run (see README, "End-to-end checks"):
//   node tests/e2e/mock-supabase.mjs  (port 3101, fresh per run)
//   build + serve pointed at the mock with TEST_PAYMENT_SIGNING_SECRET
//   set, then:
//     BASE_URL=http://127.0.0.1:3100 TEST_PAYMENT_SIGNING_SECRET=<same-secret> \
//       node tests/e2e/callback-guest-cancel.mjs
//   Viewport: VIEWPORT=1440 | 1280 (default) | 390.
//   The secret is required: the signed-callback probes cannot run
//   without it, and the script exits 2 instead of passing vacuously.
//
// Needs a Chromium (npx playwright install chromium once, and
// playwright-core resolvable — it is NOT a repo dependency). When the
// installed Playwright expects a newer Chromium than is downloaded,
// set CHROMIUM_PATH to an installed chrome binary. Exits non-zero
// when any check fails.

import { createRequire } from "node:module";
import { createHmac, randomUUID } from "node:crypto";

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
const MOCK = (process.env.MOCK_URL ?? "http://127.0.0.1:3101").replace(/\/$/, "");
const SECRET = process.env.TEST_PAYMENT_SIGNING_SECRET ?? "";
if (!SECRET) {
  console.error(
    "TEST_PAYMENT_SIGNING_SECRET is required for this suite (it signs the callback probes). " +
      "Start the app with the same secret and pass it here.",
  );
  process.exit(2);
}
const VIEWPORT = process.env.VIEWPORT ?? "1280";
const VIEWPORTS = {
  390: { width: 390, height: 844 },
  1280: { width: 1280, height: 900 },
  1440: { width: 1440, height: 900 },
};
const VIEWPORT_SIZE = VIEWPORTS[VIEWPORT] ?? VIEWPORTS["1280"];
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

// --- Mock REST reads / writes (the mock's DB state, not the browser copy) ---

const MOCK_HEADERS = {
  apikey: "mock-anon-key",
  Authorization: "Bearer mock-service-key",
  Accept: "application/json",
};

async function mockGet(path) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, { headers: MOCK_HEADERS });
  return res.json();
}

async function mockPost(table, row) {
  const res = await fetch(`${MOCK}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...MOCK_HEADERS, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(row),
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

function iphoneVariantStock(stockJson) {
  try {
    const parsed = JSON.parse(stockJson);
    const natural = (parsed.variants ?? []).find((v) => v.id === "var-iphone-natural-titanium");
    return natural ? natural.stock : null;
  } catch {
    return null;
  }
}

/** Seed a database-only order row (+ one item line) straight into
 *  the mock. The app server never sees this order at checkout, so
 *  it has NO memory record of it — the different-server /
 *  restarted case for the callback, and a live guest row for the
 *  cancel check. */
async function seedDbOrder({ id, orderNumber, userId, status, paymentMethod, total_poisha }) {
  const now = new Date().toISOString();
  await mockPost("orders", {
    id,
    order_number: orderNumber,
    user_id: userId,
    status,
    subtotal_poisha: total_poisha,
    delivery_poisha: 0,
    discount_poisha: 0,
    total_poisha,
    address_snapshot: {
      name: "Seed Guest",
      phone: "01812345678",
      division: "Dhaka",
      district: "Dhaka",
      city: "Dhaka",
      full_address: "House 9, Seed Road",
    },
    payment_method: paymentMethod,
    created_at: now,
    updated_at: now,
  });
  await mockPost("order_items", {
    id: `oi-${id}`,
    order_id: id,
    product_id: "prod-apple-iphone-16-pro-256gb-natural-titanium",
    title: "Apple iPhone 16 Pro 256GB Natural Titanium",
    price_poisha: total_poisha,
    quantity: 1,
  });
}

/** A correctly signed callback body for an order + adapter status. */
function signedCallback(orderId, status) {
  const timestamp = Date.now();
  const nonce = `cb-${Date.now()}-${randomUUID().slice(0, 8)}`;
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

// --- Browser helpers (same shapes as test-pay-security.mjs) ---

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

async function clickCancelOrder(page) {
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Cancel order"));
    if (!b) return false;
    b.click();
    return true;
  });
  check("order page offers Cancel order", clicked);
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
  console.log(`Viewport: ${VIEWPORT} (${VIEWPORT_SIZE.width}x${VIEWPORT_SIZE.height})`);

  // --- Finding #1 (1a): signed callback for a database-only order. ---
  // Seeded straight into the mock: the app server has NO memory
  // record of this order (different server / restart). Before the
  // fix this 400d and the order stayed pending_payment.
  const missId = `cb-miss-${Date.now().toString(36)}`;
  await seedDbOrder({
    id: missId,
    orderNumber: "TS-20261116-9001",
    userId: null,
    status: "pending_payment",
    paymentMethod: "card",
    total_poisha: 11990000,
  });
  let db = await mockOrder(missId);
  check("1a seeded order starts pending_payment in the mock DB", db?.status === "pending_payment", JSON.stringify(db));
  check("1a seeded order starts with no payments rows", (await mockPaymentStatuses(missId)).length === 0);
  const paid = await postCallback(signedCallback(missId, "paid"));
  check("1a signed callback for a memory-miss order returns 200", paid.status === 200, `status=${paid.status} body=${JSON.stringify(paid.json)}`);
  db = await mockOrder(missId);
  check("1a memory-miss order is confirmed in the mock DB", db?.status === "confirmed", JSON.stringify(db));
  check("1a memory-miss order has a paid payments row", (await mockPaymentStatuses(missId)).includes("paid"), (await mockPaymentStatuses(missId)).join(","));

  // --- Finding #1 (1b): signed callback for an unknown order: 400. ---
  const unknownId = `cb-unknown-${Date.now().toString(36)}`;
  const unknown = await postCallback(signedCallback(unknownId, "paid"));
  check("1b signed callback for an unknown order returns 400", unknown.status === 400, `status=${unknown.status}`);
  check("1b unknown order gains no payments row", (await mockPaymentStatuses(unknownId)).length === 0);
  check("1b unknown order has no DB row", (await mockOrder(unknownId)) === null);

  // --- Finding #1 (1c): late cancel of the now-paid order: refused. ---
  const lateCancel = await postCallback(signedCallback(missId, "cancelled"));
  check("1c late cancel of a paid order returns 400", lateCancel.status === 400, `status=${lateCancel.status} body=${JSON.stringify(lateCancel.json)}`);
  check("1c late cancel carries the refund direction", JSON.stringify(lateCancel.json).includes("Refund"), JSON.stringify(lateCancel.json));
  db = await mockOrder(missId);
  check("1c paid order stays confirmed after the refused cancel", db?.status === "confirmed", JSON.stringify(db));
  const missPayments = await mockPaymentStatuses(missId);
  check("1c paid order keeps exactly its paid row", missPayments.length === 1 && missPayments[0] === "paid", missPayments.join(","));

  // --- Finding #1 (1d): memory-hit path unchanged (browser checkout, then callback). ---
  const ctxGuestCard = await browser.newContext();
  const pageCard = await ctxGuestCard.newPage();
  await pageCard.setViewportSize(VIEWPORT_SIZE);
  const cardTestPayUrl = await placeCardOrder(pageCard);
  const cardId = new URL(cardTestPayUrl).searchParams.get("order") ?? "";
  check("1d guest card order id present", cardId.length > 0, cardId);
  db = await mockOrder(cardId);
  check("1d guest card order starts pending_payment in the mock DB", db?.status === "pending_payment", JSON.stringify(db));
  const stockAfterCardCheckout = await iphoneStock();
  const cardPaid = await postCallback(signedCallback(cardId, "paid"));
  check("1d signed callback for a memory-hit order returns 200", cardPaid.status === 200, `status=${cardPaid.status} body=${JSON.stringify(cardPaid.json)}`);
  db = await mockOrder(cardId);
  check("1d memory-hit order is confirmed in the mock DB", db?.status === "confirmed", JSON.stringify(db));
  check("1d memory-hit order has a paid payments row", (await mockPaymentStatuses(cardId)).includes("paid"), (await mockPaymentStatuses(cardId)).join(","));
  await ctxGuestCard.close();

  // --- Finding #2 (2a): guest COD order cancel is refused honestly. ---
  const ctxGuestCod = await browser.newContext();
  const pageCod = await ctxGuestCod.newPage();
  await pageCod.setViewportSize(VIEWPORT_SIZE);
  const codOrderUrl = await placeCodOrder(pageCod);
  const codId = orderIdFromUrl(codOrderUrl);
  check("2a guest COD order id present", codId.length > 0, codId);
  db = await mockOrder(codId);
  check("2a guest COD order is a DB row with no owner", db !== null && db.user_id === null && db.status === "confirmed", JSON.stringify(db));
  const stockBeforeCancel = await iphoneStock();
  await clickCancelOrder(pageCod);
  const codText = await text(pageCod);
  check("2a guest cancel shows the contact-us notice", codText.includes("Please contact us and we'll cancel it for you"), codText.slice(0, 400));
  check("2a guest cancel does NOT show the browser-only notice", !codText.includes("Order cancelled in this browser"), codText.slice(0, 400));
  check("2a guest cancel does NOT show the stock-released notice", !codText.includes("Stock for these items has been released"), codText.slice(0, 400));
  check("2a order page still shows the order as Confirmed", /Confirmed/.test(codText), codText.slice(0, 400));
  db = await mockOrder(codId);
  check("2a guest DB order stays confirmed after the refused cancel", db?.status === "confirmed", JSON.stringify(db));
  check("2a refused guest cancel leaves stock unchanged", (await iphoneStock()) === stockBeforeCancel, `before=${stockBeforeCancel} after=${await iphoneStock()}`);
  await ctxGuestCod.close();

  // --- Finding #2 (2b): browser-only guest order still cancels locally. ---
  const ctxBrowserOnly = await browser.newContext();
  const pageLocal = await ctxBrowserOnly.newPage();
  await pageLocal.setViewportSize(VIEWPORT_SIZE);
  const localId = `browser-only-${Date.now().toString(36)}`;
  const localToken = randomUUID();
  await pageLocal.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await pageLocal.evaluate(({ id, token }) => {
    const order = {
      id,
      orderNumber: "TS-20261116-9002",
      items: [{
        productId: "apple-iphone-16-pro-256gb-natural-titanium",
        title: "Apple iPhone 16 Pro 256GB Natural Titanium",
        price_poisha: 11990000,
        mrp_poisha: 12990000,
        quantity: 1,
      }],
      address: {
        id: "addr-local",
        firstName: "Local",
        lastName: "Guest",
        email: "guest@example.com",
        mobile: "01812345678",
        address: "House 3, Local Road",
        area: "Agrabad",
        division: "Chattogram",
        district: "Chattogram",
        city: "Chattogram",
        isDefault: false,
      },
      delivery: "standard",
      paymentMethod: "cod",
      subtotal_poisha: 11990000,
      savings_poisha: 1000000,
      couponCode: null,
      couponDiscount_poisha: 0,
      deliveryFee_poisha: 0,
      total_poisha: 11990000,
      status: "confirmed",
      paymentStatus: "unpaid",
      userId: null,
      buyerToken: token,
      testMode: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem("techshot:orders", JSON.stringify([order]));
  }, { id: localId, token: localToken });
  await pageLocal.goto(`${BASE}/orders/${localId}`, { waitUntil: "networkidle0" });
  await sleep(1000);
  const localText = await text(pageLocal);
  check("2b browser-only order renders on the order page", localText.includes("TS-20261116-9002"), localText.slice(0, 300));
  check("2b browser-only order has no DB row", (await mockOrder(localId)) === null);
  await clickCancelOrder(pageLocal);
  const localAfter = await text(pageLocal);
  check("2b browser-only cancel shows the local-only notice", localAfter.includes("Order cancelled in this browser"), localAfter.slice(0, 400));
  check("2b browser-only order shows Cancelled", /Cancelled/.test(localAfter), localAfter.slice(0, 400));
  await ctxBrowserOnly.close();

  // --- Finding #2 (2c): signed-in owner cancel is unchanged. ---
  const ctxOwner = await browser.newContext();
  const pageOwner = await ctxOwner.newPage();
  await pageOwner.setViewportSize(VIEWPORT_SIZE);
  await signIn(pageOwner);
  const ownerCodUrl = await placeCodOrder(pageOwner);
  const ownerId = orderIdFromUrl(ownerCodUrl);
  check("2c owner COD order id present", ownerId.length > 0, ownerId);
  const stockBeforeOwnerCancel = await iphoneStock();
  const variantBefore = iphoneVariantStock(stockBeforeOwnerCancel);
  await clickCancelOrder(pageOwner);
  const ownerText = await text(pageOwner);
  check("2c owner cancel shows the stock-released notice", ownerText.includes("Stock for these items has been released back to inventory."), ownerText.slice(0, 400));
  check("2c owner cancel shows Cancelled", /Cancelled/.test(ownerText), ownerText.slice(0, 400));
  db = await mockOrder(ownerId);
  check("2c owner order is cancelled in the mock DB", db?.status === "cancelled", JSON.stringify(db));
  const stockAfterOwnerCancel = await iphoneStock();
  check(
    "2c owner cancel restored stock by 1 (variant row)",
    iphoneVariantStock(stockAfterOwnerCancel) === (variantBefore ?? 0) + 1,
    `before=${stockBeforeOwnerCancel} after=${stockAfterOwnerCancel}`,
  );
  await ctxOwner.close();

  await browser.close();
  if (failures.length > 0) {
    console.error(`\nFAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nAll callback + guest-cancel checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
