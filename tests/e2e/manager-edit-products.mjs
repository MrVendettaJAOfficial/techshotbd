// TechShot manager edit-products verification (Playwright, mock Supabase).
//
// ONE combined run for the 2026-11-10 manager-edit change:
//   1. route smoke: /, /shop, /cart, /admin, /orders OK, /seller 404
//   2. owner places a COD order (so the manager orders tab has a
//      real order to be read-only about)
//   3. manager: CAN edit a product end to end in the admin UI —
//      Edit opens the form, changing title + price saves, the new
//      title/price land in the mock DB; Pause hides the product
//      from /shop, Activate brings it back; the edit is then
//      reverted so the seed catalogue is unchanged
//   4. manager: still CANNOT change orders (no Advance button, no
//      status selector, read-only notice) and still cannot open
//      Users (?tab=users shows the owner-only message)
//   5. customer: /admin redirects away; owner/co-admin flows are
//      unchanged (owner still sees Advance + Users)
//   6. responsiveness at 1440 / 1280 / 390: no horizontal overflow
//      on /admin?tab=products, zero page JS errors
//
// Run (see README, "End-to-end checks"):
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 MOCK_URL=http://127.0.0.1:3101 node tests/e2e/manager-edit-products.mjs
//
// The mock's GET /__test/role?role=X switches user-1's profile role
// at runtime. The mock has no RLS, so this run proves the app-level
// gates (lib/roles.ts + server actions + admin UI); the database
// rule itself is migration 0010, which must be applied live in the
// SQL Editor after the push (see the migration header). Exits
// non-zero when any check fails. No real money moves.

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

async function waitFor(fn, timeoutMs = 10000, stepMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return true;
    await sleep(stepMs);
  }
  return false;
}

const IPHONE_SLUG = "apple-iphone-16-pro-256gb-natural-titanium";
const ORIGINAL_TITLE = "Apple iPhone 16 Pro 256GB Natural Titanium";
const EDITED_TITLE = "Apple iPhone 16 Pro 256GB Natural Titanium Manager Edit";

async function productRow() {
  const rows = await mockGet(`products?slug=eq.${IPHONE_SLUG}&select=id,title,slug,price_poisha,status`);
  return rows?.[0];
}

async function productRowByTitle(title) {
  const rows = await mockGet(`products?select=id,title,slug,price_poisha,status&title=eq.${encodeURIComponent(title)}`);
  return rows?.[0];
}

