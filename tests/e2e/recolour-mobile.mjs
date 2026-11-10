// TechShot combined verification: wordmark + recolour + mobile nav /
// filter drawers + animations + image-400 fix + logo placeholder.
//
// One pass at desktop 1440, laptop 1280 and mobile 390, against the
// mock Supabase (port 3101) with the app on :3100:
//
//   A. Wordmark — the header/footer lockup, Montserrat extra-bold,
//      green BD, tagline visible desktop/laptop and hidden in the
//      mobile header, always in the footer.
//   B. Light theme (2026-11-09) + green buttons (2026-11-10) —
//      computed colours: page white #FFFFFF with navy text #00162E,
//      solid buttons green #0B7A55 (hover #096B49, never white text
//      on the full green #0F9A70), header bar and footer navy,
//      announcement bar still the button green #0B7A55 (it sits on
//      navy), the Flash deals link in the full orange #f97316 on
//      the navy header but the darker orange #C2410C in the white
//      nav drawer, discount badges on the darker orange #C2410C,
//      cards white. No leftover blue anywhere (source-level,
//      covered by tests/recolour.test.mjs; here the rendered
//      styles are probed).
//   C. Mobile nav — hamburger only on mobile, opens the slide-in
//      drawer with the category links; a link navigates; Escape and
//      overlay tap close it and focus returns to the hamburger.
//      The horizontal nav row is hidden on mobile, shown from sm up.
//   D. Mobile filters — hidden by default on mobile; the Filters
//      button (chevron + count badge) opens the filter drawer;
//      applying a brand filter from the drawer filters the list and
//      the badge counts it; Clear returns to /shop. Desktop sidebar
//      unchanged (form visible, no button).
//   E. Placeholder + image-400 fix — the three subscription products
//      (no photos) show the logo placeholder on their shop cards
//      and product pages at all three widths, and no /_next/image
//      request anywhere in the run returns 400.
//   F. Routes + hygiene — /, /shop, /cart, /orders, a product page,
//      /checkout, /account and /admin load with no page JS errors,
//      no failed requests and no horizontal overflow at any width.
//      Key pages are screenshotted to /tmp/recolour-shots for an
//      eyeball check.
//
// Run (see README, "End-to-end checks"):
//   Mock:      node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 node tests/e2e/recolour-mobile.mjs
//
// Needs a Chromium: playwright-core resolvable (it is NOT a repo
// dependency) and the chromium-1148 fallback below. Exits non-zero
// when any check fails.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

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
const SHOTS = "/tmp/recolour-shots";
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

const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

// rgb() for a hex colour.
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const browser = await launchBrowser();

