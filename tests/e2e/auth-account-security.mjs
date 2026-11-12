// Auth / account security — Playwright regression suite for the
// 3-MEDIUM batch (audit run-1, head 9c305966):
//   #8  order confirmation is owner-only (anonymous / non-owner /
//       guest-without-key see "Order not found"; the owner and the
//       guest holding ?key= see the order);
//   #9  browser-local orders / profile / addresses / wishlist leak
//       to the next account on a shared browser (sign-out clears
//       them; /orders and /account filter by the signed-in user even
//       when the previous user never signed out); the cart is
//       owner-tagged and filtered on render, never deleted on
//       sign-out, so a guest cart survives sign-out and returns when
//       the same account signs back in, and another account never
//       sees it;
//   #10 reset-password refuses an ordinary signed-in session, and a
//       recovery link resets the password once (single use).
//
// Run (see README, "End-to-end checks"):
//   node tests/e2e/mock-supabase.mjs  (port 3101)
//   build + serve pointed at the mock with TEST_PAYMENT_SIGNING_SECRET
//   set, then:
//     BASE_URL=http://127.0.0.1:3100 node tests/e2e/auth-account-security.mjs
//
// What the mock can and cannot prove here:
//   - The mock's auth accepts any password and returns users with
//     no `amr` claim, so the #10 recovery-success case drives the
//     LEGACY implicit flow: /auth/callback#access_token=...&
//     type=recovery. That exercises the marker set by the callback's
//     implicit branch, the server gate, the single-use consume and
//     the sign-out after reset end to end. The PKCE code exchange
//     path (exchangeAuthCode with type=recovery) needs a live
//     Supabase that can mint a real recovery code, and is covered
//     by the unit wiring pins in tests/auth-account-security.test.mjs
//     instead.
//   - The mock never sends email, so the forgot-password check only
//     proves the request is accepted and the success message shows.
//   - The mock's carts / cart_items tables back the server-cart
//     half of the cart checks; the local tagged copy is asserted
//     directly from localStorage as well.
//
// Needs a Chromium (npx playwright install chromium once, and
// playwright-core resolvable — it is NOT a repo dependency). When
// the installed Playwright expects a newer Chromium than is
// downloaded, set CHROMIUM_PATH to an installed chrome binary.
// Exits non-zero when any check fails.

import { createHash } from "node:crypto";
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

// The mock derives a stable user id from the sign-in email:
// test@example.com is user-1, any other email is user-<sha256-12>.
function mockUserId(email) {
  const normalized = String(email).trim().toLowerCase();
  if (normalized === "test@example.com") return "user-1";
  return `user-${createHash("sha256").update(normalized).digest("hex").slice(0, 12)}`;
}

const USER_A = "test@example.com";
const USER_B = "other@example.com";

// --- Browser helpers (same shapes as test-pay-security.mjs) ---

async function signIn(page, email = USER_A) {
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

async function signOutFromAccount(page) {
  await page.goto(`${BASE}/account`, { waitUntil: "networkidle0" });
  await sleep(1000);
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Sign out");
    if (!b) return false;
    b.click();
    return true;
  });
  check("account page has a Sign out button", clicked);
  await sleep(3000);
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

async function addProductFromShop(page, index = 0) {
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle0" });
  await page.evaluate((i) => {
    const btns = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim().startsWith("Add to Cart"));
    btns[i] && btns[i].click();
  }, index);
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

/** Place a COD order; returns the order-page URL it lands on. */
async function placeCodOrder(page) {
  await addProductFromShop(page, 0);
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await choosePayment(page, "Cash on Delivery");
  await submitOrder(page);
  check("COD goes straight to the order page (no test-pay)", /\/orders\/.+/.test(page.url()) && !page.url().includes("test-pay"), page.url());
  return page.url();
}

function orderIdFromUrl(url) {
  return url.split("/orders/")[1]?.split("?")[0] ?? "";
}

function keyFromUrl(url) {
  try {
    return new URL(url).searchParams.get("key") ?? "";
  } catch {
    return "";
  }
}

async function cartText(page) {
  await page.goto(`${BASE}/cart`, { waitUntil: "networkidle0" });
  await sleep(800);
  return text(page);
}

