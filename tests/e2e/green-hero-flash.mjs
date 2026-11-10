// TechShot green-buttons + hero-carousel + flash-deal + multi-category
// verification (Playwright, mock Supabase).
//
// ONE combined run for the 2026-11-10 batch:
//   1. At 1440 / 1280 / 390: home loads, hero carousel shows the
//      FALLBACK slides (the mock has no banners yet) — counter
//      "01 / 03", first slide is the iPhone — with a restrained
//      height (380px on desktop); buttons computed green; cards
//      carry the 1px border; no header/footer duplicate links; no
//      page errors, no failed requests, no horizontal overflow.
//   2. Carousel behaviour: desktop auto-advances (01 -> 02 in ~4.5s),
//      arrows + dots move it, keyboard arrows move it; mobile does
//      NOT auto-advance and swipes to the next slide.
//   3. Flash deals: the mock's single flash product (iPhone) shows a
//      220px thumbnail and the "Selling fast" bar under the card.
//   4. Admin (Owner, desktop): add a banner with an uploaded photo
//      and it takes over the home hero; edit its headline; hide it
//      and the fallback returns; show it again; delete it.
//   5. Multi-category (Owner, desktop): ticking "Flash deals" for
//      Sony + PlayStation puts them in the flash section (3 cards,
//      buttons and stock bars aligned across the row); ticking
//      "Audio" for the iPhone shows it under /shop?category=audio
//      as well as smartphones; everything is then unticked again so
//      the mock is left as it was found.
//   6. Route smoke at all three widths: /, /shop, /cart, /orders,
//      a product page, /checkout, /account, /admin.
//
// Run (see README, "End-to-end checks"):
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=mock-signing-secret PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 MOCK_URL=http://127.0.0.1:3101 node tests/e2e/green-hero-flash.mjs
//
// Needs a Chromium: playwright-core resolvable (it is NOT a repo
// dependency) and the chromium-1148 fallback below. Exits non-zero
// when any check fails. No real money moves: test adapter only.

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
const MOCK_URL = (process.env.MOCK_URL ?? "http://127.0.0.1:3101").replace(/\/$/, "");
const SHOTS = "/tmp/green-hero-flash-shots";
mkdirSync(SHOTS, { recursive: true });
const BANNER_PHOTO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "images", "products", "apple-iphone-16-pro.jpg");
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

async function waitFor(fn, timeoutMs = 10000, stepMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return true;
    await sleep(stepMs);
  }
  return false;
}

async function mockGet(query) {
  const res = await fetch(`${MOCK_URL}/rest/v1/${query}`, {
    headers: { apikey: "mock-anon-key", Authorization: "Bearer mock-service-key" },
  });
  if (!res.ok) return null;
  return res.json();
}

