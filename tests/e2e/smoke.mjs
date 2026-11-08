// TechShot end-to-end smoke test (Playwright).
//
// Clicks through the real flows in a real browser against a running app:
//   1. add a live-slug product to the cart (badge, /cart, totals, qty, remove)
//   2. add the 512 GB variant from the product page (variant price delta)
//   3. checkout with the test card -> test-pay -> pay successfully -> order paid
//   4. checkout again -> test-pay -> failed payment -> order stays unpaid,
//      Retry payment works -> pay successfully -> order paid
//   5. checkout with COD -> order placed with no payment step, unpaid by design
//   6. the public callback route: with TEST_PAYMENT_SIGNING_SECRET set, a
//      correctly signed callback returns 200 and marks the order paid;
//      without it, a callback returns 400 and the order stays unpaid.
//
// Run it in EITHER mode (see the README, "End-to-end checks"):
//   - Fallback (no Supabase): build + serve the app with no env vars, then
//       BASE_URL=http://127.0.0.1:3100 node tests/e2e/smoke.mjs
//   - Configured (mock Supabase): start tests/e2e/mock-supabase.mjs, build +
//     serve the app pointed at it, then
//       BASE_URL=http://127.0.0.1:3100 TECHSHOT_SIGN_IN=1 \
//       TEST_PAYMENT_SIGNING_SECRET=<secret or empty> node tests/e2e/smoke.mjs
//     With TECHSHOT_SIGN_IN=1 the script signs in first (the mock accepts
//     any password for test@example.com). With a secret set, step 6 uses a
//     correctly signed callback; without one it asserts the 400 fail-closed
//     behaviour instead.
//
// Needs a Chromium: `npx playwright install chromium` once, and
// playwright-core resolvable (install it in a scratch directory and run
// from there, or `npm i -D playwright-core` in this repo — it is NOT a
// repo dependency). Exits non-zero when any check fails.

import { createRequire } from "node:module";
import { createHmac } from "node:crypto";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  try {
    ({ chromium } = require("playwright"));
  } catch {
    console.error(
      "Playwright is not installed. Install it once:\n" +
        "  npm i -D playwright-core && npx playwright install chromium",
    );
    process.exit(2);
  }
}

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const SIGN_IN = process.env.TECHSHOT_SIGN_IN === "1";
const SECRET = process.env.TEST_PAYMENT_SIGNING_SECRET ?? "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(name);
}

async function text(page, selector = "main") {
  return (await page.evaluate((sel) => document.querySelector(sel)?.innerText ?? "", selector))
    .replace(/\s+/g, " ");
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
}

async function cartBadge(page) {
  return page.evaluate(() => document.querySelector('a[aria-label^="Cart"]')?.getAttribute("aria-label") ?? "");
}

async function addIphoneFromShop(page) {
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) =>
      b.textContent.trim().startsWith("Add to Cart"),
    );
    btns[0] && btns[0].click();
  });
  await sleep(1200);
}

