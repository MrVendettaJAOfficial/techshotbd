// TechShot Playwright check: universal 1200x1200 square product images,
// the mobile horizontal-overflow fix, and the admin upload-size warning.
//
//   A. No page-level horizontal overflow at 1440 / 1280 / 390 / 360 on
//      /, /shop and the iPhone product page (the overflow culprit was
//      the header: at a 360px viewport its hamburger + logo + icons
//      measured 377px wide, so document.scrollWidth was 377 > 360).
//   B. Product cards are the same height within a row on /shop (and
//      the home flash-deals grid), at desktop and laptop widths.
//   C. The gallery main image is square and stays full-size (it is
//      NOT part of the card-thumbnail resize), and its thumbnails fit
//      the viewport.
//   D. The subscription placeholder (Netflix, no photo) still renders
//      square; cart recommendation thumbs are square too.
//   E. The admin product form shows the exact recommended-size note
//      next to the photo-path list and next to the upload control.
//   F. Zero page errors throughout. (Failed image requests are NOT
//      counted: the mock serves no Storage objects, so the image
//      optimiser 404s there by design — the live load is verified
//      after deploy, as before.)
//
// Run it (same mock setup as the other e2e scripts):
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 node tests/e2e/image-size.mjs
//
// Needs a Chromium: the launchBrowser fallback below uses the cached
// chromium-1148 build (same as tests/e2e/roles-admin-tabs.mjs).
// Exits non-zero when any check fails.

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
const IPHONE = "/product/apple-iphone-16-pro-256gb-natural-titanium";
const SIZE_NOTE =
  "Recommended size: 1200 x 1200 px (square). Larger images are cropped to this size automatically.";

const failures = [];
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(name);
}

async function launchBrowser() {
  const opts = { args: ["--no-sandbox"] };
  try {
    return await chromium.launch(opts);
  } catch {
    const exe = process.env.CHROMIUM_PATH ?? "/home/hatch/.cache/ms-playwright/chromium-1148/chrome-linux/chrome";
    return await chromium.launch({ ...opts, executablePath: exe });
  }
}

// scrollWidth vs innerWidth, plus any element (outside an internal
// horizontal scroller or a fixed off-canvas drawer) sticking out.
async function noOverflow(page, width) {
  return page.evaluate((expected) => {
    const vw = window.innerWidth;
    const de = document.documentElement;
    const overflow = de.scrollWidth > vw + 1 || vw !== expected;
    const sticking = [];
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 0.5 && r.left >= -0.5) return;
      // A fixed element itself (e.g. the closed filter drawer, parked
      // off-canvas at left=-335) never widens the document — fixed
      // boxes do not expand scrollWidth — so it is not an offender.
      if (getComputedStyle(el).position === "fixed") return;
      let a = el.parentElement;
      let contained = false;
      let fixed = false;
      while (a) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowX === "hidden") {
          contained = true;
          break;
        }
        if (cs.position === "fixed") {
          fixed = true;
          break;
        }
        a = a.parentElement;
      }
      if (!contained && !fixed) {
        sticking.push(`${el.tagName}.${(el.className?.baseVal ?? el.className ?? "").toString().slice(0, 60)} right=${Math.round(r.right)}`);
      }
    });
    return { overflow, scrollW: de.scrollWidth, innerW: vw, sticking: sticking.slice(0, 5) };
  }, width);
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
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) =>
      x.textContent.includes("Sign in"),
    );
    b && b.click();
  });
  await sleep(3000);
}

const browser = await launchBrowser();
const pageErrors = [];
const page = await browser.newPage();
page.on("pageerror", (err) => pageErrors.push(String(err)));

// --- A + B. Overflow and equal card heights, at every width. ---
for (const { label, width, height, touch } of [
  { label: "desktop 1440", width: 1440, height: 900, touch: false },
  { label: "laptop 1280", width: 1280, height: 800, touch: false },
  { label: "mobile 390", width: 390, height: 844, touch: true },
  { label: "small phone 360", width: 360, height: 800, touch: true },
]) {
  await page.setViewportSize({ width, height });
  if (touch) await page.context().setExtraHTTPHeaders({});
  for (const path of ["/", "/shop", IPHONE]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await sleep(400);
    const ov = await noOverflow(page, width);
    check(
      `${label}: no horizontal overflow on ${path}`,
      !ov.overflow && ov.sticking.length === 0,
      `scrollW=${ov.scrollW} innerW=${ov.innerW} sticking=${JSON.stringify(ov.sticking)}`,
    );
  }

  // Equal card heights within each row on /shop (3 cols at 1440,
  // 2 at 1280, 1 at mobile — the multi-column widths are the test).
  if (width >= 1280) {
    await page.goto(`${BASE}/shop`, { waitUntil: "networkidle" });
    await sleep(400);
    const rows = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("main article, div article")].filter((a) =>
        a.querySelector("h3"),
      );
      const byTop = new Map();
      for (const c of cards) {
        const top = Math.round(c.getBoundingClientRect().top);
        if (!byTop.has(top)) byTop.set(top, []);
        byTop.get(top).push(Math.round(c.getBoundingClientRect().height));
      }
      return [...byTop.values()].map((hs) => ({ n: hs.length, min: Math.min(...hs), max: Math.max(...hs) }));
    });
    const level = rows.length > 0 && rows.every((r) => r.max - r.min <= 1);
    check(
      `${label}: shop cards are the same height within a row`,
      level,
      JSON.stringify(rows),
    );
  }
}