/** The browser-local account keys, read straight from localStorage. */
async function localAccountKeys(page) {
  return page.evaluate(() => ({
    orders: window.localStorage.getItem("techshot:orders"),
    profile: window.localStorage.getItem("techshot:profile"),
    addresses: window.localStorage.getItem("techshot:addresses"),
    wishlist: window.localStorage.getItem("techshot:wishlist"),
    cart: window.localStorage.getItem("techshot-cart-v1"),
  }));
}

/**
 * Seed another account's browser-local records, as they would look
 * after that account placed an order and saved a profile, an
 * address and a wishlist entry on this browser — without that
 * account ever signing out (the filter backstop has to hide them
 * even when sign-out clearing never ran).
 */
async function seedOtherAccountLocalData(page, ownerId) {
  await page.evaluate((owner) => {
    const address = {
      id: "addr-seed-1",
      firstName: "Seeded",
      lastName: "Other",
      email: "seeded-other@example.com",
      mobile: "01700000001",
      address: "House 9, Road 9",
      area: "Agrabad",
      division: "Chattogram",
      district: "Chattogram",
      city: "Chattogram",
      isDefault: true,
    };
    const order = {
      id: "order-seed-1",
      orderNumber: "TS-SEED-OTHER-1",
      items: [{ productId: "sony-wh-1000xm5", title: "Sony WH-1000XM5", price_poisha: 2499000, mrp_poisha: 2999000, quantity: 1 }],
      address,
      delivery: "standard",
      paymentMethod: "cod",
      subtotal_poisha: 2499000,
      savings_poisha: 500000,
      couponCode: null,
      couponDiscount_poisha: 0,
      deliveryFee_poisha: 0,
      total_poisha: 2499000,
      status: "confirmed",
      paymentStatus: "unpaid",
      userId: owner,
      buyerToken: null,
      testMode: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem("techshot:orders", JSON.stringify([order]));
    window.localStorage.setItem(
      "techshot:profile",
      JSON.stringify({ displayName: "Seeded Other", phone: "01700000001", email: "seeded-other@example.com" }),
    );
    window.localStorage.setItem(
      "techshot:addresses",
      JSON.stringify([{ ...address, userId: owner }]),
    );
    window.localStorage.setItem(
      "techshot:wishlist",
      JSON.stringify([{ productId: "sony-wh-1000xm5", title: "Sony WH-1000XM5", price_poisha: 2499000, mrp_poisha: 2999000, userId: owner }]),
    );
  }, ownerId);
}

async function main() {
  const browser = await launchBrowser();

  // =====================================================================
  // #8 — order confirmation is owner-only.
  // =====================================================================
  {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.setViewportSize({ width: 1280, height: 900 });
    await signIn(pageA, USER_A);
    const orderUrl = await placeCodOrder(pageA);
    const orderId = orderIdFromUrl(orderUrl);
    check("#8 signed-in order has an id", orderId.length > 0, orderId);

    // The owner sees the confirmation, with the delivery name.
    await pageA.goto(`${BASE}/checkout/confirmation?order=${orderId}`, { waitUntil: "networkidle0" });
    await sleep(800);
    const ownerText = await text(pageA);
    check("#8 owner sees the confirmation", ownerText.includes("Thank you"), ownerText.slice(0, 200));
    check("#8 owner sees the delivery name", ownerText.includes("Test User"), ownerText.slice(0, 200));

    // Anonymous: the same URL shows only "Order not found".
    const ctxAnon = await browser.newContext();
    const pageAnon = await ctxAnon.newPage();
    await pageAnon.goto(`${BASE}/checkout/confirmation?order=${orderId}`, { waitUntil: "networkidle0" });
    await sleep(800);
    const anonText = await text(pageAnon);
    check("#8 anonymous visitor sees Order not found", anonText.includes("Order not found"), anonText.slice(0, 200));
    check("#8 anonymous visitor sees no delivery PII", !anonText.includes("Test User") && !anonText.includes("01712345678"));
    await ctxAnon.close();

    // Another signed-in account: same denial.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.setViewportSize({ width: 1280, height: 900 });
    await signIn(pageB, USER_B);
    await pageB.goto(`${BASE}/checkout/confirmation?order=${orderId}`, { waitUntil: "networkidle0" });
    await sleep(800);
    const otherText = await text(pageB);
    check("#8 non-owner account sees Order not found", otherText.includes("Order not found"), otherText.slice(0, 200));
    check("#8 non-owner account sees no delivery PII", !otherText.includes("Test User") && !otherText.includes("01712345678"));
    await ctxB.close();

    // Unknown order id: the same branch, no leak of which ids exist.
    await pageA.goto(`${BASE}/checkout/confirmation?order=order_does_not_exist`, { waitUntil: "networkidle0" });
    await sleep(800);
    check("#8 unknown order id sees Order not found", (await text(pageA)).includes("Order not found"));
    await ctxA.close();
  }

  // Guest confirmation: the per-order key is the proof.
  {
    const ctxG = await browser.newContext();
    const pageG = await ctxG.newPage();
    await pageG.setViewportSize({ width: 1280, height: 900 });
    const orderUrl = await placeCodOrder(pageG);
    const orderId = orderIdFromUrl(orderUrl);
    const key = keyFromUrl(orderUrl);
    check("#8 guest COD redirect carries ?key=", key.length > 0, orderUrl);

    await pageG.goto(`${BASE}/checkout/confirmation?order=${orderId}&key=${encodeURIComponent(key)}`, { waitUntil: "networkidle0" });
    await sleep(800);
    const withKey = await text(pageG);
    check("#8 guest with the key sees the confirmation", withKey.includes("Thank you"), withKey.slice(0, 200));

    await pageG.goto(`${BASE}/checkout/confirmation?order=${orderId}`, { waitUntil: "networkidle0" });
    await sleep(800);
    check("#8 guest without the key sees Order not found", (await text(pageG)).includes("Order not found"));

    await pageG.goto(`${BASE}/checkout/confirmation?order=${orderId}&key=00000000-0000-4000-8000-000000000000`, { waitUntil: "networkidle0" });
    await sleep(800);
    check("#8 guest with a wrong key sees Order not found", (await text(pageG)).includes("Order not found"));
    await ctxG.close();
  }

  // =====================================================================
  // #9 — shared browser: the next account never sees the last one's data.
  // =====================================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, USER_A);
    const orderUrl = await placeCodOrder(page);
    const orderId = orderIdFromUrl(orderUrl);
    check("#9 user A placed an order", orderId.length > 0, orderId);
    const keysBefore = await localAccountKeys(page);
    check("#9 user A's order is saved in the browser", keysBefore.orders !== null && keysBefore.orders.includes(orderId), String(keysBefore.orders)?.slice(0, 120));
    const orderNumberA = JSON.parse(keysBefore.orders ?? "[]")[0]?.orderNumber ?? "";
    check("#9 user A's order number is known", orderNumberA.startsWith("TS-"), orderNumberA);

    // Account switch WITHOUT signing out: B signs in on the same
    // browser, with A's records still in storage.
    await signIn(page, USER_B);
    await page.goto(`${BASE}/orders`, { waitUntil: "networkidle0" });
    await sleep(1000);
    const ordersB = await text(page);
    check("#9 B's /orders shows no orders yet", ordersB.includes("No orders yet"), ordersB.slice(0, 200));
    check("#9 B's /orders shows none of A's order", !ordersB.includes(orderNumberA), ordersB.slice(0, 200));
    await page.goto(`${BASE}/account`, { waitUntil: "networkidle0" });
    await sleep(1000);
    const accountB = await text(page);
    check("#9 B's /account shows none of A's order", !accountB.includes(orderNumberA), accountB.slice(0, 200));

    // The filter backstop: even with A's records still in storage
    // (seeded directly, as if A never signed out), B's pages must
    // not render any of them.
    await seedOtherAccountLocalData(page, mockUserId(USER_A));
    await page.goto(`${BASE}/orders`, { waitUntil: "networkidle0" });
    await sleep(1000);
    const ordersSeeded = await text(page);
    check("#9 seeded A order stays hidden on B's /orders", !ordersSeeded.includes("TS-SEED-OTHER-1"), ordersSeeded.slice(0, 300));
    await page.goto(`${BASE}/account`, { waitUntil: "networkidle0" });
    await sleep(1000);
    const accountSeeded = await text(page);
    check("#9 seeded A profile stays hidden on B's /account", !accountSeeded.includes("Seeded Other"), accountSeeded.slice(0, 300));
    check("#9 seeded A address stays hidden on B's /account", !accountSeeded.includes("01700000001") && !accountSeeded.includes("House 9, Road 9"), accountSeeded.slice(0, 300));
    check("#9 seeded A wishlist stays hidden on B's /account", !accountSeeded.includes("Sony WH-1000XM5"), accountSeeded.slice(0, 300));

    // B's own order does show: the pages list the current user,
    // they are not just empty.
    const bOrderUrl = await placeCodOrder(page);
    const bOrderId = orderIdFromUrl(bOrderUrl);
    const bKeys = await localAccountKeys(page);
    const orderNumberB = (JSON.parse(bKeys.orders ?? "[]").find((o) => o.id === bOrderId) ?? {}).orderNumber ?? "";
    check("#9 B's order number is known", orderNumberB.startsWith("TS-"), orderNumberB);
    await page.goto(`${BASE}/orders`, { waitUntil: "networkidle0" });
    await sleep(1000);
    const ordersBAfter = await text(page);
    check("#9 B's own order lists on /orders", ordersBAfter.includes(orderNumberB), ordersBAfter.slice(0, 300));

    // Sign-out clears the account keys (but not the cart — the
    // cart check below covers that separately).
    await signOutFromAccount(page);
    const keysAfter = await localAccountKeys(page);
    check("#9 sign-out clears techshot:orders", keysAfter.orders === null, String(keysAfter.orders)?.slice(0, 80));
    check("#9 sign-out clears techshot:profile", keysAfter.profile === null, String(keysAfter.profile)?.slice(0, 80));
    check("#9 sign-out clears techshot:addresses", keysAfter.addresses === null, String(keysAfter.addresses)?.slice(0, 80));
    check("#9 sign-out clears techshot:wishlist", keysAfter.wishlist === null, String(keysAfter.wishlist)?.slice(0, 80));
    await ctx.close();
  }

  // =====================================================================
  // #9 — cart: owner-tagged, filtered on render, never deleted on sign-out.
  // =====================================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });

    // Guest cart.
    await addProductFromShop(page, 0);
    let cart = await cartText(page);
    check("#9 guest cart shows the iPhone", cart.includes("iPhone 16 Pro"), cart.slice(0, 200));

    // Sign in: the guest cart is adopted, not lost.
    await signIn(page, USER_A);
    cart = await cartText(page);
    check("#9 cart survives sign-in for the same account", cart.includes("iPhone 16 Pro"), cart.slice(0, 200));

    // Sign out: the guest view is empty, but the stored cart stays.
    await signOutFromAccount(page);
    cart = await cartText(page);
    check("#9 cart is hidden from the guest view after sign-out", cart.includes("Your cart is empty"), cart.slice(0, 200));
    let stored = await localAccountKeys(page);
    let parsedCart = null;
    try {
      parsedCart = JSON.parse(stored.cart ?? "null");
    } catch {
      parsedCart = null;
    }
    check("#9 sign-out does not delete the stored cart", parsedCart !== null && Array.isArray(parsedCart.items) && parsedCart.items.length === 1, String(stored.cart)?.slice(0, 200));
    check("#9 stored cart is tagged with user A's id", parsedCart?.userId === mockUserId(USER_A), `userId=${parsedCart?.userId}`);

    // Sign back in as A: the cart returns.
    await signIn(page, USER_A);
    cart = await cartText(page);
    check("#9 cart returns when the same account signs back in", cart.includes("iPhone 16 Pro"), cart.slice(0, 200));

    // Another account never sees it, and their own items do not
    // overwrite it for A.
    await signOutFromAccount(page);
    await signIn(page, USER_B);
    cart = await cartText(page);
    check("#9 cart is empty for the other account", cart.includes("Your cart is empty"), cart.slice(0, 200));
    await addProductFromShop(page, 1);
    cart = await cartText(page);
    check("#9 other account's own cart shows their item", !cart.includes("Your cart is empty"), cart.slice(0, 200));
    await signOutFromAccount(page);
    await signIn(page, USER_A);
    cart = await cartText(page);
    check("#9 first account's cart is back, without the other's item", cart.includes("iPhone 16 Pro"), cart.slice(0, 300));
    stored = await localAccountKeys(page);
    try {
      parsedCart = JSON.parse(stored.cart ?? "null");
    } catch {
      parsedCart = null;
    }
    check(
      "#9 restored cart holds exactly the first account's item",
      parsedCart?.userId === mockUserId(USER_A) &&
        Array.isArray(parsedCart.items) &&
        parsedCart.items.length === 1 &&
        String(parsedCart.items[0]?.slug ?? "").includes("apple-iphone-16-pro"),
      String(stored.cart)?.slice(0, 200),
    );
    await ctx.close();
  }

  // =====================================================================
  // #10 — reset-password: ordinary sessions refused, recovery links work once.
  // =====================================================================
  {
    // An ordinary signed-in session gets the expired-link message,
    // never the form.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, USER_A);
    await page.goto(`${BASE}/auth/reset-password`, { waitUntil: "networkidle0" });
    await sleep(1500);
    const ordinaryText = await text(page);
    check("#10 ordinary session sees the expired-link message", ordinaryText.includes("has expired or was already used"), ordinaryText.slice(0, 300));
    check("#10 ordinary session sees no new-password form", !ordinaryText.includes("New password"), ordinaryText.slice(0, 300));
    await ctx.close();

    // Forgot-password request is accepted by the mock (no email is
    // ever sent by it — delivery is live-only).
    const ctxF = await browser.newContext();
    const pageF = await ctxF.newPage();
    await pageF.goto(`${BASE}/auth/forgot-password`, { waitUntil: "networkidle0" });
    await pageF.evaluate((email) => {
      const el = document.getElementById("email");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, email);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, USER_A);
    await pageF.evaluate(() => {
      const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Send reset link"));
      b && b.click();
    });
    await sleep(2500);
    const forgotText = await text(pageF);
    check("#10 forgot-password request shows the sent message", forgotText.includes("If an account exists for"), forgotText.slice(0, 300));
    await ctxF.close();

    // A recovery link resets the password once (legacy implicit
    // flow, which the mock can serve — see the header note).
    const ctxR = await browser.newContext();
    const pageR = await ctxR.newPage();
    await pageR.setViewportSize({ width: 1280, height: 900 });
    // JWT-shaped, like the mock's accessTokenForEmail: supabase-js
    // decodes the token in setSession(), so the old
    // `mock-access-token.<b64(email)>.…` shape threw "Invalid JWT"
    // before any network call and the session never established.
    const b64 = (o) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({
      sub: mockUserId(USER_A),
      email: USER_A,
      aud: "authenticated",
      role: "authenticated",
      iat: now,
      exp: now + 3600,
    })}.mock-signature`;
    await pageR.goto(
      `${BASE}/auth/callback#access_token=${token}&refresh_token=mock-refresh-token&type=recovery&token_type=bearer&expires_in=3600`,
      { waitUntil: "networkidle0" },
    );
    await sleep(3500);
    check("#10 recovery link lands on the reset-password page", pageR.url().includes("/auth/reset-password"), pageR.url());
    const recoveryText = await text(pageR);
    check("#10 recovery session sees the new-password form", recoveryText.includes("New password"), recoveryText.slice(0, 300));
    await pageR.evaluate(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("password", "brandnew12");
      set("confirmPassword", "brandnew12");
    });
    await pageR.evaluate(() => {
      const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Change password"));
      b && b.click();
    });
    await sleep(3500);
    check("#10 reset lands on sign-in with the reset note", pageR.url().includes("/auth/sign-in") && pageR.url().includes("reset=1"), pageR.url());

    // The new password signs in (the mock accepts any password, so
    // this proves the flow completed and the session moved on).
    await signIn(pageR, USER_A);
    // And the link is single-use: the same session now gets the
    // expired-link message instead of a second form.
    await pageR.goto(`${BASE}/auth/reset-password`, { waitUntil: "networkidle0" });
    await sleep(1500);
    const reusedText = await text(pageR);
    check("#10 consumed recovery link shows the expired-link message", reusedText.includes("has expired or was already used"), reusedText.slice(0, 300));
    check("#10 consumed recovery link shows no form", !reusedText.includes("New password"), reusedText.slice(0, 300));
    await ctxR.close();
  }

  await browser.close();
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nAll auth / account security checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
