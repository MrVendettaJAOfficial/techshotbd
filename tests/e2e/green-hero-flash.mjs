// TechShot image-only hero carousel + green buttons + flash deals +
// multi-category verification (Playwright, mock Supabase).
//
// ONE combined run for the 2026-11-10 image-only carousel rebuild:
//   1. At 1440 / 1280 / 390: home loads, hero carousel shows the
//      FALLBACK slides (the mock has no banners yet) — the top three
//      products, IMAGE-ONLY: no headline, subcopy, CTA or price
//      text anywhere in the hero, no counter, no text panel. The
//      hero is a restrained strip (380px on desktop, ~200px on
//      mobile, dots overlaid ON the image); all 3 slides are in
//      the DOM at once, stacked and crossfaded, exactly one
//      opacity-100 at a time. Buttons computed green; cards carry
//      the 1px border; no header/footer duplicate links; no page
//      errors, no failed requests, no horizontal overflow.
//   2. Carousel behaviour: desktop auto-advances, and ANY manual
//      navigation (dot / arrow / swipe / keyboard) RESETS the
//      4.5s timer — a manual pick is never immediately overridden
//      by the old timer. Arrows wrap both directions, dots and
//      keyboard arrows move it. Mobile (touch context) NOW
//      auto-advances too — the user explicitly wants a continuous
//      loop of images on a phone — and swipes to the next slide.
//      During a change the active slide's image matches the
//      active index and the previous slide stays in the DOM at
//      opacity-0 (stacked crossfade, no lingering photo).
//   3. Flash deals: the mock's single flash product (iPhone) shows a
//      220px thumbnail and the "Selling fast" bar under the card.
//   4. Admin (Owner, desktop): add a banner — pick Kind = Offer,
//      upload a photo, save (there are NO headline / subcopy /
//      button fields any more) — and it takes over the home hero
//      as one image-only slide with alt "Offer banner" and no
//      dots; edit its kind to Promotion and the badge and hero
//      alt update; hide it and the fallback returns; show it
//      again; delete it.
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

