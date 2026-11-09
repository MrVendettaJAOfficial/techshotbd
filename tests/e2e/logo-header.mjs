// TechShot Playwright check: code-built logo wordmark in the header
// and footer at three widths — desktop 1440, laptop 1280, mobile 390.
//
//   A. Header logo — the lockup renders (monogram tile, "TechShot" in
//      Montserrat extra-bold, green "BD", tagline), links home, and
//      the tagline shows on desktop/laptop but hides on mobile.
//   B. Footer logo — the same lockup, with the tagline always shown
//      (the footer is never tight).
//   C. Header still works — sticky, search submits to /shop, the cart
//      button opens the mini-cart drawer, no horizontal overflow on /
//      and /shop, no page JS errors.
//
// Run (see README, "End-to-end checks"):
//   Mock:      node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 node tests/e2e/logo-header.mjs
//
// Needs a Chromium: playwright-core resolvable (it is NOT a repo
// dependency) and the chromium-1148 fallback below. Exits non-zero
// when any check fails.

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

async function pageOverflow(page, expectedW) {
  return page.evaluate((expected) => {
    const de = document.documentElement;
    return {
      scrollW: de.scrollWidth,
      innerW: window.innerWidth,
      overflow: de.scrollWidth > window.innerWidth + 1 || window.innerWidth !== expected,
    };
  }, expectedW);
}

const WIDTHS = [
  { label: "desktop 1440", width: 1440, height: 900, touch: false },
  { label: "laptop 1280", width: 1280, height: 800, touch: false },
  { label: "mobile 390", width: 390, height: 844, touch: true },
];

const browser = await launchBrowser();

for (const { label, width, height, touch } of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: touch ? 2 : 1,
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await sleep(1200);

  // --- A. Header logo lockup ---
  const logo = page.locator('[data-testid="site-logo"]').first();
  check(`${label}: header logo link is present`, (await logo.count()) === 1);
  check(`${label}: header logo links home`, (await logo.getAttribute("href")) === "/");
  check(`${label}: header logo has the home aria-label`, (await logo.getAttribute("aria-label")) === "TechShot home");
  const logoText = (await logo.textContent()) ?? "";
  check(`${label}: wordmark reads TechShot`, logoText.includes("TechShot"), logoText);
  check(`${label}: BD mark is present`, logoText.includes("BD"), logoText);
  check(`${label}: tagline text is present`, logoText.includes("A Shot of Tech, You Can Trust"), logoText);

  const wordmark = logo.locator('[data-testid="logo-wordmark"]');
  const fontFamily = await wordmark.evaluate((el) => getComputedStyle(el).fontFamily);
  check(`${label}: wordmark uses Montserrat`, /Montserrat/.test(fontFamily), fontFamily);
  const fontWeight = await wordmark.evaluate((el) => getComputedStyle(el).fontWeight);
  check(`${label}: wordmark is extra-bold (800)`, fontWeight === "800", fontWeight);

  const bd = logo.locator('[data-testid="logo-bd"]');
  const bdColor = await bd.evaluate((el) => getComputedStyle(el).color);
  check(`${label}: BD is the logo green`, bdColor === "rgb(15, 154, 112)", bdColor);
  const bdSize = await bd.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const wordSize = await wordmark.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check(`${label}: BD is smaller than the wordmark`, bdSize < wordSize, `BD=${bdSize}px wordmark=${wordSize}px`);

  const tagline = logo.locator('[data-testid="logo-tagline"]');
  const taglineVisible = await tagline.isVisible().catch(() => false);
  if (touch) {
    check(`${label}: tagline is hidden on mobile`, !taglineVisible);
  } else {
    check(`${label}: tagline is visible on desktop/laptop`, taglineVisible);
  }

  const monogram = await logo.locator("svg").count();
  check(`${label}: monogram mark renders in the logo`, monogram === 1);

  // Logo fits inside the viewport and does not push the header wide.
  const logoBox = await logo.boundingBox();
  check(
    `${label}: logo sits inside the viewport`,
    logoBox !== null && logoBox.x >= -1 && logoBox.x + logoBox.width <= width + 1,
    logoBox ? `x=${Math.round(logoBox.x)} right=${Math.round(logoBox.x + logoBox.width)} vw=${width}` : "no logo box",
  );

  let ov = await pageOverflow(page, width);
  check(`${label}: home has no horizontal overflow`, !ov.overflow, `scrollW=${ov.scrollW} innerW=${ov.innerW}`);

  // --- C. Header still works ---
  const headerPos = await page.evaluate(() => getComputedStyle(document.querySelector("header")).position);
  check(`${label}: header is sticky`, headerPos === "sticky", headerPos);

  // Search submits to /shop (desktop form on wide screens, the
  // second form under the header row on mobile — pick the visible one).
  const searchInput = page.locator('header input[type="search"]:visible').first();
  await searchInput.fill("iphone");
  await page.locator('header form[role="search"]:visible').first().evaluate((form) => form.requestSubmit());
  await sleep(1200);
  check(`${label}: search lands on /shop with the query`, page.url().includes("/shop?q=iphone"), page.url());
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await sleep(800);

  // Cart button opens the mini-cart drawer without navigating.
  await page.locator('header button[aria-label^="Cart"]').click();
  await sleep(700);
  const drawer = await page.locator('[role="dialog"]').count();
  check(`${label}: cart button opens the mini-cart drawer`, drawer >= 1);
  await page.keyboard.press("Escape");
  await sleep(500);

  // Logo click from /shop goes home.
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle0" });
  await sleep(800);
  ov = await pageOverflow(page, width);
  check(`${label}: /shop has no horizontal overflow`, !ov.overflow, `scrollW=${ov.scrollW} innerW=${ov.innerW}`);
  await logo.click();
  await sleep(1000);
  check(`${label}: clicking the logo goes home`, page.url() === `${BASE}/`, page.url());

  // --- B. Footer logo ---
  const footerLogo = page.locator('footer [data-testid="site-logo"]');
  check(`${label}: footer logo is present`, (await footerLogo.count()) === 1);
  const footerTagline = footerLogo.locator('[data-testid="logo-tagline"]');
  check(`${label}: footer tagline is visible at every width`, await footerTagline.isVisible().catch(() => false));

  // Header screenshot for a visual look at the lockup.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  await sleep(800);
  await page.locator("header").screenshot({
    path: `/home/hatch/workspace/goals/techshotbd-marketplace/hidden_files/playwright/logo-header-${width}.png`,
  });

  check(`${label}: no page JS errors during the run`, pageErrors.length === 0, pageErrors.join(" | "));
  await ctx.close();
}

await browser.close();

if (failures.length > 0) {
  console.log(`\n${failures.length} CHECK(S) FAILED:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
