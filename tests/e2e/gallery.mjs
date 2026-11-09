// TechShot Playwright check: multi-angle product gallery + admin photo upload.
//
// One run covering the 2026-11-09 gallery build, against the mock
// Supabase (no real keys):
//
//   A. Desktop gallery (1280x800, mouse) — the iPhone product page
//      has 4 photos (main + 3 extra angles from the mock's
//      product_images rows): the slider auto-advances, hovering
//      pauses it and shows previous / next arrows, the arrows and
//      the thumbnails change the photo, keyboard arrows work, and
//      selecting Black Titanium puts the variant photo first.
//      Tapping the main photo opens the viewer: zoom in/out buttons
//      change the zoom level, Escape closes it and focus returns to
//      the main photo button.
//   B. Mobile gallery (390x844, touch) — no auto-slide over 6s, no
//      arrow buttons, no zoom buttons: swipe left / right changes
//      the photo, the viewer opens on tap with only a close button,
//      swipe in the viewer changes the photo, and a two-finger pinch
//      zooms in (CDP multi-touch).
//   C. Admin photo upload (MOCK_ADMIN=1) — sign in as the seeded
//      admin, open /admin, upload a photo from the form (it lands in
//      the mock bucket and its generated filename fills the photo
//      list), add a second photo row by filename, save the product,
//      and confirm two product_images rows with sort_order 0 and 1
//      in the mock database.
//
// The mock's Black Titanium photo is a STAND-IN ONLY: it is the
// Sony headphones shot (sony-wh-1000xm5.jpg), chosen so nobody
// mistakes it for a real Black Titanium iPhone photo. No real
// per-colour photos exist yet. What is proven here is the switching
// mechanism, not that any real colour photo exists.
//
// Run (see README, "End-to-end checks"):
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 node tests/e2e/gallery.mjs
//
// Needs a Chromium: playwright-core resolvable (it is NOT a repo
// dependency) and the chromium-1148 fallback below. Exits non-zero
// when any check fails.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
const IPHONE = "/product/apple-iphone-16-pro-256gb-natural-titanium";
const STAND_IN_PHOTO = "sony-wh-1000xm5.jpg";
const UPLOAD_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/images/products/jbl-flip-6.jpg",
);
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

async function mockGet(path) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, { headers: { apikey: "mock-anon-key" } });
  return res.json();
}

async function counterText(page) {
  const el = await page.$('[data-testid="gallery-counter"]');
  if (!el) return "";
  return (await el.textContent()) ?? "";
}

async function mainImgSrc(page) {
  const el = await page.$('[data-testid="gallery-open-viewer"] img');
  if (!el) return "";
  return (await el.getAttribute("src")) ?? "";
}

async function waitForCounter(page, expected, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await counterText(page)).includes(expected)) return true;
    await sleep(250);
  }
  return false;
}

// --- CDP touch gestures (Playwright's touchscreen API only taps) ---