// The fallback slides, in order: getCatalog() orders products by
// created_at ascending, so the top three are the iPhone, the Sony
// headphones and the MacBook. The alt text is the product title —
// it is the ONLY text a fallback slide carries, and it is never
// rendered visibly (it is the img alt).
const FALLBACK_ALTS = [
  "Apple iPhone 16 Pro 256GB Natural Titanium",
  "Sony WH-1000XM5 Wireless Noise Cancelling Headphones",
  'MacBook Air 13" M3',
];

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
  // the carousel would show hover arrows, which is not how a phone
  // behaves. The carousel DOES auto-advance on a phone now (the
  // image-only redesign loops on all devices) — the touch context
  // only changes the pointer, not the timer.
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
  // Index of the one slide at opacity-100, or -1 if none is.
  // The crossfade lasts 500ms (duration-500), so a read taken
  // right after a navigation catches the slides mid-transition
  // (opacities like 0.03 / 0.97, no slide exactly at 1) — wait
  // for the fade to settle first, otherwise every post-nav read
  // reports -1 for a carousel that is working correctly.
  async function activeSlideIndex() {
    const settled = await waitFor(async () => {
      const opacities = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="hero-slide"]')].map((s) => getComputedStyle(s).opacity),
      );
      return opacities.filter((o) => o === "1").length === 1;
    }, 2000);
    if (!settled) return -1;
    return await page.evaluate(() => {
      const slides = [...document.querySelectorAll('[data-testid="hero-slide"]')];
      return slides.findIndex((s) => getComputedStyle(s).opacity === "1");
    });
  }
  async function slideAlts() {
    return await page
      .locator('[data-testid="hero-slide"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-slide-alt") ?? ""));
  }
  // A click inside the carousel leaves focus on the clicked button
  // (dot / arrow), which pauses the auto-advance timer (focused
  // pauses it, by design), and the mouse stays over the hero, which
  // pauses it too (hover pauses it). Before any timed wait the
  // focus must leave the carousel and the mouse must move off it,
  // or the timer never runs and the wait times out for the wrong
  // reason.
  async function unfocusCarousel() {
    await page.evaluate(() => {
      const a = document.activeElement;
      if (a instanceof HTMLElement) a.blur();
    });
    await page.mouse.move(10, 10);
  }
  // Stacked crossfade, as the DOM can prove it: every slide is
  // rendered, exactly one is opacity-100, the rest are
  // opacity-0, the active slide's img (when it has one) carries
  // the slide's alt, and the hero shows no visible text at all.
  async function checkCrossfade(label) {
    // Settle first: a read mid-crossfade sees fractional
    // opacities, which is the fade working, not a failure.
    await activeSlideIndex();
    const state = await page.evaluate(() => {
      const slides = [...document.querySelectorAll('[data-testid="hero-slide"]')];
      const active = slides.findIndex((s) => getComputedStyle(s).opacity === "1");
      return {
        count: slides.length,
        active,
        opacities: slides.map((s) => getComputedStyle(s).opacity),
        imgs: slides.map((s) => {
          const img = s.querySelector("img");
          return img ? { src: img.getAttribute("src") ?? "", alt: img.getAttribute("alt") ?? "" } : null;
        }),
        alts: slides.map((s) => s.getAttribute("data-slide-alt") ?? ""),
        heroText: (document.querySelector('[data-testid="hero-carousel"]')?.textContent ?? "").trim(),
      };
    });
    check(`${name}: ${label} — all 3 slides rendered, stacked`, state.count === 3, `count=${state.count}`);
    check(`${name}: ${label} — exactly one slide is opacity-100`, state.active >= 0 && state.opacities.filter((o) => o === "1").length === 1, `opacities=${state.opacities.join(", ")}`);
    check(
      `${name}: ${label} — inactive slides are opacity-0 (not swapped out)`,
      state.opacities.every((o, i) => (i === state.active ? o === "1" : o === "0")),
      `opacities=${state.opacities.join(", ")}`,
    );
    check(
      `${name}: ${label} — active slide's image matches its alt`,
      state.active >= 0 &&
        (state.imgs[state.active] === null || state.imgs[state.active].alt === state.alts[state.active]),
      `active=${state.active} imgAlt=${state.imgs[state.active]?.alt} slideAlt=${state.alts[state.active]}`,
    );
    check(`${name}: ${label} — no text anywhere in the hero`, state.heroText === "", JSON.stringify(state.heroText.slice(0, 80)));
    return state.active;
  }

  // --- Home: fallback hero, green buttons, borders, duplicates -----------
  const loadedAt = Date.now();
  let resp = await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  check(`${name}: / loads 200`, resp?.status() === 200, `status=${resp?.status()}`);
  check(`${name}: hero carousel renders`, await page.locator('[data-testid="hero-carousel"]').count() === 1);
  // No banners in the mock: the fallback slides are the top three
  // products, image-only — identified by data-slide-alt (the
  // product title), never by a counter: there is no counter any
  // more, and no headline / CTA in the DOM.
  check(
    `${name}: hero falls back to the top-3 product slides, image-only`,
    JSON.stringify(await slideAlts()) === JSON.stringify(FALLBACK_ALTS),
    (await slideAlts()).join(" | "),
  );
  check(`${name}: first fallback slide is active`, (await activeSlideIndex()) === 0, `active=${await activeSlideIndex()}`);
  check(`${name}: hero has no counter any more`, (await page.locator('[data-testid="hero-counter"]').count()) === 0);
  check(`${name}: hero has no CTA any more`, (await page.locator('[data-testid="hero-cta"]').count()) === 0);
  check(
    `${name}: hero shows no visible text (no text panel, no headline)`,
    ((await page.locator('[data-testid="hero-carousel"]').innerText()) ?? "").trim() === "",
  );
  const heroBox = await page.locator('[data-testid="hero-carousel"]').boundingBox();
  if (isMobile) {
    check(`${name}: hero is a ~200px strip on mobile, not a takeover`, Math.abs((heroBox?.height ?? 0) - 200) <= 2, `height=${heroBox?.height}`);
  } else {
    check(`${name}: hero is capped at 380px on desktop`, Math.abs((heroBox?.height ?? 0) - 380) <= 2, `height=${heroBox?.height}`);
  }
  // The dots are overlaid ON the image now: their pill's box must
  // sit inside the carousel's box.
  const dotsBox = await page.locator('[data-testid="hero-carousel"] [role="tablist"]').boundingBox();
  check(
    `${name}: dots are overlaid on the image (inside the carousel box)`,
    !!dotsBox && !!heroBox &&
      dotsBox.x >= (heroBox.x ?? 0) - 1 &&
      dotsBox.y >= (heroBox.y ?? 0) - 1 &&
      dotsBox.x + dotsBox.width <= (heroBox.x ?? 0) + (heroBox.width ?? 0) + 1 &&
      dotsBox.y + dotsBox.height <= (heroBox.y ?? 0) + (heroBox.height ?? 0) + 1,
    `dots=${JSON.stringify(dotsBox)} hero=${JSON.stringify(heroBox)}`,
  );
  await checkCrossfade("fallback hero");
  await noOverflow("home");
  await shot("home");

  // Carousel behaviour.
  if (!isMobile) {
    // DESKTOP — timer reset: pick slide 0 by dot. The click is
    // ~1s after mount (the static checks above), so the 4.5s
    // timer the mount started would fire ~3.5s after this click
    // if it were not reset. Still slide 0 at 3s after the click
    // is the instructed check; still slide 0 at 4s after it is
    // past that old firing point, so it proves the reset. Then
    // the advance to slide 1 must land a full ~4.5s after the
    // click, not early.
    const pickedAt = Date.now();
    await page.locator('[data-testid="hero-dot-0"]').click();
    await unfocusCarousel();
    await sleep(Math.max(0, 3000 - (Date.now() - pickedAt)));
    check(`${name}: manual dot pick is NOT overridden after 3s (timer reset)`, (await activeSlideIndex()) === 0, `active=${await activeSlideIndex()}`);
    await sleep(1000);
    check(`${name}: still slide 0 at 4s after the pick (past the old timer)`, (await activeSlideIndex()) === 0, `active=${await activeSlideIndex()}`);
    const advanced = await waitFor(async () => (await activeSlideIndex()) === 1, 5000);
    check(`${name}: carousel auto-advances to slide 1 a full interval after the pick`, advanced, `active=${await activeSlideIndex()}`);

    // Arrows appear on hover; next wraps 1 -> 2 -> 0, prev wraps
    // 0 -> 2; dot 0 returns to slide 0.
    await page.hover('[data-testid="hero-carousel"]');
    await sleep(300);
    await page.locator('[data-testid="hero-next"]').click();
    await sleep(400);
    check(`${name}: next arrow moves to slide 2`, (await activeSlideIndex()) === 2, `active=${await activeSlideIndex()}`);
    await checkCrossfade("after next arrow");
    await page.locator('[data-testid="hero-next"]').click();
    await sleep(400);
    check(`${name}: next arrow wraps 2 -> 0`, (await activeSlideIndex()) === 0, `active=${await activeSlideIndex()}`);
    await page.locator('[data-testid="hero-prev"]').click();
    await sleep(400);
    check(`${name}: previous arrow wraps 0 -> 2`, (await activeSlideIndex()) === 2, `active=${await activeSlideIndex()}`);
    await page.locator('[data-testid="hero-dot-0"]').click();
    await sleep(400);
    check(`${name}: dot 0 returns to slide 0`, (await activeSlideIndex()) === 0, `active=${await activeSlideIndex()}`);

    // Timer reset after an ARROW click too: the next
    // auto-advance must come a full ~4.5s after the click, not
    // within ~1-2s (the old timer firing early).
    const arrowAt = Date.now();
    await page.locator('[data-testid="hero-next"]').click();
    await unfocusCarousel();
    await sleep(2000);
    check(`${name}: after an arrow click, no advance within 2s (timer reset)`, (await activeSlideIndex()) === 1, `active=${await activeSlideIndex()}`);
    const arrowAdvanced = await waitFor(async () => (await activeSlideIndex()) === 2, 5000);
    check(`${name}: after an arrow click, the advance lands a full interval later`, arrowAdvanced, `active=${await activeSlideIndex()} after ${Date.now() - arrowAt}ms`);

    // Keyboard arrows (the carousel region is focused by clicking
    // it — the dots sit inside the region now, so focus stays
    // in it after a dot click until unfocusCarousel blurs it).
    await page.locator('[data-testid="hero-carousel"]').click();
    await page.keyboard.press("ArrowRight");
    await sleep(400);
    check(`${name}: ArrowRight wraps 2 -> 0`, (await activeSlideIndex()) === 0, `active=${await activeSlideIndex()}`);
    await page.keyboard.press("ArrowLeft");
    await sleep(400);
    check(`${name}: ArrowLeft wraps 0 -> 2`, (await activeSlideIndex()) === 2, `active=${await activeSlideIndex()}`);
  } else {
    // MOBILE — the image-only redesign loops on a phone too: the
    // active slide must have moved from 0 by ~5.5s after load
    // (one 4.5s interval plus render time).
    const waitMs = Math.max(0, 5500 - (Date.now() - loadedAt));
    await sleep(waitMs);
    const moved = await activeSlideIndex();
    check(`${name}: carousel DOES auto-advance on mobile now`, moved !== 0, `active=${moved}`);
    const cdp = await context.newCDPSession(page);
    const box = await page.locator('[data-testid="hero-carousel"]').boundingBox();
    const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const beforeSwipe = await activeSlideIndex();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx + 80, y: cy, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx, y: cy, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 80, y: cy, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(500);
    const afterSwipe = await activeSlideIndex();
    check(`${name}: swipe left moves to the next slide`, afterSwipe === (beforeSwipe + 1) % 3, `before=${beforeSwipe} after=${afterSwipe}`);
    await checkCrossfade("after mobile swipe");
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

// Banners tab starts empty (the mock has no banners).
await signIn(page);
check("admin: sign-in lands on /account", page.url().includes("/account"), page.url());
await page.goto(`${BASE}/admin?tab=banners`, { waitUntil: "networkidle" });
await sleep(800);
check("admin: banners tab renders (kind select present)", (await page.locator('[data-testid="banner-kind"]').count()) === 1);
check("admin: no banners yet", (await page.locator('[data-testid="banner-item"]').count()) === 0);
// The image-only form has NO headline / subcopy / button fields.
for (const testid of ["banner-headline", "banner-subcopy", "banner-cta-label", "banner-cta-href"]) {
  check(`admin: no ${testid} field any more`, (await page.locator(`[data-testid="${testid}"]`).count()) === 0);
}

// The size note warns the admin about the wide banner size.
check(
  "admin: banner size note says 1600 x 640",
  ((await page.locator('[data-testid="banner-image-size-note"]').textContent()) ?? "").includes("1600 x 640"),
);

// Add a banner: Kind = Offer, uploaded photo, save.
await page.locator('[data-testid="banner-kind"]').selectOption("offer");
await page.locator('[data-testid="banner-upload-input"]').setInputFiles(BANNER_PHOTO);
await page.locator('[data-testid="banner-upload-button"]').click();
const uploaded = await waitFor(async () => {
  const v = await page.locator('[data-testid="banner-image-path"]').inputValue();
  return v.startsWith("banner-offer-");
}, 15000);
check("admin: banner photo uploads (path starts banner-offer-)", uploaded, await page.locator('[data-testid="banner-image-path"]').inputValue());
await page.locator('[data-testid="banner-save"]').click();
const bannerSaved = await waitFor(async () => (await page.locator('[data-testid="banner-item"]').count()) === 1, 10000);
check("admin: banner is saved and listed", bannerSaved);
check(
  "admin: banner list shows the Offer badge",
  ((await page.locator('[data-testid="banner-item"]').first().textContent()) ?? "").includes("Offer"),
);
check(
  "admin: banner list shows the derived headline as its label",
  ((await page.locator('[data-testid="banner-item"]').first().textContent()) ?? "").includes("Offer banner"),
);
// The mock round-trips the new kind column (the app selects
// BANNER_COLUMNS incl. kind): the stored row says offer.
const bannerRows = await mockGet("banners?select=id,kind,headline");
check("admin: mock banner row stores kind=offer", bannerRows?.[0]?.kind === "offer", JSON.stringify(bannerRows));

// The banner takes over the home hero — one image-only slide,
// alt "Offer banner", no dots, the uploaded photo rendering.
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await sleep(800);
check(
  "admin: home hero shows the new banner (alt Offer banner)",
  (await page.locator('[data-testid="hero-slide"]').getAttribute("data-slide-alt")) === "Offer banner",
);
check(
  "admin: hero is image-only with the banner (no visible text)",
  ((await page.locator('[data-testid="hero-carousel"]').innerText()) ?? "").trim() === "",
);
check("admin: one banner means no dots", (await page.locator('[data-testid="hero-dot-0"]').count()) === 0);
check(
  "admin: banner photo renders (not the placeholder)",
  (await page.locator('[data-testid="hero-carousel"] img').count()) >= 1,
);
await page.screenshot({ path: `${SHOTS}/banner-desktop-home.png` });
// Banner-active hero at the other two widths too (same banner).
for (const { name, width, height } of [
  { name: "laptop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    ...(width < 640 ? { hasTouch: true, isMobile: true } : {}),
  });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await sleep(500);
  check(
    `admin: banner hero at ${name} shows alt Offer banner`,
    (await p.locator('[data-testid="hero-slide"]').getAttribute("data-slide-alt")) === "Offer banner",
  );
  check(
    `admin: banner hero at ${name} shows no visible text`,
    ((await p.locator('[data-testid="hero-carousel"]').innerText()) ?? "").trim() === "",
  );
  await p.screenshot({ path: `${SHOTS}/banner-${name}-home.png` });
  await ctx.close();
}

// Edit the banner's kind to Promotion: the badge and the hero
// alt must both update.
await page.goto(`${BASE}/admin?tab=banners`, { waitUntil: "networkidle" });
await sleep(800);
await page.locator('[data-testid="banner-edit"]').first().click();
await sleep(400);
check(
  "admin: edit form opens with Kind = Offer",
  (await page.locator('[data-testid="banner-kind"]').inputValue()) === "offer",
);
await page.locator('[data-testid="banner-kind"]').selectOption("promotion");
await page.locator('[data-testid="banner-save"]').click();
const kindEdited = await waitFor(async () =>
  ((await page.locator('[data-testid="banner-item"]').first().textContent()) ?? "").includes("Promotion"),
  10000,
);
check("admin: banner kind edit sticks (Promotion badge)", kindEdited);
check(
  "admin: edited banner row stores kind=promotion",
  (await mockGet("banners?select=id,kind"))?.[0]?.kind === "promotion",
);
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await sleep(800);
check(
  "admin: home hero alt updates to Promotion banner",
  (await page.locator('[data-testid="hero-slide"]').getAttribute("data-slide-alt")) === "Promotion banner",
);

// Hide it: the home hero falls back to product slides again.
await page.goto(`${BASE}/admin?tab=banners`, { waitUntil: "networkidle" });
await sleep(800);
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
  JSON.stringify(
    await page.locator('[data-testid="hero-slide"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-slide-alt") ?? "")),
  ) === JSON.stringify(FALLBACK_ALTS),
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
check("admin: mock is left clean (0 banners)", (await mockGet("banners?select=id"))?.length === 0);
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await sleep(800);
check(
  "admin: after delete the hero is the product fallback again",
  JSON.stringify(
    await page.locator('[data-testid="hero-slide"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-slide-alt") ?? "")),
  ) === JSON.stringify(FALLBACK_ALTS),
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
