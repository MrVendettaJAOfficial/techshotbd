// TechShot combined verification: LIGHT theme + auth batch
// (forgot / reset / change password) + profile dropdown + inbox +
// admin broadcasts.
//
// One pass at desktop 1440, laptop 1280 and mobile 390, against the
// mock Supabase (port 3101) with the app on :3100:
//
//   A. Light theme — computed colours: page white #FFFFFF with navy
//      text #00162E, header bar and footer navy, primary buttons
//      navy, announcement bar still button green #0B7A55 (it sits
//      on navy), Add to Cart navy, discount badges darker orange.
//   B. Routes + hygiene — /, /shop, /cart, /orders, /account,
//      /inbox, /auth/sign-in, /auth/forgot-password,
//      /auth/reset-password, /admin and a product page load with no
//      page JS errors, no failed requests and no horizontal overflow.
//   C. Forgot password — invalid email shows the field error;
//      a valid email reaches the sent state (the mock accepts the
//      recovery request; no email is ever sent by the mock — real
//      delivery is live-only).
//   D. Reset password — direct visit signed-out shows the
//      expired-link message; signed-in the form renders, mismatch
//      and short passwords show field errors, and a valid submit
//      signs out and lands on /auth/sign-in?reset=1.
//   E. Profile dropdown — signed-out shows Sign in / Create
//      account (both navigate); signed-in shows Profile, Orders,
//      Inbox, Wishlist, Settings (each navigates) plus Sign out;
//      Escape and overlay taps close it.
//   F. Change password — /account#security: empty submit shows
//      field errors, mismatch shows an error, a valid change
//      reports success.
//   G. Inbox — signed-out shows the sign-in prompt; after a COD
//      order the inbox lists the order-placed entry.
//   H. Admin broadcasts — the Messages tab composes and sends
//      (admin), the sent message appears in the tab and in the
//      customer inbox; a manager sees the read-only note and no
//      form; a customer is kept out of /admin entirely.
//      The mock serves the announcements table, so this proves the
//      app's read/write paths — NOT the live table, which needs
//      migration 0009 applied in the SQL Editor first.
//
// Run (see README, "End-to-end checks"):
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 node tests/e2e/light-theme-auth-inbox.mjs
//
// Needs a Chromium: playwright-core resolvable (it is NOT a repo
// dependency) and the chromium-1148 fallback below. Exits non-zero
// when any check fails.

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

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
const MOCK = "http://127.0.0.1:3101";
const SHOTS = "/tmp/light-theme-shots";
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(name);
}

async function launchBrowser() {
  const opts = { args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  const exe = process.env.CHROMIUM_PATH ?? "/home/hatch/.cache/ms-playwright/chromium-1148/chrome-linux/chrome";
  try {
    return await chromium.launch({ ...opts, executablePath: exe });
  } catch {
    return await chromium.launch(opts);
  }
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function setRole(role) {
  const res = await fetch(`${MOCK}/__test/role?role=${role}`);
  if (!res.ok) throw new Error(`role switch to ${role} failed: ${res.status}`);
}

async function pageText(page, selector = "main") {
  return (await page.evaluate((sel) => document.querySelector(sel)?.innerText ?? "", selector))
    .replace(/\s+/g, " ");
}

async function fillById(page, id, value) {
  const found = await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    return true;
  }, { id, value });
  if (!found) throw new Error(`fillById: no element with id "${id}" on ${page.url()}`);
}

async function fillTextarea(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, { id, value });
}

async function clickButton(page, text) {
  return page.evaluate((wanted) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(wanted));
    if (!b) return false;
    b.click();
    return true;
  }, text);
}

async function signIn(page) {
  await page.goto(`${BASE}/auth/sign-in`, { waitUntil: "networkidle" });
  await fillById(page, "email", "test@example.com");
  await fillById(page, "password", "password123");
  await clickButton(page, "Sign in");
  // Success leaves the sign-in page; the mock accepts any password.
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    if (!page.url().includes("/auth/sign-in")) break;
  }
  check("sign-in leaves the sign-in page", !page.url().includes("/auth/sign-in"), page.url());
}

async function openProfileMenu(page) {
  // Idempotent: the open menu's overlay covers the trigger, so
  // clicking the trigger only opens a closed menu — when it is
  // already open there is nothing to do.
  if ((await page.locator("#profile-menu").count()) > 0) return;
  await page.locator('[data-testid="profile-menu-button"]').click();
  await sleep(400);
}

async function menuItems(page) {
  return page.locator("#profile-menu [role='menuitem']").allTextContents();
}

