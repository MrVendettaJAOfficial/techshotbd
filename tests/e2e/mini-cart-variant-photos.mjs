// TechShot combined Playwright check: mini-cart drawer + variant photos.
//
// One run covering both 2026-11-09 features, against the mock
// Supabase (no real keys):
//   A. Variant photos — on the iPhone product page, the default
//      colour (Natural Titanium, no photo) shows the product photo;
//      selecting Black Titanium (which has a photo in the mock)
//      switches the main gallery image to that variant's photo and
//      shows it as a thumbnail; selecting Natural Titanium again
//      falls back to the product photo.
//   B. Mini-cart drawer — add the iPhone to the cart, click the
//      header cart button: the drawer opens WITHOUT navigating (URL
//      and scroll position unchanged), shows the line with the right
//      quantity and subtotal, +/- updates the store (header count
//      follows), Escape / overlay / X close it and return focus to
//      the cart button, "View full cart" lands on /cart with the same
//      items, going back leaves the shop intact, "Checkout" lands on
//      /checkout, and remove empties the cart to the empty state.
//      The drawer is also checked at a mobile viewport (390px).
//
//   C. Skeletons — navigating to /shop, a product page and / shows
//      the matching per-route skeleton instantly (before the
//      data-driven content arrives), then the skeleton is replaced
//      by the real content. A loading.tsx skeleton only renders
//      while the page is waiting on data — against the mock, which
//      answers in milliseconds, the page usually resolves before
//      the shell flushes and no skeleton ever appears (verified by
//      probing: /product never showed one, /shop only sometimes).
//      So this section sets a 2s delay on the mock first (test-only
//      endpoint GET /__test/delay, cleared in a finally), which
//      simulates the real condition — Supabase round trips of
//      100–300ms from Bangladesh — under which the skeleton is what
//      the user actually sees.
//      Two subtleties found by probing (documented, not worked
//      around): (1) the /shop content marker must be a product title,
//      not "Shop all" — the shell itself contains visible "Shop all"
//      category-pill and breadcrumb links; (2) the product skeleton
//      is checked via CLIENT-SIDE navigation (clicking a product
//      card from /shop), not a cold load: on a cold load
//      generateMetadata blocks the shell on the same catalogue
//      fetch the page needs, so the shell — and the skeleton —
//      cannot flush until the data is ready. In-app navigation is
//      the common case and shows the skeleton for the whole fetch;
//      cold loads show the browser's blank-to-content instead. The
//      skeleton file stays: it is what the router shows while
//      fetching, and removing the product's <title> metadata to
//      chase a cold-load skeleton would trade real SEO for nothing.
//
// The mock's Black Titanium photo is a STAND-IN ONLY: it is the
// Sony headphones shot (sony-wh-1000xm5.jpg), chosen so nobody
// mistakes it for a real Black Titanium iPhone photo. No real
// per-colour photos exist yet. What is proven here is the switching
// mechanism (the displayed <img> URL changes to the variant's file
// and the image loads — the mock serves a solid 120x120 PNG for Storage
// files), not that any real colour photo exists.
//
// Run (see README, "End-to-end checks"):
//   Mock:      node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 node tests/e2e/mini-cart-variant-photos.mjs
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
const IPHONE = "/product/apple-iphone-16-pro-256gb-natural-titanium";
const IPHONE_TITLE = "Apple iPhone 16 Pro 256GB Natural Titanium";
const IPHONE_PHOTO = "apple-iphone-16-pro-256gb-natural-titanium.jpg";
// Stand-in variant photo (see header): the Sony headphones shot.
const STAND_IN_PHOTO = "sony-wh-1000xm5.jpg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(name);
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

async function cartBadge(page) {
  return page.evaluate(() => document.querySelector('[aria-label^="Cart"]')?.getAttribute("aria-label") ?? "");
}

async function dialogText(page) {
  return page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "");
}

async function dialogVisible(page) {
  return page.evaluate(() => !!document.querySelector('[role="dialog"]'));
}