async function launchBrowser() {
  const opts = { args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  try {
    return await chromium.launch(opts);
  } catch {
    // The installed Playwright expects a Chromium build that is not
    // downloaded; fall back to the downloaded chromium-1148 binary.
    const exe = process.env.CHROMIUM_PATH ?? "/home/hatch/.cache/ms-playwright/chromium-1148/chrome-linux/chrome";
    return await chromium.launch({ ...opts, executablePath: exe });
  }
}

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // --- optional sign-in (configured mode, mock auth) ---
  if (SIGN_IN) {
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
    check(
      "sign-in shows a Signed in successfully message on /account",
      (await text(page)).includes("Signed in successfully"),
      (await text(page)).slice(0, 300),
    );
    const accountText = await text(page);
    check("account shows the signed-in name", accountText.includes("Test User"), accountText.slice(0, 300));
    check("account shows the signed-in email", accountText.includes("test@example.com"));
    check("account shows the Customer role", accountText.includes("Customer"));
    check(
      "account shows a Sign out button",
      await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Sign out")),
    );
  } else {
    await page.goto(`${BASE}/account`, { waitUntil: "networkidle0" });
    await sleep(800);
    check(
      "signed-out /account renders with a sign-in prompt",
      (await text(page)).includes("You are not signed in"),
      (await text(page)).slice(0, 300),
    );
  }

  // --- 1. cart: add, badge, /cart, totals, qty, remove ---
  await addIphoneFromShop(page);
  check("header badge shows 1 item after add", (await cartBadge(page)).includes("1 items"));
  const stored = await page.evaluate(() => localStorage.getItem("techshot-cart-v1"));
  check("cart persists to localStorage", !!stored && stored.includes("apple-iphone-16-pro"));
  await page.goto(`${BASE}/cart`, { waitUntil: "networkidle0" });
  await sleep(800);
  let cartText = await text(page);
  check("cart page shows the iPhone line (not 'no longer available')", cartText.includes("Apple iPhone 16 Pro") && !cartText.includes("no longer available"), cartText.slice(0, 200));
  check("cart total is ৳1,19,900 for one iPhone", cartText.includes("৳1,19,900"));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Increase quantity");
    b && b.click();
  });
  await sleep(800);
  cartText = await text(page);
  check("quantity + updates totals to ৳2,39,800", cartText.includes("৳2,39,800"));
  check("header badge shows 2 items after qty +", (await cartBadge(page)).includes("2 items"));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Remove");
    b && b.click();
  });
  await sleep(800);
  check("remove empties the cart", (await text(page)).includes("Your cart is empty"));

  // --- 2. variant price delta from the product page ---
  // The seed catalogue's iPhone has storage options (512 GB is +৳20,000);
  // the live database has no product_variants rows seeded, so the live
  // product page shows no storage selector — the live product IS the
  // 256 GB variant. Test the delta when the option exists, otherwise
  // the default variant. The checkout below uses the same expected total.
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle0" });
  await sleep(600);
  const iphoneLink = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href^="/product/"]')].find((x) => x.getAttribute("href").includes("iphone-16-pro"));
    return a?.getAttribute("href") ?? "";
  });
  check("shop links the iPhone product page", iphoneLink.includes("iphone-16-pro"), iphoneLink);
  await page.goto(`${BASE}${iphoneLink}`, { waitUntil: "networkidle0" });
  await sleep(600);
  const has512 = (await page.getByRole("button", { name: /512 GB/ }).count()) > 0;
  let expectedTotal = "৳1,19,900";
  if (has512) {
    await page.getByRole("button", { name: /512 GB/ }).first().click();
    await sleep(300);
    expectedTotal = "৳1,39,900";
  }
  await page.getByRole("button", { name: "Add to Cart" }).first().click();
  await sleep(1000);
  await page.goto(`${BASE}/cart`, { waitUntil: "networkidle0" });
  await sleep(800);
  cartText = await text(page);
  check(
    has512
      ? "512 GB variant prices at ৳1,39,900 (base + ৳20,000)"
      : "default variant prices at ৳1,19,900 (live product has no storage options)",
    cartText.includes(expectedTotal),
    cartText.slice(0, 300),
  );

  // --- 3. checkout with the test card, pay successfully ---
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await submitOrder(page);
  check("checkout redirects to the test payment page", page.url().includes("/checkout/test-pay"), page.url());
  check("test-pay shows the cart amount", (await text(page)).includes(expectedTotal));
  await clickTestPayOutcome(page, "Pay successfully");
  check("paid order lands on its order page", /\/orders\/.+/.test(page.url()), page.url());
  let orderText = await text(page);
  check("paid order shows Confirmed", orderText.includes("Confirmed"));
  check("paid order shows success notice", orderText.includes("Test payment successful"));
  await page.goto(`${BASE}/orders`, { waitUntil: "networkidle0" });
  await sleep(500);
  check("paid order appears in /orders", (await text(page)).includes("TS-"));
  if (SIGN_IN) {
    await page.goto(`${BASE}/account`, { waitUntil: "networkidle0" });
    await sleep(1200);
    const accountAfterOrder = await text(page);
    check("paid order appears in /account order history", accountAfterOrder.includes("TS-"), accountAfterOrder.slice(0, 400));
  }

  // --- 4. failed payment leaves the order unpaid, retry works ---
  await addIphoneFromShop(page);
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await submitOrder(page);
  check("second checkout reaches test-pay", page.url().includes("/checkout/test-pay"));
  await clickTestPayOutcome(page, "Simulate failed payment");
  orderText = await text(page);
  check("failed payment shows the order as Pending payment", orderText.includes("Pending payment"));
  check("failed payment notice says the order is still pending payment", orderText.includes("still pending payment"));
  const retryVisible = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) => x.textContent.trim() === "Retry payment");
    if (!a) return false;
    a.click();
    return true;
  });
  check("failed order offers Retry payment", retryVisible);
  await sleep(2500);
  check("retry returns to the test payment page", page.url().includes("/checkout/test-pay"), page.url());
  await clickTestPayOutcome(page, "Pay successfully");
  orderText = await text(page);
  check("retried payment marks the order Confirmed", orderText.includes("Confirmed"));

  // --- 5. COD places an order with no payment step ---
  await addIphoneFromShop(page);
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await choosePayment(page, "Cash on Delivery");
  await submitOrder(page);
  check("COD goes straight to the order page (no test-pay)", /\/orders\/.+/.test(page.url()) && !page.url().includes("test-pay"), page.url());
  orderText = await text(page);
  check("COD order shows Cash on Delivery", orderText.includes("Cash on Delivery"));
  check("COD order is Unpaid by design", orderText.includes("Unpaid"));

  // --- 6. public callback route ---
  await addIphoneFromShop(page);
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await submitOrder(page);
  check("callback-flow checkout reaches test-pay", page.url().includes("/checkout/test-pay"));
  const orderId = new URL(page.url()).searchParams.get("order") ?? "";
  check("test-pay URL carries the order id", orderId.length > 0, orderId);
  const callbackBody = (status, signature, timestamp, nonce) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, status, timestamp, nonce, signature }),
  });
  // Signed callback payload: timestamp + nonce are part of the HMAC
  // input ("<orderId>:<status>:<timestamp>:<nonce>") and replay
  // protection rejects the same signed payload twice.
  const signCallback = (status, timestamp, nonce) => ({
    timestamp,
    nonce,
    signature: createHmac("sha256", SECRET)
      .update(`${orderId}:${status}:${timestamp}:${nonce}`)
      .digest("hex"),
  });
  if (SECRET) {
    const first = signCallback("paid", Date.now(), `smoke-${Date.now()}-a1b2c3d4`);
    const res = await fetch(
      `${BASE}/api/payments/callback`,
      callbackBody("paid", first.signature, first.timestamp, first.nonce),
    );
    const json = await res.json().catch(() => ({}));
    check("signed callback returns 200", res.status === 200 && json.ok === true, `${res.status} ${JSON.stringify(json)}`);
    // Replaying the exact same signed callback must be rejected.
    const replay = await fetch(
      `${BASE}/api/payments/callback`,
      callbackBody("paid", first.signature, first.timestamp, first.nonce),
    );
    check("replayed callback is rejected (400)", replay.status === 400, `got ${replay.status}`);
    await page.goto(`${BASE}/orders/${orderId}`, { waitUntil: "networkidle0" });
    // The order page reconciles the browser copy with the server record
    // (updated by the callback), so wait for the paid state to appear.
    await page.waitForFunction(
      () => document.querySelector("main")?.innerText.includes("Confirmed"),
      { timeout: 10000 },
    ).catch(() => {});
    await sleep(500);
    orderText = await text(page);
    check("signed callback marks the order Confirmed", orderText.includes("Confirmed"));
    check("signed callback marks the payment Paid", orderText.includes("Paid"));
  } else {
    const res = await fetch(
      `${BASE}/api/payments/callback`,
      callbackBody("paid", "0".repeat(64), Date.now(), "smoke-no-secret-nonce"),
    );
    check("callback without a secret fails closed (400)", res.status === 400, `got ${res.status}`);
    await page.goto(`${BASE}/orders/${orderId}`, { waitUntil: "networkidle0" });
    await sleep(1200);
    orderText = await text(page);
    check("rejected callback leaves the order Pending payment", orderText.includes("Pending payment"));
  }

  check("no page JS errors during the whole run", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 500));
  await browser.close();

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED: ${failures.join(", ")}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE SCRIPT FAILED:", e);
  process.exit(1);
});
