// TechShot roles + admin-tabs verification (Playwright, mock Supabase).
//
// ONE combined run for the roles + admin-tabs build (2026-11-09):
//   1. route smoke: /, /shop, /cart, /admin, /orders OK, /seller 404
//   2. reviews, logged out: only real review rows are shown (average
//      4.5 from 2 reviews — never the seeded 4.9 / 1,248), "Sign in
//      to write a review", "No reviews yet" where there are none
//   3. owner: all four admin tabs, stats, users role-change + remove
//      controls (role change sticks, then is reverted)
//   4. manual status selector: a confirmed COD order jumps straight
//      to Returned (a non-next status) and sticks, with exactly one
//      audit row and stock restored
//   5. paid return: a paid card order advanced to shipped, then set
//      to Returned — the adapter-first refund appends a refunded
//      payments row, stock is restored, and the customer order page
//      shows Returned as terminal
//   6. warranty + specifications saved in /admin show on the product
//      page (warranty + specs tabs)
//   7. Advance double-clicked synchronously moves exactly one step
//      with exactly one audit row (the in-flight ref guard, now in
//      components/AdminOrders.tsx)
//   8. a delivered order lets the signed-in owner submit a review,
//      which appears with the updated count / average
//   9. manager: no Advance / selector / Users tab, orders read-only,
//      but CAN Edit / Pause products (2026-11-10), can see the
//      orders list
//  10. co-admin: no Users tab, but CAN advance an order
//  11. customer: /admin redirects away
//  12. responsiveness at 1440 / 1280 / 390: no page overflow, the
//      tab rows scroll instead of overflowing
//
// Run (see README, "End-to-end checks"):
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 MOCK_URL=http://127.0.0.1:3101 node tests/e2e/roles-admin-tabs.mjs
//
// The mock's GET /__test/role?role=X switches user-1's profile role
// at runtime, so one mock process serves every role scenario with
// orders persisting across the switch. Needs a Chromium:
// playwright-core resolvable (it is NOT a repo dependency) and the
// chromium-1148 fallback below. Exits non-zero when any check fails.
// No real money moves: test adapter only.

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

async function mockRole(role) {
  const res = await fetch(`${MOCK}/__test/role?role=${role}`);
  const body = await res.json();
  check(`mock role switched to ${role}`, res.ok && body.role === role, JSON.stringify(body));
}

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

async function profileRole(userId) {
  const rows = await mockGet(`profiles?id=eq.${userId}&select=role`);
  return rows?.[0]?.role;
}

async function productRow(slug) {
  const rows = await mockGet(`products?slug=eq.${slug}&select=id,warranty,specifications`);
  return rows?.[0];
}

async function waitFor(fn, timeoutMs = 10000, stepMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return true;
    await sleep(stepMs);
  }
  return false;
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

/** Click an admin order button, waiting first for it to be enabled:
 *  the previous action's server round trip (audit + revalidate)
 *  finishes after the mock row flips, so clicking immediately after
 *  the status changes can catch the button still disabled. */
async function clickAdminButtonWhenReady(page, orderNumber, label) {
  const ready = await waitFor(async () => {
    const state = await page.evaluate(
      ({ orderNumber, label }) => {
        const p = [...document.querySelectorAll("p")].find((el) => el.textContent?.includes(`Order ${orderNumber}`));
        if (!p) return "no-card";
        let el = p;
        while (el) {
          const btn = [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
          if (btn) return btn.disabled ? "disabled" : "ready";
          el = el.parentElement;
        }
        return "no-button";
      },
      { orderNumber, label },
    );
    return state === "ready";
  });
  if (!ready) return false;
  return clickAdminButton(page, orderNumber, label);
}

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

async function adminHasStatusSelect(page, orderNumber) {
  return page.evaluate((num) => {
    const sel = document.querySelector(`select[aria-label="Change status for order ${num}"]`);
    return sel !== null;
  }, orderNumber);
}

/** Set an order's status through the manual selector in its admin card. */
async function setStatusViaSelect(page, orderNumber, target) {
  const sel = page.locator(`select[aria-label="Change status for order ${orderNumber}"]`);
  await sel.selectOption(target);
  await sleep(500);
}

async function clickGalleryTab(page, label) {
  const clicked = await page.evaluate((wanted) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(wanted));
    if (!b) return false;
    b.click();
    return true;
  }, label);
  await sleep(800);
  return clicked;
}