/** Decoded src of the gallery's main image (alt = product title). */
async function mainGallerySrc(page) {
  return page.evaluate((title) => {
    const img = document.querySelector(`img[alt="${CSS.escape(title)}"]`);
    if (!img) return "";
    try {
      return decodeURIComponent(img.getAttribute("src") ?? "");
    } catch {
      return img.getAttribute("src") ?? "";
    }
  }, IPHONE_TITLE);
}

async function mainGalleryLoaded(page) {
  return page.evaluate((title) => {
    const img = document.querySelector(`img[alt="${CSS.escape(title)}"]`);
    return !!img && img.complete && img.naturalWidth > 0;
  }, IPHONE_TITLE);
}

async function openDrawer(page) {
  await page.getByRole("button", { name: /^Cart, \d+ items$/ }).click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await sleep(400);
}

/**
 * Scroll to y and wait until the position settles there: images
 * loading above the fold can still shift the layout (and the
 * browser's clamped scroll) for a moment after the scroll call.
 */
async function settleScroll(page, y) {
  await page.evaluate((target) => window.scrollTo(0, target), y);
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    const a = await page.evaluate(() => window.scrollY);
    await sleep(300);
    const b = await page.evaluate(() => window.scrollY);
    if (a === y && b === y) return a;
  }
  return page.evaluate(() => window.scrollY);
}

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // --- A. Variant photos on the iPhone product page ---
  await page.goto(`${BASE}${IPHONE}`, { waitUntil: "networkidle0" });
  await sleep(800);
  check(
    "product page shows both colour options",
    (await page.getByRole("button", { name: "Natural Titanium" }).count()) > 0 &&
      (await page.getByRole("button", { name: "Black Titanium" }).count()) > 0,
  );
  let src = await mainGallerySrc(page);
  check("default colour shows the product photo", src.includes(IPHONE_PHOTO), src.slice(0, 160));
  check("default colour photo loads", await mainGalleryLoaded(page));
  check(
    "default colour shows no thumbnails (single photo)",
    (await page.getByRole("button", { name: /^View image/ }).count()) === 0,
  );

  await page.getByRole("button", { name: "Black Titanium" }).click();
  await sleep(800);
  src = await mainGallerySrc(page);
  check(
    "Black Titanium switches the main photo to the variant image",
    src.includes(STAND_IN_PHOTO),
    src.slice(0, 160),
  );
  check("variant photo loads", await mainGalleryLoaded(page));
  check(
    "variant photo adds a second thumbnail (variant + product photo)",
    (await page.getByRole("button", { name: /^View image/ }).count()) === 2,
  );

  await page.getByRole("button", { name: "Natural Titanium" }).click();
  await sleep(800);
  src = await mainGallerySrc(page);
  check(
    "Natural Titanium falls back to the product photo",
    src.includes(IPHONE_PHOTO) && !src.includes(STAND_IN_PHOTO),
    src.slice(0, 160),
  );

  // --- B. Mini-cart drawer ---
  // Add from the product page (default colour), then browse the shop.
  await page.getByRole("button", { name: "Add to Cart" }).first().click();
  await sleep(1200);
  check("header badge shows 1 item after add", (await cartBadge(page)).includes("1 items"));
  await page.goto(`${BASE}/shop`, { waitUntil: "networkidle0" });
  await sleep(600);
  const shopUrl = page.url();
  const shopScroll = await settleScroll(page, 600);
  check("shop scrolls to 600 before the drawer opens", shopScroll === 600, `scrollY=${shopScroll}`);

  await openDrawer(page);
  check("drawer opens on cart-icon click", await dialogVisible(page));
  check("drawer opens without navigating", page.url() === shopUrl, page.url());
  check(
    "drawer opens without losing scroll position",
    (await page.evaluate(() => window.scrollY)) === shopScroll,
    `was ${shopScroll}, now ${await page.evaluate(() => window.scrollY)}`,
  );
  let drawer = await dialogText(page);
  check("drawer shows the iPhone line", drawer.includes("Apple iPhone 16 Pro"), drawer.slice(0, 200));
  check("drawer shows the selected variant", drawer.includes("Natural Titanium"), drawer.slice(0, 200));
  check("drawer shows quantity 1 and the ৳1,19,900 subtotal", drawer.includes("৳1,19,900"));
  check("drawer shows the free-delivery message", drawer.includes("You've got free delivery"));
  check(
    "focus moves into the drawer on open",
    await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "") === "Close cart",
  );

  // Quantity + inside the drawer updates the store (header count).
  await page.locator('[role="dialog"] button[aria-label="Increase quantity"]').click();
  await sleep(800);
  check("drawer quantity + updates the header count to 2", (await cartBadge(page)).includes("2 items"));
  drawer = await dialogText(page);
  check("drawer quantity + updates the line total to ৳2,39,800", drawer.includes("৳2,39,800"));
  await page.locator('[role="dialog"] button[aria-label="Decrease quantity"]').click();
  await sleep(800);
  check("drawer quantity - brings the header count back to 1", (await cartBadge(page)).includes("1 items"));

  // Escape closes and returns focus to the cart button.
  await page.keyboard.press("Escape");
  await sleep(500);
  check("Escape closes the drawer", !(await dialogVisible(page)));
  check(
    "focus returns to the cart button after Escape",
    (await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).startsWith("Cart"),
  );
  check("page is still the shop after Escape", page.url() === shopUrl);

  // Overlay click closes.
  await openDrawer(page);
  await page.mouse.click(60, 450);
  await sleep(500);
  check("clicking the overlay closes the drawer", !(await dialogVisible(page)));

  // X button closes.
  await openDrawer(page);
  await page.getByRole("button", { name: "Close cart" }).click();
  await sleep(500);
  check("X button closes the drawer", !(await dialogVisible(page)));

  // Mobile viewport: full-height, near-full-width panel.
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(400);
  await openDrawer(page);
  const box = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  check("mobile drawer is near-full-width", !!box && box.width > 330 && box.width <= 390, JSON.stringify(box));
  check("mobile drawer is full-height", !!box && Math.abs(box.height - 844) < 2, JSON.stringify(box));
  await page.keyboard.press("Escape");
  await sleep(400);
  await page.setViewportSize({ width: 1280, height: 900 });
  await sleep(400);

  // View full cart lands on /cart with the same items.
  await openDrawer(page);
  await page.locator('[role="dialog"]').getByRole("link", { name: "View full cart" }).click();
  await sleep(1000);
  check("View full cart navigates to /cart", page.url().includes("/cart"), page.url());
  check("drawer is closed on /cart", !(await dialogVisible(page)));
  const cartText = await page.evaluate(() => document.querySelector("main")?.innerText ?? "");
  check("/cart shows the same iPhone line", cartText.includes("Apple iPhone 16 Pro"));
  check("/cart shows the same ৳1,19,900 total", cartText.includes("৳1,19,900"));

  // Back: the shop page is intact.
  await page.goBack();
  await sleep(800);
  check("going back returns to the shop", page.url().includes("/shop"), page.url());
  check("header count is still 1 after going back", (await cartBadge(page)).includes("1 items"));
  check(
    "shop scroll position is intact after going back",
    (await page.evaluate(() => window.scrollY)) > 0,
    `scrollY=${await page.evaluate(() => window.scrollY)}`,
  );

  // Checkout lands on /checkout.
  await openDrawer(page);
  await page.locator('[role="dialog"]').getByRole("link", { name: "Checkout" }).click();
  await sleep(1000);
  check("Checkout navigates to /checkout", page.url().includes("/checkout"), page.url());
  await page.goBack();
  await sleep(800);

  // Remove empties the cart to the empty state.
  await openDrawer(page);
  await page.locator('[role="dialog"] button[aria-label^="Remove"]').click();
  await sleep(800);
  drawer = await dialogText(page);
  check("remove empties the drawer", drawer.includes("Your cart is empty"), drawer.slice(0, 200));
  check("header count is 0 after remove", (await cartBadge(page)).includes("0 items"));
  await page.getByRole("button", { name: "Continue shopping" }).click();
  await sleep(500);
  check("Continue shopping closes the empty drawer", !(await dialogVisible(page)));
  check("page is still the shop after Continue shopping", page.url().includes("/shop"));

  // Empty cart: opening the drawer shows the empty state directly.
  await openDrawer(page);
  drawer = await dialogText(page);
  check("empty cart opens straight to the empty state", drawer.includes("Your cart is empty"));
  await page.keyboard.press("Escape");
  await sleep(400);

  // --- C. Skeletons appear instantly on navigation ---
  // Slow the mock's data responses for this section only (see the
  // header): the skeleton renders while the page waits on data.
  // The delay is cleared in the finally below, so the mock is left
  // exactly as it was found.
  const MOCK = (process.env.MOCK_URL ?? "http://127.0.0.1:3101").replace(/\/$/, "");
  async function setMockDelay(ms) {
    try {
      await fetch(`${MOCK}/__test/delay?ms=${ms}`);
    } catch {
      // The mock predates the delay endpoint — the skeleton checks
      // below will fail loudly instead of passing vacuously.
    }
  }
  try {
    await setMockDelay(2000);

    /**
     * Prove the matching skeleton is on screen BEFORE the content:
     * poll every 5ms from the moment navigation starts and record
     * which arrives first — the skeleton or the content text.
     * `navigate` defaults to a cold document load; the product page
     * passes a client-side navigation instead (see the header).
     */
    async function skeletonCheck(path, layoutMarker, contentText, navigate) {
      if (navigate) await navigate();
      else await page.goto(`${BASE}${path}`, { waitUntil: "commit" });
      let order = "timeout";
      try {
        const handle = await page.waitForFunction(
          (marker) => {
            const skel = !!document.querySelector('[aria-label="Loading"]');
            const content = (document.body?.innerText ?? "").includes(marker);
            if (skel && !content) return "skeleton-first";
            if (content) return "content-first";
            return false;
          },
          contentText,
          { timeout: 15000, polling: 5 },
        );
        order = await handle.jsonValue();
      } catch {
        order = "timeout";
      }
      check(`${path}: skeleton appears before the real content`, order === "skeleton-first", `order=${order}`);
      const skeletonHtml = await page.evaluate(
        () => document.querySelector('[aria-label="Loading"]')?.innerHTML ?? "",
      );
      check(
        `${path}: skeleton matches the page layout (${layoutMarker})`,
        skeletonHtml.includes(layoutMarker),
      );
      check(
        `${path}: skeleton has pulsing placeholder blocks`,
        (await page.locator('[aria-label="Loading"] .animate-pulse').count()) > 4,
      );
      await page.locator('[aria-label="Loading"]').first().waitFor({ state: "detached", timeout: 30000 });
      check(
        `${path}: skeleton is replaced by the real content`,
        (await page.evaluate(() => document.body.innerText)).includes(contentText),
      );
    }

    // The /shop marker is a product title, not "Shop all": the shell
    // itself contains visible "Shop all" pill / breadcrumb links.
    await skeletonCheck("/shop", "lg:grid-cols-[260px_1fr]", IPHONE_TITLE);
    // Product page via client-side navigation from the shop (the
    // page is already showing the iPhone card on page one). The
    // marker is "Add to Cart", which exists only on the product page.
    await skeletonCheck(IPHONE, "aspect-square", "Add to Cart", async () => {
      await page.getByRole("link", { name: /Apple iPhone 16 Pro/ }).first().click();
    });
    await skeletonCheck("/", "lg:grid-cols-2", "Trending now");
  } finally {
    await setMockDelay(0);
  }

  check("no page JS errors during the whole run", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 500));
  await browser.close();

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED: ${failures.join(", ")}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("MINI-CART SCRIPT FAILED:", e);
  process.exit(1);
});