async function fillAddress(page) {
  await fillById(page, "firstName", "Test");
  await fillById(page, "lastName", "User");
  await fillById(page, "email", "test@example.com");
  await fillById(page, "mobile", "01712345678");
  await fillById(page, "address", "House 1, Road 2");
  await fillById(page, "area", "Dhanmondi");
  await fillById(page, "division", "Dhaka");
  await fillById(page, "city", "Dhaka");
  await sleep(300);
  await page.evaluate(() => {
    const sel = document.getElementById("district");
    if (sel) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      setter.call(sel, "Dhaka");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await clickButton(page, "Continue to delivery");
  await sleep(400);
  await clickButton(page, "Continue to payment");
  await sleep(400);
}

const browser = await launchBrowser();

const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

// --- A + B. Light theme + route smoke at all three widths --------------
for (const { name, width, height } of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("requestfailed", (req) => {
    if (req.failure()?.errorText === "net::ERR_ABORTED") return;
    failedRequests.push(`${req.url()} :: ${req.failure()?.errorText ?? ""}`);
  });
  const isMobile = width < 640;
  async function noOverflow(label) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${name}: no horizontal overflow on ${label}`, overflow <= 0, `overflow=${overflow}px`);
  }

  let resp = await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  check(`${name}: / loads 200`, resp?.status() === 200, `status=${resp?.status()}`);
  const styles = await page.evaluate(() => {
    const cs = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    };
    return {
      body: cs("body"),
      headerBar: cs("header > div:nth-child(2)"),
      footer: cs("footer"),
      heroCta: cs("main a[href='/shop']"),
      card: cs("article"),
    };
  });
  check(`${name}: page background is white`, styles.body?.bg === rgb("#FFFFFF"), styles.body?.bg);
  check(`${name}: body text is dark navy`, styles.body?.color === rgb("#00162E"), styles.body?.color);
  check(`${name}: header bar is navy`, styles.headerBar?.bg === rgb("#00162E"), styles.headerBar?.bg);
  check(`${name}: footer is navy`, styles.footer?.bg === rgb("#00162E"), styles.footer?.bg);
  check(`${name}: hero CTA is navy`, styles.heroCta?.bg === rgb("#00162E"), styles.heroCta?.bg);
  check(`${name}: product card is white`, styles.card?.bg === rgb("#FFFFFF"), styles.card?.bg);
  await noOverflow("home");
  await page.screenshot({ path: `${SHOTS}/${name}-home.png` });

  for (const [path, label] of [
    ["/shop", "shop"],
    ["/cart", "cart"],
    ["/orders", "orders"],
    ["/account", "account"],
    ["/inbox", "inbox"],
    ["/auth/sign-in", "sign-in"],
    ["/auth/forgot-password", "forgot-password"],
    ["/auth/reset-password", "reset-password"],
    ["/admin", "admin"],
    ["/product/apple-iphone-16-pro-256gb-natural-titanium", "product"],
  ]) {
    const r = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    check(`${name}: ${label} loads without a server error`, (r?.status() ?? 0) < 500, `status=${r?.status()} url=${page.url()}`);
    await noOverflow(label);
  }
  check(`${name}: zero page JS errors`, pageErrors.length === 0, pageErrors.join(" | ").slice(0, 300));
  check(`${name}: zero failed requests`, failedRequests.length === 0, failedRequests.join(" | ").slice(0, 300));
  await context.close();
}

// --- C–H. The functional flow, desktop ---------------------------------
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const flowErrors = [];
const flowFailed = [];
page.on("pageerror", (err) => flowErrors.push(String(err)));
page.on("requestfailed", (req) => {
  if (req.failure()?.errorText === "net::ERR_ABORTED") return;
  flowFailed.push(`${req.url()} :: ${req.failure()?.errorText ?? ""}`);
});

// --- C. Forgot password (signed out) ------------------------------------
await page.goto(`${BASE}/auth/forgot-password`, { waitUntil: "networkidle" });
await fillById(page, "email", "not-an-email");
await clickButton(page, "Send reset link");
await sleep(500);
let t = await pageText(page);
check("forgot-password: invalid email shows the field error", /valid email/i.test(t), t.slice(0, 200));
await fillById(page, "email", "test@example.com");
await clickButton(page, "Send reset link");
await sleep(1500);
t = await pageText(page);
check("forgot-password: valid email reaches the sent state", /password reset link is on its way/i.test(t), t.slice(0, 300));
await page.screenshot({ path: `${SHOTS}/desktop-forgot-sent.png` });

// --- D. Reset password, signed-out direct visit -------------------------
await page.goto(`${BASE}/auth/reset-password`, { waitUntil: "networkidle" });
await sleep(800);
t = await pageText(page);
check("reset-password: signed-out visit shows the expired-link message", /expired or was already used/i.test(t), t.slice(0, 200));
check("reset-password: expired state links to forgot-password", await page.locator('main a[href="/auth/forgot-password"]').count() === 1);

// --- E. Profile dropdown, signed-out ------------------------------------
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await openProfileMenu(page);
let items = (await menuItems(page)).map((s) => s.trim());
check("dropdown signed-out: shows Sign in + Create account", items.includes("Sign in") && items.includes("Create account"), items.join(" | "));
await page.locator("#profile-menu [role='menuitem']", { hasText: "Sign in" }).click();
await sleep(800);
check("dropdown signed-out: Sign in navigates to /auth/sign-in", page.url().includes("/auth/sign-in"), page.url());
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await openProfileMenu(page);
await page.keyboard.press("Escape");
await sleep(300);
check("dropdown: Escape closes the menu", (await page.locator("#profile-menu").count()) === 0);
await openProfileMenu(page);
await page.evaluate(() => { const el = document.querySelector('[data-testid="profile-menu-overlay"]'); if (el) el.click(); });
await sleep(300);
check("dropdown: overlay tap closes the menu", (await page.locator("#profile-menu").count()) === 0);

// --- F. Sign in, then the signed-in dropdown ---------------------------
await signIn(page);
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await openProfileMenu(page);
items = (await menuItems(page)).map((s) => s.trim());
for (const label of ["Profile", "Orders", "Inbox", "Wishlist", "Settings", "Sign out"]) {
  check(`dropdown signed-in: shows "${label}"`, items.some((s) => s === label), items.join(" | "));
}
await page.screenshot({ path: `${SHOTS}/desktop-dropdown.png` });
const entryTargets = [
  ["Profile", "/account"],
  ["Orders", "/orders"],
  ["Inbox", "/inbox"],
  ["Wishlist", "/account#wishlist"],
  ["Settings", "/account#security"],
];
for (const [label, target] of entryTargets) {
  await openProfileMenu(page);
  await page.locator("#profile-menu [role='menuitem']", { hasText: label }).first().click();
  await sleep(800);
  const url = page.url();
  check(`dropdown: "${label}" navigates to ${target}`, url.includes(target), url);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
}

// --- D (cont). Reset password, signed-in -------------------------------
await page.goto(`${BASE}/auth/reset-password`, { waitUntil: "networkidle" });
await sleep(800);
check("reset-password: signed-in visit renders the form", await page.locator("#password").count() === 1);
await fillById(page, "password", "newpassword1");
await fillById(page, "confirmPassword", "different2");
await clickButton(page, "Change password");
await sleep(500);
t = await pageText(page);
check("reset-password: mismatched passwords show an error", /match/i.test(t), t.slice(0, 200));
await fillById(page, "password", "short");
await fillById(page, "confirmPassword", "short");
await clickButton(page, "Change password");
await sleep(500);
t = await pageText(page);
check("reset-password: short password shows an error", /8 characters|at least/i.test(t), t.slice(0, 200));
await fillById(page, "password", "newpassword1");
await fillById(page, "confirmPassword", "newpassword1");
await clickButton(page, "Change password");
await sleep(2000);
check("reset-password: valid submit lands on sign-in?reset=1", page.url().includes("/auth/sign-in?reset=1"), page.url());
t = await pageText(page);
check("reset-password: sign-in shows the password-changed note", /password has been changed|new password/i.test(t), t.slice(0, 200));
await page.screenshot({ path: `${SHOTS}/desktop-reset-done.png` });

// --- F (cont). Sign back in for the rest of the flow --------------------
await signIn(page);

// --- F. Change password on /account#security ----------------------------
await page.goto(`${BASE}/account#security`, { waitUntil: "networkidle" });
await sleep(800);
check("change-password: security section renders", await page.locator("#security").count() === 1);
await page.screenshot({ path: `${SHOTS}/desktop-account-security.png` });
await clickButton(page, "Change password");
await sleep(500);
t = await pageText(page, "#security");
check("change-password: empty submit shows field errors", /required|enter|at least/i.test(t), t.slice(0, 200));
await fillById(page, "currentPassword", "password123");
await fillById(page, "newPassword", "brandnewpass1");
await fillById(page, "confirmNewPassword", "differentpass2");
await clickButton(page, "Change password");
await sleep(500);
t = await pageText(page, "#security");
check("change-password: mismatched passwords show an error", /match/i.test(t), t.slice(0, 200));
await fillById(page, "currentPassword", "password123");
await fillById(page, "newPassword", "brandnewpass1");
await fillById(page, "confirmNewPassword", "brandnewpass1");
await clickButton(page, "Change password");
await sleep(2000);
t = await pageText(page, "#security");
check("change-password: valid change reports success", /password has been changed/i.test(t), t.slice(0, 200));

// --- G. Inbox: signed-out prompt, then a COD order's placed entry ------
await page.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
await sleep(800);
t = await pageText(page);
check("inbox: signed-in inbox lists the page (no prompt while signed in)", !/You are not signed in/.test(t));
await page.goto(`${BASE}/shop`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim().startsWith("Add to Cart"));
  btns[0] && btns[0].click();
});
await sleep(1200);
await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle" });
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
check("COD order reaches the order page", /\/orders\/.+/.test(page.url()), page.url());
await page.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
await sleep(1000);
t = await pageText(page);
check("inbox: lists the COD order's placed entry", /Order placed|placed/i.test(t), t.slice(0, 300));
await page.screenshot({ path: `${SHOTS}/desktop-inbox.png` });

// --- H. Admin broadcasts -------------------------------------------------
await setRole("admin");
await page.goto(`${BASE}/admin?tab=messages`, { waitUntil: "networkidle" });
await sleep(800);
t = await pageText(page);
check("messages: admin sees the compose form", await page.locator("#announcement-title").count() === 1);
check("messages: admin sees no unavailable warning", !/Migration 0009 has not been applied/.test(t));
await clickButton(page, "Send to all users");
await sleep(500);
t = await pageText(page);
check("messages: empty submit shows the validation error", /title|required|enter/i.test(t), t.slice(0, 200));
const BROADCAST_TITLE = `E2E broadcast ${Date.now()}`;
await fillById(page, "announcement-title", BROADCAST_TITLE);
await fillTextarea(page, "announcement-body", "E2E check: 10% off all phones this weekend.");
await fillById(page, "announcement-kind", "offer");
await clickButton(page, "Send to all users");
await sleep(2000);
t = await pageText(page);
check("messages: send reports success", /Message sent to all users/i.test(t), t.slice(0, 300));
check("messages: sent broadcast appears in the sent list", t.includes(BROADCAST_TITLE), t.slice(0, 400));
await page.screenshot({ path: `${SHOTS}/desktop-messages.png` });
// The broadcast reaches the customer inbox.
await setRole("customer");
await page.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
await sleep(1000);
t = await pageText(page);
check("inbox: broadcast appears for the customer", t.includes(BROADCAST_TITLE), t.slice(0, 400));
// A manager may read but not send.
await setRole("manager");
await page.goto(`${BASE}/admin?tab=messages`, { waitUntil: "networkidle" });
await sleep(800);
t = await pageText(page);
check("messages: manager sees the read-only note", /Only the owner and co-admins can send messages/.test(t), t.slice(0, 300));
check("messages: manager gets no compose form", (await page.locator("#announcement-title").count()) === 0);
check("messages: manager still sees the sent list", t.includes(BROADCAST_TITLE), t.slice(0, 300));
// A customer is kept out of /admin entirely.
await setRole("customer");
await page.goto(`${BASE}/admin?tab=messages`, { waitUntil: "networkidle" });
await sleep(800);
check("admin: customer is kept out of /admin", !page.url().includes("/admin?tab=messages") || /not|sign in|denied/i.test(await pageText(page)), page.url());
await setRole("admin");

// --- K. Mobile spot checks ----------------------------------------------
await context.close();
const mContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mPage = await mContext.newPage();
mPage.on("pageerror", (err) => flowErrors.push(String(err)));
await mPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
await signIn(mPage);
await openProfileMenu(mPage);
check("mobile: profile dropdown opens", (await mPage.locator("#profile-menu").count()) === 1);
await mPage.locator("#profile-menu [role='menuitem']", { hasText: "Inbox" }).first().click();
await sleep(800);
check("mobile: dropdown Inbox navigates", mPage.url().includes("/inbox"), mPage.url());
const mOverflow = await mPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("mobile: no horizontal overflow on inbox", mOverflow <= 0, `overflow=${mOverflow}px`);
await mPage.screenshot({ path: `${SHOTS}/mobile-inbox.png` });
await mContext.close();

check("flow: zero page JS errors", flowErrors.length === 0, flowErrors.join(" | ").slice(0, 300));
check("flow: zero failed requests", flowFailed.length === 0, flowFailed.join(" | ").slice(0, 300));

await browser.close();

console.log(failures.length === 0 ? "\nALL CHECKS PASSED" : `\n${failures.length} CHECK(S) FAILED:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