async function adminTabLabels(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="tablist"] [role="tab"]')].map((el) => el.textContent?.trim() ?? ""),
  );
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function tabBarScrolls(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('[role="tablist"]');
    if (!bar) return false;
    const style = window.getComputedStyle(bar);
    return (style.overflowX === "auto" || style.overflowX === "scroll") && bar.scrollWidth >= bar.clientWidth;
  });
}

async function main() {
  const browser = await launchBrowser();
  const pageErrors = [];
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // --- 1. Route smoke (logged out) ---
  for (const [path, want] of [["/", 200], ["/shop", 200], ["/cart", 200], ["/orders", 200]]) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
    check(`GET ${path} returns ${want}`, res?.status() === want, String(res?.status()));
  }
  const sellerRes = await page.goto(`${BASE}/seller`, { waitUntil: "networkidle0" });
  check("GET /seller returns 404", sellerRes?.status() === 404, String(sellerRes?.status()));
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await sleep(800);
  check("logged-out /admin redirects to sign-in", page.url().includes("/auth/sign-in"), page.url());

  // --- 2. Reviews, logged out: real rows only ---
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.setViewportSize({ width: 1280, height: 900 });
  guestPage.on("pageerror", (e) => pageErrors.push(`guest: ${e.message}`));
  await guestPage.goto(`${BASE}/product/apple-iphone-16-pro-256gb-natural-titanium`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("product page loads (iPhone)", (await text(guestPage)).includes("Apple iPhone 16 Pro"));
  check("reviews tab clicked (iPhone)", await clickGalleryTab(guestPage, "Reviews"));
  const iphoneReviews = await text(guestPage);
  check("reviews show the real average 4.5", iphoneReviews.includes("4.5"), iphoneReviews.slice(0, 400));
  check("reviews show 'Based on 2 real reviews'", iphoneReviews.includes("Based on 2 real reviews"));
  check("reviews show the real reviewer names", iphoneReviews.includes("Reviewer One") && iphoneReviews.includes("Reviewer Two"));
  check("reviews never show the fake seeded count", !iphoneReviews.includes("1,248") && !iphoneReviews.includes("1248"));
  check("logged-out visitor sees 'Sign in to write a review'", iphoneReviews.includes("Sign in to write a review"));
  check("logged-out visitor sees no review form", !iphoneReviews.includes("Write a review"));
  await guestPage.goto(`${BASE}/product/sony-wh-1000xm5`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("reviews tab clicked (Sony)", await clickGalleryTab(guestPage, "Reviews"));
  const sonyReviews = await text(guestPage);
  check("product with no reviews shows 'No reviews yet'", sonyReviews.includes("No reviews yet"), sonyReviews.slice(0, 400));
  check("product with no reviews shows no fake rating", !sonyReviews.includes("Based on 2 real reviews"));
  // Pre-edit warranty/specs state: defaults, no crash (migration
  // 0008 not yet applied to the mock rows — the columns are absent,
  // so the admin list must still render).
  await guestPage.goto(`${BASE}/product/apple-iphone-16-pro-256gb-natural-titanium`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("specs tab clicked (pre-edit)", await clickGalleryTab(guestPage, "Specifications"));
  check("no stored specs yet shows 'No specifications listed'", (await text(guestPage)).includes("No specifications listed"));
  await guest.close();

  // --- 3. Owner: tabs, stats, users ---
  await signIn(page);
  check("sign-in lands on /account", page.url().includes("/account"), page.url());
  check("signed-in user is the Owner in the mock", (await profileRole("user-1")) === "admin");
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const ownerTabs = await adminTabLabels(page);
  check("owner sees all four admin tabs", ["Overview", "Products", "Orders", "Users"].every((t) => ownerTabs.includes(t)), ownerTabs.join(" | "));
  const adminText = await text(page);
  check("overview shows the stats cards", adminText.includes("Total products") && adminText.includes("Total orders") && adminText.includes("Returned"));
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const productsText = await text(page);
  check("products tab lists live products (graceful pre-0008 fallback)", productsText.includes("Apple iPhone 16 Pro"), productsText.slice(0, 300));
  check("products tab has status tabs", productsText.includes("Active") && productsText.includes("Paused") && productsText.includes("Draft"));
  await page.goto(`${BASE}/admin?tab=users`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const usersText = await text(page);
  check("users tab lists the test accounts", usersText.includes("Reviewer One") && usersText.includes("Reviewer Two"), usersText.slice(0, 300));
  check("users tab has role tabs", usersText.includes("Owner") && usersText.includes("Manager") && usersText.includes("Customer"));
  check("owner sees a role-change control for another user", (await page.locator('select[aria-label="Change role for Reviewer One"]').count()) === 1);
  check("owner sees a Remove button for another user", await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Remove")));
  // Role change sticks (and is reverted so the mock stays clean).
  await page.locator('select[aria-label="Change role for Reviewer One"]').selectOption("manager");
  await sleep(2500);
  check("role change to Manager sticks in the mock DB", (await profileRole("user-2")) === "manager");
  check("role-change notice shows", (await text(page)).includes("Role for Reviewer One was changed to Manager."));
  await page.locator('select[aria-label="Change role for Reviewer One"]').selectOption("customer");
  await sleep(2500);
  check("role change back to Customer sticks", (await profileRole("user-2")) === "customer");
  // Remove asks for confirmation instead of deleting at once.
  const removeClicked = await page.evaluate(() => {
    const names = [...document.querySelectorAll("p, h3, h2, div")].filter(
      (el) => el.textContent?.trim() === "Reviewer One",
    );
    for (const el of names) {
      let node = el;
      while (node) {
        const btn = [...node.querySelectorAll("button")].find((b) => b.textContent.trim() === "Remove");
        if (btn) { btn.click(); return true; }
        node = node.parentElement;
      }
    }
    return false;
  });
  check("Remove opens a confirmation step", removeClicked);
  await sleep(800);
  check("confirmation offers 'Confirm remove' and 'Keep'", (await text(page)).includes("Confirm remove") && (await text(page)).includes("Keep"));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Keep");
    b && b.click();
  });
  await sleep(500);
  check("dismissing the confirmation leaves the user in place", (await profileRole("user-2")) === "customer");

  const stockBefore = await iphoneStock();
  check("mock iPhone stock reads before ordering", typeof stockBefore === "number", String(stockBefore));

  // --- 4. Manual selector: confirmed -> Returned (non-next jump) ---
  const codId = await placeCodOrder(page);
  check("COD order A is Confirmed in the mock DB", (await orderStatus(codId)) === "confirmed");
  check("COD order A decremented stock by 1", (await iphoneStock()) === stockBefore - 1, `stock ${await iphoneStock()}`);
  const numA = await adminOrderNumber(page, codId);
  await page.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const ordersText = await text(page);
  check("orders tab lists the new order", ordersText.includes(numA), ordersText.slice(0, 300));
  check("orders tab has status tabs with Returned", ordersText.includes("Returned"));
  check("owner sees the manual status selector", await adminHasStatusSelect(page, numA));
  check("owner sees the Advance button", await adminHasButton(page, numA, "Advance"));
  await setStatusViaSelect(page, numA, "returned");
  check(
    "manual selector jump to Returned sticks",
    await waitFor(async () => (await orderStatus(codId)) === "returned"),
    await orderStatus(codId),
  );
  const auditA = await auditFor(codId);
  check("exactly one audit row for the manual return", auditA.length === 1, JSON.stringify(auditA));
  check("audit row records confirmed -> returned", auditA[0]?.action === "order.status:confirmed->returned", JSON.stringify(auditA));
  check("returned order restored stock by 1", (await iphoneStock()) === stockBefore, `stock ${await iphoneStock()}`);
  // Returned is a status-tab filter too.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith("Returned"));
    b && b.click();
  });
  await sleep(800);
  check("Returned status tab shows the returned order", (await text(page)).includes(numA));
  await page.goto(`${BASE}/orders`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("customer /orders page has a Returned status tab", (await text(page)).includes("Returned"));

  // --- 5. Paid return: adapter-first refund, stock restored ---
  const cardId = await placeCardOrder(page);
  await clickTestPayOutcome(page, "Pay successfully");
  check("paid card order B lands on its order page", orderIdFromUrl(page.url()) === cardId, page.url());
  check("paid card order B is Confirmed in the mock DB", (await orderStatus(cardId)) === "confirmed");
  const paidBefore = await paymentsFor(cardId);
  check("one paid payments row after test payment", paidBefore.length === 1 && paidBefore[0].status === "paid", JSON.stringify(paidBefore));
  const numB = await adminOrderNumber(page, cardId);
  const stockBeforeB = await iphoneStock();
  await page.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("Advance moves B confirmed -> processing", await clickAdminButton(page, numB, "Advance"));
  check("B is processing", await waitFor(async () => (await orderStatus(cardId)) === "processing"));
  check("Advance moves B processing -> shipped", await clickAdminButtonWhenReady(page, numB, "Advance"));
  check("B is shipped", await waitFor(async () => (await orderStatus(cardId)) === "shipped"));
  await setStatusViaSelect(page, numB, "returned");
  check(
    "paid order set to Returned sticks",
    await waitFor(async () => (await orderStatus(cardId)) === "returned"),
    await orderStatus(cardId),
  );
  const paidAfter = await paymentsFor(cardId);
  check(
    "paid return appended a refunded row and kept the paid row paid",
    paidAfter.length === 2 && paidAfter.some((p) => p.status === "paid") && paidAfter.some((p) => p.status === "refunded"),
    JSON.stringify(paidAfter),
  );
  check("paid return restored stock by 1", (await iphoneStock()) === stockBeforeB + 1, `stock ${await iphoneStock()}`);
  await page.goto(`${BASE}/orders/${cardId}`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const detailB = await text(page);
  check("customer order page shows Returned as terminal", detailB.includes("Returned") && detailB.includes("was not received"), detailB.slice(0, 400));

  // --- 6. Warranty + specifications save in /admin, show on the page ---
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const editClicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll("p, h3, h2")].filter((el) => el.textContent?.includes("Apple iPhone 16 Pro"));
    for (const el of els) {
      let node = el;
      while (node) {
        const btn = [...node.querySelectorAll("button")].find((b) => b.textContent.trim() === "Edit");
        if (btn) { btn.click(); return true; }
        node = node.parentElement;
      }
    }
    return false;
  });
  check("Edit opens the iPhone form", editClicked);
  await sleep(800);
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("product-warranty", "2-year official warranty");
    const key = document.querySelector('input[aria-label="Specification 1 key"]');
    const val = document.querySelector('input[aria-label="Specification 1 value"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    if (key) { setter.call(key, "Display"); key.dispatchEvent(new Event("input", { bubbles: true })); }
    if (val) { setter.call(val, "6.1-inch OLED"); val.dispatchEvent(new Event("input", { bubbles: true })); }
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Save changes"));
    b && b.click();
  });
  await sleep(3000);
  check("product save shows the 'was updated' notice", (await text(page)).includes("was updated."), (await text(page)).slice(0, 300));
  const savedRow = await productRow("apple-iphone-16-pro-256gb-natural-titanium");
  check("warranty saved to the mock DB", savedRow?.warranty === "2-year official warranty", JSON.stringify(savedRow));
  check(
    "specifications saved to the mock DB",
    Array.isArray(savedRow?.specifications) && savedRow.specifications.some((s) => s.key === "Display" && s.value === "6.1-inch OLED"),
    JSON.stringify(savedRow),
  );
  await page.goto(`${BASE}/product/apple-iphone-16-pro-256gb-natural-titanium`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("warranty tab clicked (post-edit)", await clickGalleryTab(page, "Warranty"));
  check("product page shows the saved warranty", (await text(page)).includes("2-year official warranty"));
  check("specs tab clicked (post-edit)", await clickGalleryTab(page, "Specifications"));
  const specsText = await text(page);
  check("product page shows the saved specification", specsText.includes("Display") && specsText.includes("6.1-inch OLED"), specsText.slice(0, 400));

  // --- 7. Advance double-click: exactly one step, one audit row ---
  const stockBeforeC = await iphoneStock();
  const codC = await placeCodOrder(page);
  check("COD order C is Confirmed in the mock DB", (await orderStatus(codC)) === "confirmed");
  const numC = await adminOrderNumber(page, codC);
  await page.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
  await sleep(1200);
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
  }, numC);
  check("Advance double-clicked synchronously", doubleClicked === "clicked-twice", doubleClicked);
  await sleep(3000);
  check(
    "synchronous double-click moved exactly one step (confirmed -> processing)",
    (await orderStatus(codC)) === "processing",
    await orderStatus(codC),
  );
  const auditC = await auditFor(codC);
  check("exactly one audit row for the double-click", auditC.length === 1, JSON.stringify(auditC));

  // --- 8. Delivered order unlocks a real review ---
  check("Advance moves C processing -> shipped", await clickAdminButtonWhenReady(page, numC, "Advance"));
  check("C is shipped", await waitFor(async () => (await orderStatus(codC)) === "shipped"));
  check("Advance moves C shipped -> delivered", await clickAdminButtonWhenReady(page, numC, "Advance"));
  check("C is delivered", await waitFor(async () => (await orderStatus(codC)) === "delivered"));
  check("delivered order keeps stock decremented", (await iphoneStock()) === stockBeforeC - 1, `stock ${await iphoneStock()}`);
  await page.goto(`${BASE}/product/apple-iphone-16-pro-256gb-natural-titanium`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("reviews tab clicked (signed in)", await clickGalleryTab(page, "Reviews"));
  check("signed-in owner sees the review form", (await text(page)).includes("Write a review"));
  await page.locator("#review-rating").selectOption("5");
  await page.evaluate(() => {
    const el = document.getElementById("review-comment");
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, "E2E review: fast delivery, genuine product.");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Submit review"));
    b && b.click();
  });
  await sleep(3000);
  const afterReview = await text(page);
  check("review submit shows the thank-you notice", afterReview.includes("Thank you — your review was saved."), afterReview.slice(0, 400));
  check("submitted review appears in the list", afterReview.includes("E2E review: fast delivery, genuine product."));
  check("review count is now 3 real reviews", afterReview.includes("Based on 3 real reviews"), afterReview.slice(0, 400));
  check("review average updated to 4.7", afterReview.includes("4.7"));

  // --- 9. Manager: read-only orders, no Users tab, CAN Edit/Pause (2026-11-10) ---
  await mockRole("manager");
  await page.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const managerOrders = await text(page);
  check("manager still sees the orders list (staff listing fix)", managerOrders.includes(numC), managerOrders.slice(0, 300));
  check("manager sees the read-only notice", managerOrders.includes("Orders are read-only for your role"));
  check("manager sees no Advance button", !(await adminHasButton(page, numC, "Advance")));
  check("manager sees no status selector", !(await adminHasStatusSelect(page, numC)));
  check("manager sees no Users tab", !(await adminTabLabels(page)).some((t) => t === "Users"));
  await page.goto(`${BASE}/admin?tab=users`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("manager opening ?tab=users gets the owner-only message", (await text(page)).includes("Only the owner can view and manage users."));
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const managerProducts = await text(page);
  check("manager sees the Products tab", managerProducts.includes("Apple iPhone 16 Pro"));
  const managerButtons = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()));
  check("manager sees Edit buttons (2026-11-10: managers CAN edit)", managerButtons.includes("Edit"));
  check("manager sees Pause / Activate buttons (2026-11-10)", managerButtons.includes("Pause") || managerButtons.includes("Activate"));
  check("manager still sees the Add product form", managerButtons.includes("Add product"));
  check("manager still sees Delete buttons", managerButtons.includes("Delete"));

  // --- 10. Co-admin: no Users tab, but CAN advance an order ---
  await mockRole("co_admin");
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("co-admin sees no Users tab", !(await adminTabLabels(page)).some((t) => t === "Users"));
  await page.goto(`${BASE}/admin?tab=users`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("co-admin opening ?tab=users gets the owner-only message", (await text(page)).includes("Only the owner can view and manage users."));
  const codD = await placeCodOrder(page);
  check("COD order D is Confirmed in the mock DB", (await orderStatus(codD)) === "confirmed");
  const numD = await adminOrderNumber(page, codD);
  await page.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("co-admin sees the Advance button", await adminHasButton(page, numD, "Advance"));
  check("co-admin sees the manual status selector", await adminHasStatusSelect(page, numD));
  check("co-admin Advance moves D confirmed -> processing", await clickAdminButton(page, numD, "Advance"));
  check("D is processing", await waitFor(async () => (await orderStatus(codD)) === "processing"));

  // --- 11. Customer: /admin redirects away ---
  await mockRole("customer");
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await sleep(1000);
  check("customer is redirected off /admin", !page.url().includes("/admin"), page.url());

  // --- 12. Responsiveness: 1440 / 1280 / 390 ---
  await mockRole("admin");
  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/admin?tab=orders", "/admin?tab=products", "/product/apple-iphone-16-pro-256gb-natural-titanium"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
      await sleep(1000);
      check(`no horizontal overflow at ${width}px on ${path}`, await noHorizontalOverflow(page));
    }
    await page.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
    await sleep(800);
    check(`admin tab row scrolls instead of overflowing at ${width}px`, await tabBarScrolls(page));
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  check("no page JS errors during the whole run", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 500));
  await browser.close();

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED: ${failures.join(", ")}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ROLES-ADMIN-TABS SCRIPT FAILED:", e);
  process.exit(1);
});