for (const { name, width, height } of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  const image400s = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("requestfailed", (req) => {
    if (req.failure()?.errorText === "net::ERR_ABORTED") return;
    failedRequests.push(`${req.url()} :: ${req.failure()?.errorText ?? ""}`);
  });
  page.on("response", (res) => {
    if (res.url().includes("/_next/image") && res.status() === 400) image400s.push(res.url());
  });
  const isMobile = width < 640;

  async function noOverflow(label) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${name}: no horizontal overflow on ${label}`, overflow <= 0, `overflow=${overflow}px`);
  }
  async function shot(file) {
    await page.screenshot({ path: `${SHOTS}/${name}-${file}.png` });
  }

  // --- Home: wordmark + recolour computed styles -------------------------
  let resp = await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  check(`${name}: / loads 200`, resp?.status() === 200, `status=${resp?.status()}`);
  check(`${name}: logo lockup renders in the header`, await page.locator('header [data-testid="site-logo"]').count() === 1);
  check(`${name}: wordmark is Montserrat extra-bold`, await page.evaluate(() => {
    const el = document.querySelector('[data-testid="logo-wordmark"]');
    if (!el) return false;
    const style = getComputedStyle(el);
    return Number(style.fontWeight) >= 800 && style.fontFamily.includes("Montserrat");
  }));
  check(`${name}: BD is green`, await page.evaluate(() => {
    const el = document.querySelector('[data-testid="logo-bd"]');
    return !!el && getComputedStyle(el).color === "rgb(15, 154, 112)";
  }));
  const taglineVisible = await page.locator('[data-testid="logo-tagline"]').first().isVisible();
  check(
    `${name}: header tagline ${isMobile ? "hidden on mobile" : "visible on desktop/laptop"}`,
    isMobile ? !taglineVisible : taglineVisible,
  );
  const styles = await page.evaluate(() => {
    const cs = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    };
    return {
      body: cs("body"),
      announcement: cs("header > div:first-child"),
      headerBar: cs("header > div:nth-child(2)"),
      footer: cs("footer"),
    };
  });
  // The hero is image-only since the 2026-11-10 redesign: no CTA
  // any more — the fallback slide's alt identifies it instead.
  const heroImageOnly = await page.evaluate(() => {
    const carousel = document.querySelector('[data-testid="hero-carousel"]');
    const slide = document.querySelector('[data-testid="hero-slide"]');
    return !!carousel && !!slide && (slide.getAttribute("data-slide-alt") ?? "") !== "" && !document.querySelector('[data-testid="hero-cta"]');
  });
  check(`${name}: page background is white`, styles.body?.bg === rgb("#FFFFFF"), styles.body?.bg);
  check(`${name}: body text is dark navy`, styles.body?.color === rgb("#00162E"), styles.body?.color);
  check(`${name}: announcement bar is button green`, styles.announcement?.bg === rgb("#0B7A55"), styles.announcement?.bg);
  check(`${name}: header bar is navy`, styles.headerBar?.bg === rgb("#00162E"), styles.headerBar?.bg);
  check(`${name}: footer is navy`, styles.footer?.bg === rgb("#00162E"), styles.footer?.bg);
  check(`${name}: hero is image-only (slide alt present, no CTA)`, heroImageOnly);
  await noOverflow("home");
  await shot("home");

  // Footer logo: tagline always shown.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(300);
  const footerTagline = await page.locator("footer [data-testid='logo-tagline']").isVisible();
  check(`${name}: footer tagline always visible`, footerTagline);

  // --- Mobile nav drawer --------------------------------------------------
  const hamburgerVisible = await page.locator('[data-testid="mobile-nav-button"]').isVisible();
  check(`${name}: hamburger ${isMobile ? "visible on mobile" : "hidden on desktop/laptop"}`, hamburgerVisible === isMobile);
  const navRowVisible = await page.locator('nav[aria-label="Categories"]').first().isVisible();
  check(`${name}: horizontal nav row ${isMobile ? "hidden on mobile" : "shown on desktop/laptop"}`, navRowVisible === !isMobile);

  if (isMobile) {
    await page.locator('[data-testid="mobile-nav-button"]').click();
    await sleep(400);
    check("mobile: nav drawer opens", await page.locator('[data-testid="mobile-nav-drawer"]').isVisible());
    const drawerLinks = await page.locator('[data-testid="mobile-nav-drawer"] a').allTextContents();
    for (const label of ["All categories", "Home", "Smartphones", "Laptops", "Audio", "Gaming", "Subscriptions", "Flash deals"]) {
      check(`mobile: nav drawer has "${label}"`, drawerLinks.some((t) => t.trim() === label));
    }
    // Flash deals link inside the drawer is the darker orange
    // (the full orange fails AA as text on white).
    const flashColor = await page.evaluate(() => {
      const link = [...document.querySelectorAll('[data-testid="mobile-nav-drawer"] a')].find((a) => a.textContent.trim() === "Flash deals");
      return link ? getComputedStyle(link).color : null;
    });
    check("mobile: drawer Flash deals link is darker orange", flashColor === rgb("#C2410C"), flashColor);
    await shot("nav-drawer-open");
    // A link navigates from the drawer.
    await page.locator('[data-testid="mobile-nav-drawer"] a', { hasText: "Smartphones" }).click();
    await page.waitForURL("**/shop?category=smartphones", { timeout: 5000 });
    check("mobile: nav drawer link navigates to smartphones", page.url().includes("category=smartphones"), page.url());
    // Reopen, close with Escape, focus returns to the hamburger.
    await page.locator('[data-testid="mobile-nav-button"]').click();
    await sleep(400);
    await page.keyboard.press("Escape");
    await sleep(200);
    check("mobile: Escape closes the nav drawer", (await page.locator('[data-testid="mobile-nav-drawer"]').count()) === 0);
    check("mobile: focus returns to hamburger after Escape", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "mobile-nav-button"));
    // Reopen, close by overlay tap.
    await page.locator('[data-testid="mobile-nav-button"]').click();
    await sleep(400);
    await page.mouse.click(width - 10, 400);
    await sleep(200);
    check("mobile: overlay tap closes the nav drawer", (await page.locator('[data-testid="mobile-nav-drawer"]').count()) === 0);
  } else {
    // Desktop: the Flash deals nav link is orange.
    const flashColor = await page.evaluate(() => {
      const link = [...document.querySelectorAll('nav[aria-label="Categories"] a')].find((a) => a.textContent.trim() === "Flash deals");
      return link ? getComputedStyle(link).color : null;
    });
    check(`${name}: Flash deals nav link is orange`, flashColor === rgb("#f97316"), flashColor);
  }

  // --- Shop: filters, placeholder, buttons --------------------------------
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle" });
  const filtersButtonVisible = await page.locator('[data-testid="filters-button"]').isVisible().catch(() => false);
  check(`${name}: Filters button ${isMobile ? "visible on mobile" : "hidden on desktop/laptop"}`, filtersButtonVisible === isMobile);
  // The filter form exists exactly once in the DOM.
  check(`${name}: exactly one filter form`, (await page.locator('form[action="/shop"]').count()) === 1);

  if (isMobile) {
    // Hidden by default: the drawer is off-canvas and invisible.
    const drawerBox = await page.locator('[data-testid="filters-drawer"]').boundingBox();
    const drawerVisible = await page.locator('[data-testid="filters-drawer"]').isVisible();
    check("mobile: filters hidden by default", !drawerVisible || (drawerBox?.x ?? 0) < 0, `visible=${drawerVisible} x=${drawerBox?.x}`);
    await page.locator('[data-testid="filters-button"]').click();
    await sleep(400);
    check("mobile: Filters button opens the filter drawer", await page.locator('[data-testid="filters-drawer"]').isVisible());
    await shot("filters-drawer-open");
    // Apply a brand filter from the drawer.
    await page.locator('[data-testid="filters-drawer"] input[name="brand"][value="Apple"]').check();
    await page.locator('[data-testid="filters-drawer"] button[type="submit"]').click();
    await page.waitForURL("**/shop?*brand=Apple*", { timeout: 5000 });
    check("mobile: applying a filter from the drawer filters the list", page.url().includes("brand=Apple"), page.url());
    const badge = await page.locator('[data-testid="filters-count"]').textContent().catch(() => null);
    check("mobile: Filters badge counts the active filter", badge?.trim() === "1", `badge=${badge}`);
    const titles = await page.locator("main article h3").allTextContents();
    check("mobile: filtered list shows only Apple", titles.length > 0 && titles.every((t) => t.toLowerCase().includes("iphone") || t.toLowerCase().includes("apple")), titles.join(" | "));
    // Clear returns to /shop.
    await page.locator('[data-testid="filters-button"]').click();
    await sleep(400);
    await page.locator('[data-testid="filters-drawer"] a[href="/shop"]', { hasText: "Clear" }).click();
    await page.waitForURL(`${BASE}/shop`, { timeout: 5000 });
    check("mobile: Clear returns to /shop", page.url() === `${BASE}/shop`, page.url());
  } else {
    // Desktop sidebar: the form is visible without opening anything.
    check(`${name}: desktop filter sidebar visible`, await page.locator('form[action="/shop"]').isVisible());
  }

  // Subscription cards show the logo placeholder (no photo exists).
  await page.goto(`${BASE}/shop?category=subscriptions`, { waitUntil: "networkidle" });
  const placeholders = await page.locator('[data-testid="product-placeholder"]').count();
  check(`${name}: subscription cards show the logo placeholder`, placeholders >= 3, `found=${placeholders}`);
  await shot("subscriptions");
  // A physical product card shows a real photo, not a placeholder.
  await page.goto(`${BASE}/shop?category=audio`, { waitUntil: "networkidle" });
  const audioPlaceholders = await page.locator('article [data-testid="product-placeholder"]').count();
  check(`${name}: physical product cards show photos, not placeholders`, audioPlaceholders === 0, `found=${audioPlaceholders}`);
  // Add-to-cart button is navy; discount badge the darker orange.
  const cardStyles = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("article button")].find((b) =>
      (b.textContent ?? "").includes("Add to Cart"),
    );
    const badge = [...document.querySelectorAll("article span")].find((s) =>
      /-\d+%/.test(s.textContent ?? ""),
    );
    return {
      btnBg: btn ? getComputedStyle(btn).backgroundColor : null,
      badgeBg: badge ? getComputedStyle(badge).backgroundColor : null,
    };
  });
  check(`${name}: Add to Cart is green`, cardStyles.btnBg === rgb("#0B7A55"), cardStyles.btnBg);
  check(`${name}: discount badge is darker orange`, cardStyles.badgeBg === rgb("#C2410C"), cardStyles.badgeBg);

  // --- Product page: subscription placeholder, gallery ----------------------
  await page.goto(`${BASE}/product/netflix-premium-1-month`, { waitUntil: "networkidle" });
  check(`${name}: subscription product page loads`, await page.locator("h1").first().textContent().then((t) => (t ?? "").includes("Netflix")));
  const galleryPlaceholder = await page.locator('[data-testid="gallery-main"] [data-testid="product-placeholder"]').count();
  check(`${name}: subscription product page shows the logo placeholder`, galleryPlaceholder >= 1, `found=${galleryPlaceholder}`);
  await shot("product-netflix");
  await noOverflow("product page");
  await page.goto(`${BASE}/product/apple-iphone-16-pro-256gb-natural-titanium`, { waitUntil: "networkidle" });
  check(`${name}: physical product page shows a photo`, (await page.locator('[data-testid="gallery-main"] img').count()) >= 1);
  await noOverflow("iphone page");

  // --- Cart / checkout / orders / account / admin ---------------------------
  for (const [path, label] of [
    ["/cart", "cart"],
    ["/checkout", "checkout"],
    ["/orders", "orders"],
    ["/account", "account"],
    ["/admin", "admin"],
  ]) {
    const r = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    check(`${name}: ${label} loads without a server error`, (r?.status() ?? 0) < 500, `status=${r?.status()} url=${page.url()}`);
    await noOverflow(label);
  }

  // Mini-cart drawer still works (regression: it was re-touched).
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle" });
  await page.locator("article button", { hasText: "Add to Cart" }).first().click();
  await sleep(300);
  await page.locator('button[aria-label^="Cart,"]').first().click();
  await sleep(400);
  check(`${name}: mini-cart drawer still opens`, await page.locator('[aria-label="Your cart"]').isVisible());
  await page.keyboard.press("Escape");
  await sleep(200);

  check(`${name}: zero page JS errors`, pageErrors.length === 0, pageErrors.join(" | ").slice(0, 300));
  check(`${name}: zero failed requests`, failedRequests.length === 0, failedRequests.join(" | ").slice(0, 300));
  check(`${name}: zero /_next/image 400s`, image400s.length === 0, image400s.join(" | ").slice(0, 300));

  await context.close();
}

await browser.close();

console.log(failures.length === 0 ? "\nALL CHECKS PASSED" : `\n${failures.length} CHECK(S) FAILED:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
