// TechShot Playwright check: responsiveness of the gallery + admin
// multi-photo form at three widths — desktop 1440, laptop 1280,
// mobile 390 (touch). Standing rule: every page and feature must work
// and look right on all three.
//
//   A. Product page at each width — the iPhone has 4 photos (5 with a
//      colour variant picked): no horizontal page overflow, the main
//      photo, counter, arrows (desktop/laptop on hover) and every
//      thumbnail inside the viewport, nothing cut off or unreachable.
//   B. Fullscreen viewer at each width — fills the viewport, image,
//      counter and close button inside it; zoom buttons on
//      desktop/laptop only, swipe + pinch only on mobile.
//   C. Mobile touch — no auto-slide, swipe left/right changes the
//      photo, pinch zooms in the viewer (CDP multi-touch).
//   D. Admin form at each width — photo rows (input + move/remove
//      buttons), upload controls, add-photo-row and submit all inside
//      the viewport, no horizontal overflow, adding a second row stays
//      inside the viewport.
//   E. Quick overflow sweep at 390 on / and /shop.
//
// Run (see README, "End-to-end checks"):
//   Mock:      MOCK_ADMIN=1 node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 node tests/e2e/responsive-gallery.mjs
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
const MOCK = (process.env.MOCK_URL ?? "http://127.0.0.1:3101").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IPHONE = "/product/apple-iphone-16-pro-256gb-natural-titanium";

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

// Horizontal page overflow: the document must never be wider than
// the viewport, at any width. A single pixel of tolerance covers
// sub-pixel rounding. The layout viewport must also stay exactly the
// context width: on mobile an overflowing page widens the layout
// viewport to fit the content (innerWidth grows past the device
// width), which makes scrollWidth == innerWidth even though the page
// renders wider than the screen — so equality of the two widths
// alone does NOT prove there is no overflow.
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

// Every element matching the selector must sit fully inside the
// viewport horizontally (vertical position does not matter — the
// page scrolls). Returns a list of offenders, empty when all fit.
async function horizontalOffenders(page, selector) {
  return page.evaluate((sel) => {
    const vw = window.innerWidth;
    const bad = [];
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.left < -1 || r.right > vw + 1)) {
        bad.push(`${sel} left=${Math.round(r.left)} right=${Math.round(r.right)} vw=${vw}`);
      }
    });
    return bad;
  }, selector);
}