async function signIn(page) {
  await page.goto(`${BASE}/auth/sign-in`, { waitUntil: "networkidle" });
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

async function productId(slug) {
  const rows = await mockGet(`products?slug=eq.${slug}&select=id`);
  return rows?.[0]?.id ?? null;
}

async function categorySlugsFor(productIdValue) {
  const rows = await mockGet(
    `product_categories?product_id=eq.${productIdValue}&select=category_id`,
  );
  return (rows ?? []).map((r) => r.category_id).sort();
}

const browser = await launchBrowser();

// --- Part A: the three widths, fallback hero ------------------------------
const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

for (const { name, width, height } of WIDTHS) {
  const isMobile = width < 640;
  // The mobile context emulates a touch device (hasTouch + isMobile):
  // without it Playwright reports a fine hover-capable pointer and
  // the carousel would auto-advance, which is not how a phone
  // behaves.
  const context = await browser.newContext({
    viewport: { width, height },
    ...(isMobile ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("requestfailed", (req) => {
    if (req.failure()?.errorText === "net::ERR_ABORTED") return;
    failedRequests.push(`${req.url()} :: ${req.failure()?.errorText ?? ""}`);
  });

  async function noOverflow(label) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${name}: no horizontal overflow on ${label}`, overflow <= 0, `overflow=${overflow}px`);
  }
  async function shot(file) {
    await page.screenshot({ path: `${SHOTS}/${name}-${file}.png` });
  }
  async function heroCounter() {
    const el = page.locator('[data-testid="hero-counter"]');
    return (await el.count()) > 0 ? (await el.textContent())?.trim() ?? "" : "";
  }

  // --- Home: fallback hero, green buttons, borders, duplicates -----------
  let resp = await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  check(`${name}: / loads 200`, resp?.status() === 200, `status=${resp?.status()}`);
  check(`${name}: hero carousel renders`, await page.locator('[data-testid="hero-carousel"]').count() === 1);
  // No banners in the mock: the fallback slides are the top three
  // products, so the counter reads 01 / 03 and the first slide is
  // the iPhone.
  check(`${name}: hero falls back to product slides (01 / 03)`, (await heroCounter()) === "01 / 03", await heroCounter());
  check(
    `${name}: first fallback slide is the iPhone`,
    (await page.locator('[data-testid="hero-slide"]').getAttribute("data-slide-headline"))?.includes("iPhone 16 Pro") ?? false,
  );
  const heroBox = await page.locator('[data-testid="hero-carousel"]').boundingBox();
  if (isMobile) {
    check(`${name}: hero is a restrained strip on mobile, not a takeover`, (heroBox?.height ?? 9999) < 700, `height=${heroBox?.height}`);
    const imagePanelHeight = await page.evaluate(() => {
      const slide = document.querySelector('[data-testid="hero-slide"]');
      const panel = slide?.children[1];
      return panel ? panel.getBoundingClientRect().height : -1;
    });
    check(`${name}: hero image panel is 176px on mobile (h-44)`, imagePanelHeight === 176, `height=${imagePanelHeight}`);
  } else {
    check(`${name}: hero is capped at 380px on desktop`, Math.abs((heroBox?.height ?? 0) - 380) <= 2, `height=${heroBox?.height}`);
  }
  const heroCtaBg = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="hero-cta"]');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  check(`${name}: hero CTA is green`, heroCtaBg === rgb("#0B7A55"), heroCtaBg);
  await noOverflow("home");
  await shot("home");

  // Carousel behaviour.
  if (!isMobile) {
    // Desktop: auto-advance moves 01 -> 02 within one 4.5s interval
    // plus render time.
    const advanced = await waitFor(async () => (await heroCounter()) === "02 / 03", 9000);
    check(`${name}: carousel auto-advances on desktop`, advanced, await heroCounter());
    // Arrows appear on hover.
    await page.hover('[data-testid="hero-carousel"]');
    await sleep(300);
    await page.locator('[data-testid="hero-next"]').click();
    await sleep(400);
    check(`${name}: next arrow moves to 03 / 03`, (await heroCounter()) === "03 / 03", await heroCounter());
    await page.locator('[data-testid="hero-prev"]').click();
    await sleep(400);
    check(`${name}: previous arrow moves back to 02 / 03`, (await heroCounter()) === "02 / 03", await heroCounter());
    await page.locator('[data-testid="hero-dot-0"]').click();
    await sleep(400);
    check(`${name}: dot 0 returns to 01 / 03`, (await heroCounter()) === "01 / 03", await heroCounter());
    // Keyboard arrows (the carousel region is focused by clicking
    // it — the dots sit outside the region, so focus moves off it
    // after a dot click).
    await page.locator('[data-testid="hero-carousel"]').click();
    await page.keyboard.press("ArrowRight");
    await sleep(400);
    check(`${name}: ArrowRight moves to 02 / 03`, (await heroCounter()) === "02 / 03", await heroCounter());
  } else {
    // Mobile: no auto-advance; a swipe moves it.
    await sleep(5500);
    check(`${name}: carousel does NOT auto-advance on mobile`, (await heroCounter()) === "01 / 03", await heroCounter());
    const cdp = await context.newCDPSession(page);
    const box = await page.locator('[data-testid="hero-carousel"]').boundingBox();
    const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx + 80, y: cy, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx, y: cy, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 80, y: cy, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(500);
    check(`${name}: swipe left moves to 02 / 03`, (await heroCounter()) === "02 / 03", await heroCounter());
  }

  // Header/footer duplicate audit: the nav row's destinations must
  // not repeat in the footer, except the home link ("/") which both
  // lockups use.
  const navHrefs = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Categories"]');
    return nav ? [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href")) : [];
  });
  const footerHrefs = await page.evaluate(() =>
    [...document.querySelectorAll("footer a")].map((a) => a.getAttribute("href")),
  );
  const dupes = navHrefs.filter((h) => h !== "/" && footerHrefs.includes(h));
  check(`${name}: no nav destination repeats in the footer`, dupes.length === 0, `dupes=${dupes.join(", ")}`);
  check(`${name}: footer has no "Shop all" link`, !(await page.locator("footer").textContent())?.includes("Shop all"));
  if (isMobile) {
    await page.locator('[data-testid="mobile-nav-button"]').click();
    await sleep(400);
    const drawerLinks = await page.locator('[data-testid="mobile-nav-drawer"] a').allTextContents();
    check("mobile: nav drawer has no \"Shop all\"", !drawerLinks.some((t) => t.trim() === "Shop all"));
    const drawerHrefs = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="mobile-nav-drawer"] a')].map((a) => a.getAttribute("href")),
    );
    const drawerDupes = drawerHrefs.filter((h) => h !== "/" && footerHrefs.includes(h));
    check("mobile: no drawer destination repeats in the footer", drawerDupes.length === 0, `dupes=${drawerDupes.join(", ")}`);
    await page.keyboard.press("Escape");
    await sleep(300);
  }

  // Flash deals: the mock's one flash product (iPhone) — 220px
  // thumbnail, stock meter under the card. Scoped to the flash
  // section itself: ProductCard also says "Selling fast" inside
  // every low-stock card (trending included), so an unscoped
  // article search matches the trending row too.
  const flashSection = page.locator("section", { has: page.locator("h2", { hasText: "Flash deals" }) });
  const flashCards = flashSection.locator("article");
  check(`${name}: flash section shows the iPhone`, (await flashCards.count()) >= 1);
  const flashImg = flashCards.first().locator("img").first();
  if ((await flashImg.count()) > 0) {
    const imgBox = await flashImg.boundingBox();
    check(`${name}: flash thumbnail is capped at 220px`, (imgBox?.height ?? 9999) <= 220, `height=${imgBox?.height}`);
  }
  check(`${name}: flash card shows the stock meter`, (await flashSection.locator(".h-2").count()) >= 1);
  check(
    `${name}: no duplicated "Selling fast" line in a flash cell`,
    (await flashSection.locator("div.grid > div").first().locator("text=Selling fast").count()) === 1,
  );

  // Shop: green Add to Cart + 1px card border (resting state — the
  // mouse is moved off the cards first, since a hovered card shows
  // the designed hover:border-brand/60).
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle" });
  await page.mouse.move(10, 10);
  await sleep(200);
  const cardStyles = await page.evaluate(() => {
    const article = document.querySelector("article");
    const btn = article
      ? [...article.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Add to Cart"))
      : null;
    if (!article || !btn) return null;
    const a = getComputedStyle(article);
    const b = getComputedStyle(btn);
    return { borderWidth: a.borderWidth, borderColor: a.borderColor, btnBg: b.backgroundColor };
  });
  check(`${name}: Add to Cart is green`, cardStyles?.btnBg === rgb("#0B7A55"), cardStyles?.btnBg);
  check(`${name}: product card has the 1px border`, cardStyles?.borderWidth === "1px", cardStyles?.borderWidth);
  check(`${name}: card border is the border token`, cardStyles?.borderColor === rgb("#D9E2EC"), cardStyles?.borderColor);
  await noOverflow("shop");
  await shot("shop");

  // Route smoke (guest: /orders, /account, /admin redirect to
  // sign-in, which is a 200).
  for (const route of ["/cart", "/orders", "/product/apple-iphone-16-pro-256gb-natural-titanium", "/checkout", "/account", "/admin"]) {
    const r = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    check(`${name}: ${route} loads 200`, r?.status() === 200, `status=${r?.status()}`);
  }
  await noOverflow("routes");
  check(`${name}: no page errors`, pageErrors.length === 0, pageErrors.join(" | ").slice(0, 500));
  check(`${name}: no failed requests`, failedRequests.length === 0, failedRequests.join(" | ").slice(0, 500));
  await context.close();
}

// --- Part B: admin banners + multi-category (desktop, Owner) --------------
const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await adminContext.newPage();
const adminErrors = [];
page.on("pageerror", (err) => adminErrors.push(String(err)));
await signIn(page);
check("admin: sign-in lands on /account", page.url().includes("/account"), page.url());

// Banners tab starts empty (the mock has no banners).
await page.goto(`${BASE}/admin?tab=banners`, { waitUntil: "networkidle" });
await sleep(800);
check("admin: banners tab renders", (await page.locator('[data-testid="banner-list"], [data-testid="banner-headline"]').count()) >= 1);
check("admin: no banners yet", (await page.locator('[data-testid="banner-item"]').count()) === 0);

// The size note warns the admin about the wide banner size.
check(
  "admin: banner size note says 1600 x 640",
  ((await page.locator('[data-testid="banner-image-size-note"]').textContent()) ?? "").includes("1600 x 640"),
);

// Add a banner with an uploaded photo.
await page.locator('[data-testid="banner-headline"]').fill("E2E Banner");
await page.locator('[data-testid="banner-subcopy"]').fill("A banner added by the e2e run.");
await page.locator('[data-testid="banner-cta-label"]').fill("Shop the deal");
await page.locator('[data-testid="banner-cta-href"]').fill("/shop?category=audio");
await page.locator('[data-testid="banner-upload-input"]').setInputFiles(BANNER_PHOTO);
await page.locator('[data-testid="banner-upload-button"]').click();
const uploaded = await waitFor(async () => {
  const v = await page.locator('[data-testid="banner-image-path"]').inputValue();
  return v.startsWith("banner-");
}, 15000);
check("admin: banner photo uploads (path starts banner-)", uploaded, await page.locator('[data-testid="banner-image-path"]').inputValue());
await page.locator('[data-testid="banner-save"]').click();
const bannerSaved = await waitFor(async () => (await page.locator('[data-testid="banner-item"]').count()) === 1, 10000);
check("admin: banner is saved and listed", bannerSaved);
check(
  "admin: banner list shows the headline",
  ((await page.locator('[data-testid="banner-item"]').first().textContent()) ?? "").includes("E2E Banner"),
);

// The banner takes over the home hero (one slide, no dots).
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await sleep(800);
check(
  "admin: home hero shows the new banner",
  (await page.locator('[data-testid="hero-slide"]').getAttribute("data-slide-headline")) === "E2E Banner",
);
check("admin: one banner means no dots", (await page.locator('[data-testid="hero-dot-0"]').count()) === 0);
check(
  "admin: banner CTA goes to the audio shop",
  (await page.locator('[data-testid="hero-cta"]').getAttribute("href")) === "/shop?category=audio",
);
check(
  "admin: banner photo renders (not the placeholder)",
  (await page.locator('[data-testid="hero-carousel"] img').count()) >= 1,
);

// Edit the headline.
await page.goto(`${BASE}/admin?tab=banners`, { waitUntil: "networkidle" });
await sleep(800);
await page.locator('[data-testid="banner-edit"]').first().click();
await sleep(400);
await page.locator('[data-testid="banner-headline"]').fill("E2E Banner Edited");
await page.locator('[data-testid="banner-save"]').click();
const edited = await waitFor(async () =>
  ((await page.locator('[data-testid="banner-item"]').first().textContent()) ?? "").includes("E2E Banner Edited"),
  10000,
);
check("admin: banner headline edit sticks", edited);

// Hide it: the home hero falls back to product slides again.
await page.locator('[data-testid="banner-toggle-active"]').first().click();
const hidden = await waitFor(async () =>
  ((await page.locator('[data-testid="banner-item"]').first().textContent()) ?? "").includes("Hidden"),
  10000,
);
check("admin: banner hides (Hidden badge)", hidden);
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await sleep(800);
check(
  "admin: hidden banner falls back to product slides",
  (await page.locator('[data-testid="hero-counter"]').textContent())?.trim() === "01 / 03",
);

// Show it again, then delete it (the mock is left as it was found).
await page.goto(`${BASE}/admin?tab=banners`, { waitUntil: "networkidle" });
await sleep(800);
await page.locator('[data-testid="banner-toggle-active"]').first().click();
await waitFor(async () =>
  ((await page.locator('[data-testid="banner-item"]').first().textContent()) ?? "").includes("Active"),
  10000,
);
await page.locator('[data-testid="banner-delete"]').first().click();
const deleted = await waitFor(async () => (await page.locator('[data-testid="banner-item"]').count()) === 0, 10000);
check("admin: banner deletes", deleted);
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await sleep(800);
check(
  "admin: after delete the hero is the product fallback again",
  (await page.locator('[data-testid="hero-counter"]').textContent())?.trim() === "01 / 03",
);

// --- Multi-category: Flash deals via the product form ----------------------
const sonyId = await productId("sony-wh-1000xm5");
const dualsenseId = await productId("playstation-dualsense");
const iphoneId = await productId("apple-iphone-16-pro-256gb-natural-titanium");
check("admin: mock has Sony, DualSense and iPhone ids", !!(sonyId && dualsenseId && iphoneId));

async function editProduct(title, categorySlug, shouldTick) {
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle" });
  await sleep(1000);
  const row = page.locator("div.space-y-3 > div").filter({ hasText: title }).first();
  await row.locator("button", { hasText: "Edit" }).click();
  await sleep(600);
  const box = page.locator(`[data-testid="category-checkbox-${categorySlug}"]`);
  const isChecked = await box.isChecked();
  if (isChecked !== shouldTick) {
    if (shouldTick) await box.check();
    else await box.uncheck();
  }
  await page.locator("button[type=submit]", { hasText: "Save changes" }).click();
  const saved = await waitFor(async () =>
    ((await page.textContent("body")) ?? "").includes("was updated."),
    10000,
  );
  check(`admin: saving "${title}" (${shouldTick ? "tick" : "untick"} ${categorySlug}) shows the update notice`, saved);
}

await editProduct("Sony WH-1000XM5", "flash-deals", true);
check("admin: Sony gains the flash-deals membership", (await categorySlugsFor(sonyId)).includes("cat-flash-deals"), (await categorySlugsFor(sonyId)).join(", "));
await editProduct("PlayStation DualSense", "flash-deals", true);
check("admin: DualSense gains the flash-deals membership", (await categorySlugsFor(dualsenseId)).includes("cat-flash-deals"));

// Three flash cards now (iPhone + Sony + DualSense): buttons and
// stock meters aligned across the row, thumbnails capped at 220px,
// and the "Selling fast" line appears once per card (inside the
// card — the section no longer repeats it below the card).
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await sleep(800);
const flashSection = page.locator("section", { has: page.locator("h2", { hasText: "Flash deals" }) });
const flashCards = flashSection.locator("article");
check("admin: flash section shows all three flash products", (await flashCards.count()) === 3, `count=${await flashCards.count()}`);
const buttonTops = [];
const meterTops = [];
for (let i = 0; i < 3; i++) {
  const card = flashCards.nth(i);
  const btn = card.locator("button", { hasText: "Add to Cart" }).first();
  buttonTops.push((await btn.boundingBox())?.y ?? -1);
  const img = card.locator("img").first();
  if ((await img.count()) > 0) {
    const imgBox = await img.boundingBox();
    check(`admin: flash card ${i + 1} thumbnail capped at 220px`, (imgBox?.height ?? 9999) <= 220, `height=${imgBox?.height}`);
  }
  const cell = flashSection.locator("div.grid > div").nth(i);
  check(
    `admin: flash cell ${i + 1} says "Selling fast" at most once (no duplicate line)`,
    (await cell.locator("text=Selling fast").count()) <= 1,
    `count=${await cell.locator("text=Selling fast").count()}`,
  );
}
for (let i = 0; i < 3; i++) {
  const meter = flashSection.locator(".h-2").nth(i);
  meterTops.push((await meter.boundingBox())?.y ?? -1);
}
check(
  "admin: flash buttons align across the row",
  buttonTops.every((t) => Math.abs(t - buttonTops[0]) <= 1),
  `tops=${buttonTops.join(", ")}`,
);
check(
  "admin: flash stock meters align across the row",
  meterTops.every((t) => Math.abs(t - meterTops[0]) <= 1),
  `tops=${meterTops.join(", ")}`,
);

// Multi-category shop: iPhone under audio as well as smartphones.
await editProduct("Apple iPhone 16 Pro", "audio", true);
check("admin: iPhone gains the audio membership", (await categorySlugsFor(iphoneId)).includes("cat-audio"), (await categorySlugsFor(iphoneId)).join(", "));
await page.goto(`${BASE}/shop?category=audio`, { waitUntil: "networkidle" });
await sleep(500);
check("admin: iPhone shows under /shop?category=audio", (await page.locator("article", { hasText: "iPhone 16 Pro" }).count()) >= 1);
await page.goto(`${BASE}/shop?category=smartphones`, { waitUntil: "networkidle" });
await sleep(500);
check("admin: iPhone still shows under /shop?category=smartphones", (await page.locator("article", { hasText: "iPhone 16 Pro" }).count()) >= 1);

// Restore the mock to how it was found.
await editProduct("Sony WH-1000XM5", "flash-deals", false);
await editProduct("PlayStation DualSense", "flash-deals", false);
await editProduct("Apple iPhone 16 Pro", "audio", false);
check("admin: Sony flash membership removed", !(await categorySlugsFor(sonyId)).includes("cat-flash-deals"));
check("admin: DualSense flash membership removed", !(await categorySlugsFor(dualsenseId)).includes("cat-flash-deals"));
check("admin: iPhone back to flash-deals only", JSON.stringify(await categorySlugsFor(iphoneId)) === JSON.stringify(["cat-flash-deals"]));
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await sleep(800);
check(
  "admin: flash section is back to the single iPhone",
  (await flashSection.locator("article").count()) === 1,
  `count=${await flashSection.locator("article").count()}`,
);
check("admin: no page errors in the admin flow", adminErrors.length === 0, adminErrors.join(" | ").slice(0, 500));
await adminContext.close();

await browser.close();
console.log(failures.length === 0 ? "\nALL CHECKS PASSED" : `\n${failures.length} CHECK(S) FAILED:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