// --- B2. Card thumbnails are capped smaller than the card (the added
// scope): square, centred, 220px at every width.
for (const { label, width, height } of [
  { label: "desktop 1440", width: 1440, height: 900 },
  { label: "laptop 1280", width: 1280, height: 800 },
  { label: "mobile 390", width: 390, height: 844 },
]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle" });
  await sleep(400);
  const thumb = await page.evaluate(() => {
    const card = document.querySelector("article");
    if (!card) return null;
    const img = card.querySelector(".aspect-square");
    if (!img) return null;
    const c = card.getBoundingClientRect();
    const b = img.getBoundingClientRect();
    return {
      cardW: Math.round(c.width),
      imgW: Math.round(b.width),
      imgH: Math.round(b.height),
      imgX: Math.round(b.left),
      cardX: Math.round(c.left),
    };
  });
  const cap = 221;
  check(
    `${label}: card thumbnail is square and capped at 220px`,
    !!thumb && thumb.imgW === thumb.imgH && thumb.imgW <= cap,
    JSON.stringify(thumb),
  );
  check(
    `${label}: card thumbnail is clearly smaller than its card`,
    !!thumb && thumb.imgW < thumb.cardW * 0.8,
    JSON.stringify(thumb),
  );
}

// --- C. Gallery: square main image, capped on mobile, thumbs fit. ---
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE + IPHONE, { waitUntil: "networkidle" });
await sleep(500);
const gallery = await page.evaluate(() => {
  const main = document.querySelector('[data-testid="gallery-main"]');
  const r = main?.getBoundingClientRect();
  const thumbs = [...document.querySelectorAll('[data-testid^="gallery-thumb-"]')].map((t) => {
    const b = t.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) };
  });
  return {
    main: r ? { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) } : null,
    thumbs,
    counter: document.querySelector('[data-testid="gallery-counter"]')?.textContent ?? "",
  };
});
check(
  "mobile 390: gallery main image is square",
  !!gallery.main && gallery.main.w === gallery.main.h,
  JSON.stringify(gallery.main),
);
check(
  // The gallery is NOT part of the card-thumbnail resize: the main
  // photo stays full-size square — full content width (~358px at
  // 390px), not capped.
  "mobile 390: gallery main image stays full-width square",
  !!gallery.main && gallery.main.w > 340,
  `width=${gallery.main?.w}`,
);
check(
  "mobile 390: gallery thumbnails are square and inside the viewport",
  gallery.thumbs.length > 0 &&
    gallery.thumbs.every((t) => t.w === t.h && t.right <= 390),
  JSON.stringify(gallery.thumbs),
);
check("mobile 390: iPhone gallery has its photos", gallery.counter.includes("Photo 1 of"), gallery.counter);

// --- D. Subscription placeholder renders square; cart thumbs square. ---
await page.goto(`${BASE}/product/netflix-premium-1-month`, { waitUntil: "networkidle" });
await sleep(500);
const placeholder = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="product-placeholder"]');
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { w: Math.round(b.width), h: Math.round(b.height) };
});
check(
  "subscription placeholder still renders square",
  !!placeholder && placeholder.w === placeholder.h && placeholder.w > 0,
  JSON.stringify(placeholder),
);

// Add the iPhone to the cart, then check the recommendation thumbs.
await page.goto(`${BASE}/shop`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter((b) =>
    b.textContent.trim().startsWith("Add to Cart"),
  );
  btns[0] && btns[0].click();
});
await sleep(1200);
await page.goto(`${BASE}/cart`, { waitUntil: "networkidle" });
await sleep(500);
const cartThumbs = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll("main img")].map((img) => {
    const box = img.closest("div[class*='aspect-square']") ?? img;
    const b = box.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height) };
  });
  return imgs;
});
check(
  "cart images are square",
  cartThumbs.length > 0 && cartThumbs.every((t) => t.w === t.h && t.w > 0),
  JSON.stringify(cartThumbs),
);

// --- E. Admin form shows the size note in both places (exact text). ---
await signIn(page);
await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle" });
await sleep(800);
const notes = await page.evaluate(() => {
  const byId = (id) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? "";
  return { list: byId("photo-size-note"), upload: byId("photo-upload-size-note") };
});
check("admin: size note next to the photo-path list", notes.list === SIZE_NOTE, notes.list);
check("admin: size note next to the upload control", notes.upload === SIZE_NOTE, notes.upload);

// --- F. Zero page errors. ---
check("zero page errors across the whole run", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} FAILURES: ${failures.join("; ")}`);
process.exit(failures.length === 0 ? 0 : 1);