async function cdpTouchSwipe(page, fromX, fromY, toX, toY) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: fromX, y: fromY, id: 1 }],
  });
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: fromX + ((toX - fromX) * i) / steps, y: fromY + ((toY - fromY) * i) / steps, id: 1 }],
    });
    await sleep(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function cdpPinch(page, cx, cy, startGap, endGap) {
  const cdp = await page.context().newCDPSession(page);
  const p1 = (d) => ({ x: cx - d / 2, y: cy, id: 1 });
  const p2 = (d) => ({ x: cx + d / 2, y: cy, id: 2 });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [p1(startGap), p2(startGap)],
  });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const d = startGap + ((endGap - startGap) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [p1(d), p2(d)],
    });
    await sleep(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

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

async function setField(page, id, value) {
  await page.evaluate(
    ({ id, value }) => {
      const el = document.getElementById(id);
      const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    },
    { id, value },
  );
}

async function main() {
  const browser = await launchBrowser();

  // ------------------------------------------------------------------
  // A. Desktop gallery.
  // ------------------------------------------------------------------
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  page.on("pageerror", (error) => {
    console.log("PAGE ERROR:", error.message);
    failures.push(`pageerror: ${error.message}`);
  });
  await page.goto(`${BASE}${IPHONE}`, { waitUntil: "networkidle" });
  await sleep(1500);

  // Thumbnails are server-rendered, but poll briefly rather than
  // snapshotting once — a slow first paint once made this check
  // read the count before the gallery arrived.
  const thumbCount = await page
    .waitForFunction(
      () => document.querySelectorAll('[data-testid^="gallery-thumb-"]').length === 4,
      { timeout: 10000 },
    )
    .then(() => 4)
    .catch(() => 0);
  check("desktop: 4 thumbnails for the iPhone's 4 photos", thumbCount === 4);
  check("desktop: counter starts at Photo 1 of 4", (await counterText(page)).includes("Photo 1 of 4"));
  check("desktop: main photo is the iPhone shot", (await mainImgSrc(page)).includes("apple-iphone-16-pro-256gb-natural-titanium.jpg"));

  check(
    "desktop: slider auto-advances to Photo 2 of 4",
    await waitForCounter(page, "Photo 2 of 4"),
    "no advance in 12s",
  );

  // Hover pauses the slider and shows the arrows.
  await page.hover('[data-testid="gallery-main"]');
  await sleep(300);
  const pausedCounter = await counterText(page);
  const arrowsVisible =
    (await page.$('[data-testid="gallery-prev"]')) !== null &&
    (await page.$('[data-testid="gallery-next"]')) !== null;
  check("desktop: hovering shows previous / next arrows", arrowsVisible);
  await sleep(6000);
  check(
    "desktop: hovering pauses the slider (counter unchanged for 6s)",
    (await counterText(page)) === pausedCounter,
    `was ${pausedCounter}, now ${await counterText(page)}`,
  );

  // Arrow click moves one photo; thumbnails jump; keyboard works.
  await page.click('[data-testid="gallery-next"]');
  await sleep(400);
  const afterArrow = await counterText(page);
  check("desktop: next arrow moves one photo", afterArrow !== pausedCounter, afterArrow);
  await page.click('[data-testid="gallery-thumb-0"]');
  await sleep(400);
  check("desktop: thumbnail 1 jumps back to Photo 1 of 4", (await counterText(page)).includes("Photo 1 of 4"));
  // Focus the gallery region directly — clicking it would hit the
  // main-photo button and open the viewer instead.
  await page.focus('[data-testid="gallery-main"]');
  await page.keyboard.press("ArrowRight");
  await sleep(400);
  check("desktop: keyboard ArrowRight advances", (await counterText(page)).includes("Photo 2 of 4"));

  // Variant photo goes first: Black Titanium (stand-in) + 4 photos.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Black Titanium");
    b && b.click();
  });
  await sleep(600);
  check("desktop: Black Titanium shows 5 photos (variant first + 4 angles)", (await counterText(page)).includes("Photo 1 of 5"));
  check(
    "desktop: Black Titanium main photo is the variant photo",
    (await mainImgSrc(page)).includes(STAND_IN_PHOTO),
    await mainImgSrc(page),
  );
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Natural Titanium");
    b && b.click();
  });
  await sleep(600);
  check("desktop: back to Natural Titanium falls back to 4 photos", (await counterText(page)).includes("Photo 1 of 4"));

  // Viewer: zoom buttons work, Escape closes, focus returns.
  await page.click('[data-testid="gallery-open-viewer"]');
  await sleep(500);
  check("desktop: viewer opens on main photo tap", (await page.$('[data-testid="photo-viewer"]')) !== null);
  check("desktop: viewer has zoom in / out buttons", (await page.$('[data-testid="viewer-zoom-in"]')) !== null && (await page.$('[data-testid="viewer-zoom-out"]')) !== null);
  await page.click('[data-testid="viewer-zoom-in"]');
  await sleep(300);
  check("desktop: zoom in once shows 150%", ((await page.textContent('[data-testid="viewer-zoom-level"]')) ?? "").includes("150%"));
  await page.click('[data-testid="viewer-zoom-in"]');
  await sleep(300);
  check("desktop: zoom in twice shows 225%", ((await page.textContent('[data-testid="viewer-zoom-level"]')) ?? "").includes("225%"));
  await page.keyboard.press("Escape");
  await sleep(400);
  check("desktop: Escape closes the viewer", (await page.$('[data-testid="photo-viewer"]')) === null);
  const focusedAfterEscape = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  check("desktop: focus returns to the main photo button after Escape", focusedAfterEscape === "gallery-open-viewer", String(focusedAfterEscape));
  await desktop.close();

  // ------------------------------------------------------------------
  // B. Mobile gallery (touch).
  // ------------------------------------------------------------------
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const mpage = await mobile.newPage();
  mpage.on("pageerror", (error) => {
    console.log("MOBILE PAGE ERROR:", error.message);
    failures.push(`mobile pageerror: ${error.message}`);
  });
  await mpage.goto(`${BASE}${IPHONE}`, { waitUntil: "networkidle" });
  await sleep(1500);
  check("mobile: counter starts at Photo 1 of 4", (await counterText(mpage)).includes("Photo 1 of 4"));
  check("mobile: no arrow buttons without hovering", (await mpage.$('[data-testid="gallery-prev"]')) === null && (await mpage.$('[data-testid="gallery-next"]')) === null);
  const mobileBefore = await counterText(mpage);
  await sleep(6000);
  check("mobile: no auto-slide over 6s", (await counterText(mpage)) === mobileBefore, `was ${mobileBefore}, now ${await counterText(mpage)}`);

  // Swipe left / right on the main photo.
  const box = await mpage.$eval('[data-testid="gallery-main"]', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const cy = box.y + box.height / 2;
  await cdpTouchSwipe(mpage, box.x + box.width * 0.8, cy, box.x + box.width * 0.2, cy);
  await sleep(500);
  check("mobile: swipe left advances to Photo 2 of 4", (await counterText(mpage)).includes("Photo 2 of 4"), await counterText(mpage));
  await cdpTouchSwipe(mpage, box.x + box.width * 0.2, cy, box.x + box.width * 0.8, cy);
  await sleep(500);
  check("mobile: swipe right goes back to Photo 1 of 4", (await counterText(mpage)).includes("Photo 1 of 4"), await counterText(mpage));

  // Viewer on mobile: no zoom buttons, no arrows — swipe + pinch only.
  await mpage.tap('[data-testid="gallery-open-viewer"]');
  await sleep(500);
  check("mobile: viewer opens on tap", (await mpage.$('[data-testid="photo-viewer"]')) !== null);
  check("mobile: viewer has no zoom buttons", (await mpage.$('[data-testid="viewer-zoom-in"]')) === null && (await mpage.$('[data-testid="viewer-zoom-out"]')) === null);
  check("mobile: viewer has no arrows", (await mpage.$('[data-testid="viewer-prev"]')) === null && (await mpage.$('[data-testid="viewer-next"]')) === null);
  check("mobile: viewer has a close button", (await mpage.$('[data-testid="viewer-close"]')) !== null);
  const stageBox = await mpage.$eval('[data-testid="viewer-stage"]', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const scy = stageBox.y + stageBox.height / 2;
  await cdpTouchSwipe(mpage, stageBox.x + stageBox.width * 0.8, scy, stageBox.x + stageBox.width * 0.2, scy);
  await sleep(500);
  check("mobile: swipe in the viewer advances to Photo 2 of 4", ((await mpage.textContent('[data-testid="viewer-counter"]')) ?? "").includes("Photo 2 of 4"));
  // Pinch out (fingers apart) zooms in: the stage transform gains a scale above 1.
  await cdpPinch(mpage, stageBox.x + stageBox.width / 2, scy, 60, 240);
  await sleep(500);
  const stageTransform = await mpage.$eval('[data-testid="viewer-stage"] > div', (el) => el.style.transform);
  const pinchZoomed = /scale\((?!1(\.0+)?\))/.test(stageTransform);
  check("mobile: pinch out zooms the photo in", pinchZoomed, stageTransform);
  await mpage.tap('[data-testid="viewer-close"]');
  await sleep(400);
  check("mobile: close button closes the viewer", (await mpage.$('[data-testid="photo-viewer"]')) === null);
  await mobile.close();

  // ------------------------------------------------------------------
  // C. Admin photo upload (MOCK_ADMIN=1).
  // ------------------------------------------------------------------
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const apage = await adminCtx.newPage();
  apage.on("pageerror", (error) => {
    console.log("ADMIN PAGE ERROR:", error.message);
    failures.push(`admin pageerror: ${error.message}`);
  });
  await signIn(apage);
  // The admin is tabbed since the roles build (2026-11-09): plain
  // /admin shows the Overview tab, and the product form (photo list,
  // upload) lives on the Products tab.
  await apage.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle" });
  await sleep(1500);
  check("admin: photo list has a main photo row", (await apage.$('[data-testid="product-photo-0"]')) !== null);
  check("admin: add-photo-row and upload controls exist", (await apage.$('[data-testid="add-photo-row"]')) !== null && (await apage.$('[data-testid="photo-upload-input"]')) !== null);

  await setField(apage, "product-title", "Gallery Test Product");
  await apage.setInputFiles('[data-testid="photo-upload-input"]', UPLOAD_FILE);
  await apage.click('[data-testid="photo-upload-button"]');
  await sleep(2500);
  const photo0 = await apage.inputValue('[data-testid="product-photo-0"]');
  check(
    "admin: upload fills the photo list with a generated filename",
    /^gallery-test-product-[a-z0-9]+-[a-z0-9]+\.jpg$/.test(photo0),
    photo0,
  );
  const uploadNotice = await apage.evaluate(() => {
    const el = [...document.querySelectorAll('[role="status"]')].map((x) => x.textContent).join(" ");
    return el;
  });
  check("admin: upload shows a success notice", uploadNotice.includes("Uploaded 1 photo"), uploadNotice);

  await apage.click('[data-testid="add-photo-row"]');
  await sleep(300);
  check("admin: add-photo-row adds a second photo row", (await apage.$('[data-testid="product-photo-1"]')) !== null);
  await setField(apage, "product-photo-1", "jbl-flip-6.jpg");
  await setField(apage, "product-category", "audio");
  await setField(apage, "product-price", "1999");
  await setField(apage, "product-stock", "5");
  await setField(apage, "product-status", "draft");
  await apage.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Add product"));
    b && b.click();
  });
  await sleep(2500);
  const savedNotice = await apage.evaluate(() => {
    const el = [...document.querySelectorAll('[role="status"]')].map((x) => x.textContent).join(" ");
    return el;
  });
  check("admin: product saves with two photos", savedNotice.includes("Gallery Test Product") && savedNotice.includes("was added"), savedNotice);

  const created = await mockGet(`products?title=eq.Gallery%20Test%20Product&select=id,slug`);
  const createdId = created?.[0]?.id;
  check("admin: product exists in the mock database", Boolean(createdId), JSON.stringify(created));
  if (createdId) {
    const imageRows = await mockGet(`product_images?product_id=eq.${createdId}&select=storage_path,sort_order&order=sort_order.asc`);
    check(
      "admin: two product_images rows with sort_order 0 and 1",
      Array.isArray(imageRows) && imageRows.length === 2 && imageRows[0].sort_order === 0 && imageRows[1].sort_order === 1,
      JSON.stringify(imageRows),
    );
    check(
      "admin: first image row is the uploaded file",
      Array.isArray(imageRows) && typeof imageRows[0]?.storage_path === "string" && imageRows[0].storage_path.startsWith("gallery-test-product-"),
      JSON.stringify(imageRows?.[0]),
    );
    // Clean up so the run is repeatable.
    await fetch(`${MOCK}/rest/v1/products?id=eq.${createdId}`, {
      method: "DELETE",
      headers: { apikey: "mock-anon-key" },
    });
  }
  await adminCtx.close();

  await browser.close();
  console.log(failures.length === 0 ? "\nALL CHECKS PASSED" : `\n${failures.length} FAILURES:\n- ${failures.join("\n- ")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("gallery e2e crashed:", error);
  process.exit(2);
});