async function orderStatus(orderId) {
  const rows = await mockGet(`orders?id=eq.${orderId}&select=status`);
  return rows?.[0]?.status;
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

// --- browser helpers (same selectors as tests/e2e/roles-admin-tabs.mjs) ---
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

function orderIdFromUrl(url) {
  const m = url.match(/\/orders\/([^/?]+)/);
  return m ? m[1] : "";
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
  const id = orderIdFromUrl(page.url());
  check("COD order lands on its order page", id.length > 0, page.url());
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

/** Click a product button, retrying while the list remounts: after
 *  Pause / Activate the list refreshes (router.refresh()), and a
 *  click landing mid-remount finds no card — retry until it lands. */
async function clickProductButtonWhenReady(page, title, label) {
  return waitFor(async () => (await clickProductButton(page, title, label)) === true);
}
async function clickProductButton(page, title, label) {
  return page.evaluate(
    ({ title, label }) => {
      const p = [...document.querySelectorAll("p")].find((el) => el.textContent?.includes(title));
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
    { title, label },
  );
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
  return page.evaluate(({ orderNumber }) => {
    const p = [...document.querySelectorAll("p")].find((el) => el.textContent?.includes(`Order ${orderNumber}`));
    if (!p) return false;
    let el = p;
    while (el) {
      if (el.querySelector("select")) return true;
      el = el.parentElement;
    }
    return false;
  }, { orderNumber });
}

async function adminTabLabels(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="tablist"] [role="tab"]')].map((el) => el.textContent?.trim() ?? ""),
  );
}

async function setInput(page, id, value) {
  await page.evaluate(
    ({ id, value }) => {
      const el = document.getElementById(id);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { id, value },
  );
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

  // --- 2. Owner places a COD order ---
  await signIn(page);
  check("sign-in lands on /account", page.url().includes("/account"), page.url());
  check("signed-in user is the Owner in the mock", (await mockGet("profiles?id=eq.user-1&select=role"))?.[0]?.role === "admin");
  const orderId = await placeCodOrder(page);
  const num = await adminOrderNumber(page, orderId);
  check("COD order has an order number", num.length > 0, num);

  const before = await productRow();
  check("iPhone seed row exists in the mock", !!before, JSON.stringify(before));
  const originalPriceTaka = Math.round(before.price_poisha / 100);
  const editedPriceTaka = originalPriceTaka + 1;

  // --- 3. Manager edits the product end to end ---
  await mockRole("manager");
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const managerProducts = await text(page);
  check("manager sees the Products tab with the iPhone", managerProducts.includes("Apple iPhone 16 Pro"));
  const managerButtons = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()));
  check("manager sees Edit buttons", managerButtons.includes("Edit"));
  check("manager sees Pause buttons", managerButtons.includes("Pause"));

  check("manager clicks Edit on the iPhone", await clickProductButton(page, ORIGINAL_TITLE, "Edit"));
  await sleep(800);
  check("edit populates the form title", (await page.evaluate(() => document.getElementById("product-title")?.value)) === ORIGINAL_TITLE);
  await setInput(page, "product-title", EDITED_TITLE);
  await setInput(page, "product-price", String(editedPriceTaka));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Save changes"));
    b && b.click();
  });
  await sleep(2500);
  check(
    "manager edit shows the updated notice",
    await waitFor(async () => (await text(page)).includes(`"${EDITED_TITLE}" was updated.`)),
  );
  const edited = await productRowByTitle(EDITED_TITLE);
  check("manager edit changed the title in the DB", !!edited, JSON.stringify(edited));
  check("manager edit changed the price in the DB", edited?.price_poisha === editedPriceTaka * 100, String(edited?.price_poisha));

  // --- Pause hides it from shoppers; Activate brings it back ---
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("manager clicks Pause on the edited product", await clickProductButton(page, EDITED_TITLE, "Pause"));
  check("product is paused in the DB", await waitFor(async () => (await productRowByTitle(EDITED_TITLE))?.status === "paused"));
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle0" });
  await sleep(1000);
  check("paused product is hidden from /shop", !(await text(page)).includes(EDITED_TITLE));
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("manager clicks Activate on the paused product", await clickProductButton(page, EDITED_TITLE, "Activate"));
  check("product is active again in the DB", await waitFor(async () => (await productRowByTitle(EDITED_TITLE))?.status === "active"));

  // --- Revert the edit so the seed catalogue is unchanged ---
  // The Activate above refreshes the list (router.refresh()), so
  // retry the click until the remount lands.
  check("manager clicks Edit to revert", await clickProductButtonWhenReady(page, EDITED_TITLE, "Edit"));
  await sleep(800);
  await setInput(page, "product-title", ORIGINAL_TITLE);
  await setInput(page, "product-price", String(originalPriceTaka));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Save changes"));
    b && b.click();
  });
  await sleep(2500);
  check(
    "revert shows the updated notice",
    await waitFor(async () => (await text(page)).includes(`"${ORIGINAL_TITLE}" was updated.`)),
  );
  const reverted = await productRowByTitle(ORIGINAL_TITLE);
  check("title is back to the original in the DB", reverted?.title === ORIGINAL_TITLE, reverted?.title ?? "");
  check("price is back to the original in the DB", reverted?.price_poisha === before.price_poisha, String(reverted?.price_poisha));
  check("status is back to active in the DB", reverted?.status === "active", reverted?.status ?? "");
  check("slug is back to the original in the DB", reverted?.slug === IPHONE_SLUG, reverted?.slug ?? "");
  // A COD order is confirmed at checkout (paid card orders are
  // pending_payment until the test payment succeeds); the manager
  // edit must not have moved it.
  check("order is still confirmed (manager edit touched no order)", (await orderStatus(orderId)) === "confirmed");

  // --- 4. Manager still cannot change orders or open Users ---
  await page.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const managerOrders = await text(page);
  check("manager still sees the orders list", managerOrders.includes(num), managerOrders.slice(0, 300));
  check("manager sees the read-only notice", managerOrders.includes("Orders are read-only for your role"));
  check("manager sees no Advance button", !(await adminHasButton(page, num, "Advance")));
  check("manager sees no status selector", !(await adminHasStatusSelect(page, num)));
  check("manager sees no Users tab", !(await adminTabLabels(page)).some((t) => t === "Users"));
  await page.goto(`${BASE}/admin?tab=users`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("manager opening ?tab=users gets the owner-only message", (await text(page)).includes("Only the owner can view and manage users."));

  // --- 5. Customer cannot reach /admin; owner flows unchanged ---
  await mockRole("customer");
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await sleep(1000);
  check("customer is redirected off /admin", !page.url().includes("/admin"), page.url());
  await mockRole("admin");
  await page.goto(`${BASE}/admin?tab=orders`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("owner still sees the Advance button", await adminHasButton(page, num, "Advance"));
  check("owner still sees the Users tab", (await adminTabLabels(page)).includes("Users"));

  // --- 6. Responsiveness: 1440 / 1280 / 390 ---
  await mockRole("manager");
  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
    await sleep(1000);
    check(`no horizontal overflow at ${width}px on /admin?tab=products`, await noHorizontalOverflow(page));
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  check("no page JS errors during the whole run", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 500));
  await browser.close();

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED: ${failures.join(", ")}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("MANAGER-EDIT-PRODUCTS SCRIPT FAILED:", e);
  process.exit(1);
});