async function counterNum(page) {
  const el = await page.$('[data-testid="gallery-counter"]');
  if (!el) return null;
  const text = (await el.textContent()) ?? "";
  const m = /Photo (\d+) of (\d+)/.exec(text);
  return m ? { current: Number(m[1]), total: Number(m[2]), text } : null;
}

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

  // --- A. Product page layout ---
  await page.goto(`${BASE}${IPHONE}`, { waitUntil: "networkidle0" });
  await sleep(1000);

  let ov = await pageOverflow(page, width);
  check(`${label}: product page has no horizontal overflow (4 photos)`, !ov.overflow, `scrollW=${ov.scrollW} innerW=${ov.innerW}`);

  let bad = await horizontalOffenders(page, '[data-testid="gallery-main"]');
  check(`${label}: gallery main photo is inside the viewport`, bad.length === 0, bad.join("; "));
  bad = await horizontalOffenders(page, '[data-testid="gallery-counter"]');
  check(`${label}: gallery counter is inside the viewport`, bad.length === 0, bad.join("; "));
  bad = await horizontalOffenders(page, '[data-testid^="gallery-thumb-"]');
  check(`${label}: all 4 thumbnails are inside the viewport`, bad.length === 0, bad.join("; "));

  if (touch) {
    // No auto-slide on mobile: the counter must not move over 6s.
    const before = await counterNum(page);
    await sleep(6000);
    const after = await counterNum(page);
    check(
      `${label}: no auto-slide over 6s`,
      before !== null && after !== null && before.current === after.current,
      `before=${before?.text} after=${after?.text}`,
    );
    bad = await horizontalOffenders(page, '[data-testid="gallery-prev"], [data-testid="gallery-next"]');
    check(`${label}: no arrow buttons on mobile`, (await page.locator('[data-testid="gallery-prev"]').count()) === 0, bad.join("; "));

    // Swipe left / right changes the photo.
    const box = await page.locator('[data-testid="gallery-main"]').boundingBox();
    if (box) {
      const cy = box.y + box.height / 2;
      await cdpTouchSwipe(page, box.x + box.width * 0.8, cy, box.x + box.width * 0.2, cy);
      await sleep(600);
      const afterSwipe = await counterNum(page);
      check(`${label}: swipe left advances to Photo 2 of 4`, afterSwipe?.current === 2, afterSwipe?.text);
      await cdpTouchSwipe(page, box.x + box.width * 0.2, cy, box.x + box.width * 0.8, cy);
      await sleep(600);
      const afterBack = await counterNum(page);
      check(`${label}: swipe right goes back to Photo 1 of 4`, afterBack?.current === 1, afterBack?.text);
    } else {
      check(`${label}: swipe left advances to Photo 2 of 4`, false, "gallery has no bounding box");
      check(`${label}: swipe right goes back to Photo 1 of 4`, false, "gallery has no bounding box");
    }
  } else {
    // Hover pauses the slider and shows the arrows.
    await page.hover('[data-testid="gallery-main"]');
    await sleep(400);
    const prevVisible = await page.locator('[data-testid="gallery-prev"]').isVisible().catch(() => false);
    const nextVisible = await page.locator('[data-testid="gallery-next"]').isVisible().catch(() => false);
    check(`${label}: hover shows the previous / next arrows`, prevVisible && nextVisible);
    bad = await horizontalOffenders(page, '[data-testid="gallery-prev"], [data-testid="gallery-next"]');
    check(`${label}: arrows are inside the viewport`, bad.length === 0, bad.join("; "));
    const before = await counterNum(page);
    await page.click('[data-testid="gallery-next"]');
    await sleep(500);
    const after = await counterNum(page);
    const expected = before && after ? (before.current % before.total) + 1 : -1;
    check(`${label}: arrow click changes the photo`, after?.current === expected, `before=${before?.text} after=${after?.text}`);
  }

  // Colour variant picked: 5 photos (variant first) — the widest
  // thumbnail row. Nothing may overflow at any width.
  await page.getByRole("button", { name: "Black Titanium" }).click();
  await sleep(800);
  ov = await pageOverflow(page, width);
  check(`${label}: no horizontal overflow with 5 photos (variant picked)`, !ov.overflow, `scrollW=${ov.scrollW} innerW=${ov.innerW}`);
  bad = await horizontalOffenders(page, '[data-testid^="gallery-thumb-"]');
  check(`${label}: all 5 thumbnails are inside the viewport`, bad.length === 0, bad.join("; "));

  // --- B. Fullscreen viewer layout ---
  await page.click('[data-testid="gallery-open-viewer"]');
  await sleep(800);
  const viewerBox = await page.locator('[data-testid="photo-viewer"]').boundingBox();
  check(
    `${label}: viewer fills the viewport`,
    viewerBox !== null &&
      Math.abs(viewerBox.x) <= 1 &&
      Math.abs(viewerBox.y) <= 1 &&
      Math.abs(viewerBox.width - width) <= 1 &&
      Math.abs(viewerBox.height - height) <= 1,
    viewerBox ? `x=${viewerBox.x} y=${viewerBox.y} w=${viewerBox.width} h=${viewerBox.height} viewport=${width}x${height}` : "no viewer box",
  );
  bad = await horizontalOffenders(page, '[data-testid="viewer-image"]');
  check(`${label}: viewer image is inside the viewport`, bad.length === 0, bad.join("; "));
  bad = await horizontalOffenders(page, '[data-testid="viewer-counter"], [data-testid="viewer-close"]');
  check(`${label}: viewer counter and close button are inside the viewport`, bad.length === 0, bad.join("; "));
  const closeVisible = await page.locator('[data-testid="viewer-close"]').isVisible().catch(() => false);
  check(`${label}: viewer close button is visible`, closeVisible);
  // The viewer's own thumbnail row scrolls horizontally when it has
  // more thumbs than fit, so thumbs may extend past the viewport —
  // what matters is the row itself scrolls rather than overflowing.
  const viewerThumbRow = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="viewer-thumb-0"]')?.parentElement;
    if (!row) return null;
    const cs = getComputedStyle(row);
    const r = row.getBoundingClientRect();
    return { overflowX: cs.overflowX, left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth };
  });
  check(
    `${label}: viewer thumbnail row scrolls instead of overflowing`,
    viewerThumbRow !== null && (viewerThumbRow.overflowX === "auto" || viewerThumbRow.overflowX === "scroll") && viewerThumbRow.left >= -1 && viewerThumbRow.right <= viewerThumbRow.vw + 1,
    JSON.stringify(viewerThumbRow),
  );

  if (touch) {
    check(`${label}: viewer has no zoom buttons on mobile`, (await page.locator('[data-testid="viewer-zoom-in"]').count()) === 0);
    check(`${label}: viewer has no arrows on mobile`, (await page.locator('[data-testid="viewer-prev"]').count()) === 0);
    // Swipe in the viewer, then pinch to zoom.
    const stage = await page.locator('[data-testid="viewer-stage"]').boundingBox();
    if (stage) {
      const cy = stage.y + stage.height / 2;
      await cdpTouchSwipe(page, stage.x + stage.width * 0.8, cy, stage.x + stage.width * 0.2, cy);
      await sleep(600);
      const vc = (await page.textContent('[data-testid="viewer-counter"]')) ?? "";
      check(`${label}: swipe in the viewer changes the photo`, vc.includes("Photo 2 of 5"), vc);
      await cdpPinch(page, stage.x + stage.width / 2, cy, 60, 240);
      await sleep(500);
      const stageTransform = await page.evaluate(() => {
        // Inline style, not computed style: getComputedStyle returns
        // the matrix form ("matrix(4, 0, 0, 4, 0, 0)"), while the
        // inline style keeps the "scale(4)" the component sets.
        const el = document.querySelector('[data-testid="viewer-stage"] > div');
        return el ? el.style.transform : "";
      });
      check(`${label}: pinch out zooms the photo in`, /scale\((?!1(\.0+)?\))/.test(stageTransform), stageTransform);
    } else {
      check(`${label}: swipe in the viewer changes the photo`, false, "viewer stage has no bounding box");
      check(`${label}: pinch out zooms the photo in`, false, "viewer stage has no bounding box");
    }
    await page.click('[data-testid="viewer-close"]');
  } else {
    const zoomInVisible = await page.locator('[data-testid="viewer-zoom-in"]').isVisible().catch(() => false);
    const zoomOutVisible = await page.locator('[data-testid="viewer-zoom-out"]').isVisible().catch(() => false);
    check(`${label}: viewer has zoom in / out buttons`, zoomInVisible && zoomOutVisible);
    bad = await horizontalOffenders(page, '[data-testid="viewer-zoom-in"], [data-testid="viewer-zoom-out"], [data-testid="viewer-zoom-level"]');
    check(`${label}: viewer zoom controls are inside the viewport`, bad.length === 0, bad.join("; "));
    await page.click('[data-testid="viewer-zoom-in"]');
    await sleep(400);
    check(
      `${label}: zoom in works in the viewer`,
      ((await page.textContent('[data-testid="viewer-zoom-level"]')) ?? "").includes("150%"),
    );
    await page.keyboard.press("Escape");
  }
  await sleep(600);
  check(`${label}: viewer is closed afterwards`, (await page.locator('[data-testid="photo-viewer"]').count()) === 0);

  // --- D. Admin multi-photo form layout ---
  // The admin is tabbed (?tab=overview|products|orders|users) since
  // the roles build: the product form lives on the Products tab, so
  // open that tab directly — plain /admin shows the Overview tab and
  // the form is not rendered there at all.
  await signIn(page);
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle" });
  await sleep(1500);
  ov = await pageOverflow(page, width);
  check(`${label}: admin page has no horizontal overflow`, !ov.overflow, `scrollW=${ov.scrollW} innerW=${ov.innerW}`);
  bad = await horizontalOffenders(page, '[data-testid="product-photo-0"]');
  check(`${label}: main photo input is inside the viewport`, bad.length === 0, bad.join("; "));
  bad = await horizontalOffenders(
    page,
    '[aria-label="Move photo 1 up"], [aria-label="Move photo 1 down"], [aria-label="Remove photo 1"]',
  );
  check(`${label}: photo row move/remove buttons are inside the viewport`, bad.length === 0, bad.join("; "));
  bad = await horizontalOffenders(page, '[data-testid="photo-upload-input"], [data-testid="photo-upload-button"], [data-testid="add-photo-row"]');
  check(`${label}: upload controls and add-photo-row are inside the viewport`, bad.length === 0, bad.join("; "));
  const addVisible = await page.locator('[data-testid="add-photo-row"]').isVisible().catch(() => false);
  check(`${label}: add-photo-row button is visible`, addVisible);
  await page.click('[data-testid="add-photo-row"]');
  await sleep(400);
  ov = await pageOverflow(page, width);
  check(`${label}: admin page still has no horizontal overflow with 2 photo rows`, !ov.overflow, `scrollW=${ov.scrollW} innerW=${ov.innerW}`);
  bad = await horizontalOffenders(page, '[data-testid="product-photo-1"]');
  check(`${label}: second photo row is inside the viewport`, bad.length === 0, bad.join("; "));
  const submitBox = await page.locator('button[type="submit"]', { hasText: "Add product" }).boundingBox().catch(() => null);
  check(
    `${label}: Add product submit button is inside the viewport`,
    submitBox !== null && submitBox.x >= -1 && submitBox.x + submitBox.width <= width + 1,
    submitBox ? `x=${Math.round(submitBox.x)} right=${Math.round(submitBox.x + submitBox.width)} vw=${width}` : "no submit box",
  );

  check(`${label}: no page JS errors during the run`, pageErrors.length === 0, pageErrors.join(" | "));
  await ctx.close();
}

// --- E. Quick overflow sweep at 390 on / and /shop ---
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const mpage = await mctx.newPage();
for (const path of ["/", "/shop"]) {
  await mpage.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
  await sleep(1200);
  const ov = await pageOverflow(mpage, 390);
  check(`mobile 390: ${path} has no horizontal overflow`, !ov.overflow, `scrollW=${ov.scrollW} innerW=${ov.innerW}`);
}
await mctx.close();
await browser.close();

if (failures.length > 0) {
  console.log(`\n${failures.length} CHECK(S) FAILED:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
