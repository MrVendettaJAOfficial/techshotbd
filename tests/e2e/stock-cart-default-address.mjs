// TechShot Ponytail findings 3, 4 and 6 — Playwright checks
// (mock Supabase, customer mode).
//
//   Finding 4 — an over-stock cart line (quantity 7 of a product
//     with stock 6) must be VISIBLE before checkout: /cart shows
//     the stock alert next to the unknownSlugs alert, the line has
//     no price / line total, the subtotal and the free-delivery
//     banner are computed without it, and the mini-cart drawer
//     shows the same alert. Checkout blocking itself is unchanged
//     (covered by tests/e2e/checkout-atomicity.mjs).
//   Finding 6 — "Set as default" must work for a server-loaded
//     address: after adding two addresses through /account, clicking
//     "Set as default" on the non-default one moves the Default
//     badge to it, with no "Please fix the highlighted address
//     fields" error. The add-new-address flow still collects an
//     email (the form opens with the signed-in user's email
//     prefilled).
//
// Run (see README, "End-to-end checks") — fresh mock per run:
//   Mock:      node tests/e2e/mock-supabase.mjs  (port 3101, no MOCK_ADMIN)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 node tests/e2e/stock-cart-default-address.mjs
//
// The over-stock line is the Sony Alpha ZV-E10 II (mock stock 6),
// seeded as a guest cart in localStorage with quantity 7 — the
// guest cart is the simplest way to put an over-stock line in the
// cart without a checkout, and the priced lines resolve through
// the live mock database, so the stock error comes from the real
// getPricedCartLines path. Runs at desktop 1440, laptop 1280 and
// mobile 390, with no horizontal overflow at any width.
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

async function pageText(page, selector = "main") {
  return (await page.evaluate((sel) => document.querySelector(sel)?.innerText ?? "", selector)).replace(/\s+/g, " ");
}

async function fillById(page, id, value) {
  await page.evaluate(({ id: field, value: v }) => {
    const el = document.getElementById(field);
    if (!el) return;
    const proto = el.tagName === "SELECT"
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
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
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    if (!page.url().includes("/auth/sign-in")) break;
  }
  check("sign-in leaves the sign-in page", !page.url().includes("/auth/sign-in"), page.url());
}

// Fill the /account address form (ids addrLabel / addrFirstName /
// addrLastName / addrEmail / addrMobile / addrStreet / addrArea /
// addrDivision / addrDistrict / addrCity) and submit it.
async function addAddress(page, label) {
  await clickButton(page, "Add address");
  await sleep(500);
  await fillById(page, "addrLabel", label);
  await fillById(page, "addrFirstName", "Test");
  await fillById(page, "addrLastName", "User");
  await fillById(page, "addrMobile", "01712345678");
  await fillById(page, "addrStreet", "House 1, Road 2");
  await fillById(page, "addrArea", "Dhanmondi");
  await fillById(page, "addrDivision", "Dhaka");
  await sleep(300);
  await fillById(page, "addrDistrict", "Dhaka");
  await fillById(page, "addrCity", "Dhaka");
  const email = await page.evaluate(() => document.getElementById("addrEmail")?.value ?? "");
  check(`add-address (${label}): email is prefilled from the signed-in user`, email === "test@example.com", email);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Add address"));
    b && b.click();
  });
  await page.waitForFunction(
    (wanted) => document.querySelector("main")?.innerText.includes(wanted),
    "Address added.",
    { timeout: 15000 },
  );
  check(`add-address (${label}): saved`, (await pageText(page)).includes("Address added."));
}

const VIEWPORTS = [
  { name: "desktop 1440", width: 1440, height: 900 },
  { name: "laptop 1280", width: 1280, height: 800 },
  { name: "mobile 390", width: 390, height: 844 },
];

const browser = await launchBrowser();

for (const vp of VIEWPORTS) {
  console.log(`\n--- ${vp.name} ---`);
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();

  // --- Finding 4: over-stock line, as a guest -------------------------
  // Sony Alpha ZV-E10 II has mock stock 6; quantity 7 is over stock.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.localStorage.setItem(
      "techshot-cart-v1",
      JSON.stringify({ userId: null, items: [{ slug: "sony-alpha-zv-e10-ii", quantity: 7 }] }),
    );
  });
  await page.goto(`${BASE}/cart`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector("main")?.innerText.includes("only 6 in stock"),
    null,
    { timeout: 15000 },
  );
  const cartText = await pageText(page);
  check(`[${vp.name}] /cart shows the over-stock alert`, cartText.includes("Some items exceed available stock"), cartText.slice(0, 200));
  check(`[${vp.name}] /cart names the stock shortfall`, cartText.includes("Sony Alpha ZV-E10 II: only 6 in stock, you asked for 7."), cartText.slice(0, 300));
  check(`[${vp.name}] /cart shows the over-stock item itself`, cartText.includes("Sony Alpha ZV-E10 II"));
  // The dropped line carries no price: its row shows the quantity
  // but no line total, the subtotal excludes it (৳0), and the
  // free-delivery banner is computed without it (৳999 to go).
  check(`[${vp.name}] /cart free-delivery banner excludes the over-stock line`, cartText.includes("Add ৳999 more to unlock FREE delivery."), cartText.slice(0, 300));
  const overflowCart = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`[${vp.name}] /cart has no horizontal overflow`, !overflowCart);

  // Mini-cart drawer: same alert, same wording.
  await page.evaluate(() => {
    const b = document.querySelector('[aria-label^="Cart"]');
    b && b.click();
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const drawerText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText.replace(/\s+/g, " ") ?? "");
  check(`[${vp.name}] mini-cart shows the over-stock alert`, drawerText.includes("Some items exceed available stock"), drawerText.slice(0, 200));
  check(`[${vp.name}] mini-cart names the stock shortfall`, drawerText.includes("only 6 in stock, you asked for 7."), drawerText.slice(0, 300));
  await page.keyboard.press("Escape");
  await sleep(500);

  // --- Finding 6: Set as default, signed in ---------------------------
  await signIn(page);
  await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
  await sleep(1500);
  // How many addresses are already listed (earlier viewports in
  // this run added theirs to the same mock): the two new ones must
  // both be rendered before the click, or the click can land on
  // the first new card while the second is still loading and the
  // badge assertion below reads a reordered list.
  const beforeCount = await page.evaluate(
    () => document.querySelectorAll("section[aria-label='Addresses'] li").length,
  );
  const firstLabel = `Home-${vp.width}`;
  const secondLabel = `Office-${vp.width}`;
  await addAddress(page, firstLabel);
  await addAddress(page, secondLabel);
  await page.waitForFunction(
    (n) => document.querySelectorAll("section[aria-label='Addresses'] li").length === n,
    beforeCount + 2,
    { timeout: 15000 },
  );

  // The "Address added." notice is set before the list refresh
  // finishes, so wait for a non-default card to actually exist
  // before looking for its button — otherwise the list may still
  // show only the (default) first address.
  await page.waitForFunction(
    () => [...document.querySelectorAll("section[aria-label='Addresses'] button")].some((b) => b.textContent.includes("Set as default")),
    null,
    { timeout: 15000 },
  );

  // The label is browser-only (the addresses table has no label
  // column), so server-loaded cards cannot be told apart by label:
  // both cards show the same name and street. Pick the non-default
  // card instead — exactly one card carries the Default badge, and
  // every other card has a "Set as default" button. Click it on the
  // first non-default card and remember its position in the list.
  const clickedIndex = await page.evaluate(() => {
    const lis = [...document.querySelectorAll("section[aria-label='Addresses'] li")];
    const idx = lis.findIndex((el) => !el.innerText.includes("Default"));
    if (idx < 0) return -1;
    const b = [...lis[idx].querySelectorAll("button")].find((x) => x.textContent.includes("Set as default"));
    if (!b) return -1;
    b.click();
    return idx;
  });
  check(`[${vp.name}] Set as default button exists on a non-default address`, clickedIndex >= 0, `index ${clickedIndex}`);
  await page.waitForFunction(
    (idx) => {
      const lis = [...document.querySelectorAll("section[aria-label='Addresses'] li")];
      return lis.length > 0 && lis[idx] && lis[idx].innerText.includes("Default");
    },
    clickedIndex,
    { timeout: 15000 },
  );
  const accountText = await pageText(page);
  check(`[${vp.name}] Set as default shows no "fix the fields" error`, !accountText.includes("Please fix the highlighted address fields"), accountText.slice(0, 300));
  // The badge moved: the clicked card now carries it, exactly one
  // card carries it, and the previously-default card lost it.
  const badgeMoved = await page.evaluate((idx) => {
    const lis = [...document.querySelectorAll("section[aria-label='Addresses'] li")];
    const withBadge = lis.filter((el) => el.innerText.includes("Default"));
    return withBadge.length === 1 && lis[idx] && lis[idx].innerText.includes("Default");
  }, clickedIndex);
  check(`[${vp.name}] Default badge moved to the clicked address (exactly one Default)`, badgeMoved);
  const overflowAccount = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`[${vp.name}] /account has no horizontal overflow`, !overflowAccount);

  await context.close();
}

await browser.close();

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURES:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAll stock-cart-default-address checks passed.");
