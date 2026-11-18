// TechShot lows batch (Group C) end-to-end checks — Playwright,
// mock Supabase.
//
// Covers audit run-1 LOW 8, 9, 10, 12, 13 and NV 14 through the
// real browser + real app + loopback mock Supabase:
//
//   8. Product delete removes Storage files: create a product in
//      the admin form with two uploaded photos, the second also
//      named as a variant photo (fourth part of the variant
//      entry), delete the product, and prove both files leave the
//      mock bucket listing (the mock records uploads and answers
//      the Storage list endpoint from that record — see
//      tests/e2e/mock-supabase.mjs).
//   9. EXIF stripped from a small photo: a small EXIF-bearing
//      JPEG uploads through the admin form without error and lands
//      in Storage. HONEST SCOPE: the mock consumes and discards
//      upload bytes, so the stored bytes cannot be inspected here
//      — the proof that the re-encode actually drops EXIF is the
//      unit suite (tests/exif-strip.test.mjs, real sharp output).
//      This probe proves only that the small-EXIF upload path
//      still works end to end after the fix.
//   10. Variant stock restored on cancel: add the iPhone in both
//      its variants (Natural Titanium + Black Titanium) to the
//      cart, check out COD, cancel the order, and prove both
//      variant rows return to stock 12 in the mock DB.
//   12. Flash deal gone after expiry: the seeded iPhone is a live
//      flash deal (flash_ends_at = seed + 7 days); PATCH its
//      flash_ends_at to yesterday through the mock REST API, wait
//      out the 60s catalogue revalidate, and prove the home-page
//      Flash deals grid no longer lists it — then restore the
//      date, wait again, and prove it returns. (The section shell
//      always renders; the probe reads the grid content.)
//   13. Second delivered order reviewable: seed two delivered
//      orders for the signed-in user containing the iPhone plus a
//      review already filed against the first, then submit a
//      second review through the product page and prove it saves
//      (thank-you notice) and lands in the mock reviews table
//      against the SECOND order.
//   NV 14. Orphan upload quota: seed 50 product.upload audit rows
//      for the caller, prove the next admin photo upload is
//      rejected with the daily-limit message and stores nothing,
//      then remove the seeded rows and prove the same upload
//      succeeds. (The total cap and the orphan sweep are pinned
//      by tests/orphan-upload-quota.test.mjs.)
//
// The mock is left as it was found: the test product is deleted,
// the seeded orders / reviews / audit rows are removed, the
// iPhone's flash_ends_at is restored, and the uploaded test files
// are removed from the mock bucket listing.
//
// Run (ports 3131 mock / 3130 app — this suite's own ports, so it
// never collides with the coordinator's 3100/3101 baseline):
//   Mock:      MOCK_ADMIN=1 MOCK_SUPABASE_PORT=3131 node tests/e2e/mock-supabase.mjs > /tmp/mock-lows-c.log  (port 3131)
//   Build:     NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3131 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> npm run build
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3131 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> PORT=3130 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3130 MOCK_URL=http://127.0.0.1:3131 \
//                node tests/e2e/lows-products-catalog.mjs
//
// Needs a Chromium: playwright-core resolvable (it is NOT a repo
// dependency) and the chromium-1148 fallback below. Exits non-zero
// when any check fails. No real money moves.

import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync } from "node:fs";
import sharp from "sharp";

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

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3130").replace(/\/$/, "");
const MOCK = (process.env.MOCK_URL ?? "http://127.0.0.1:3131").replace(/\/$/, "");
const TEST_PHOTO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "images", "products", "apple-iphone-16-pro.jpg");
const IPHONE_SLUG = "apple-iphone-16-pro-256gb-natural-titanium";
const IPHONE_ID = "prod-apple-iphone-16-pro-256gb-natural-titanium";
const IPHONE_TITLE = "Apple iPhone 16 Pro 256GB Natural Titanium";
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

async function waitFor(fn, timeoutMs = 20000, stepMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return true;
    await sleep(stepMs);
  }
  return false;
}

// --- mock REST helpers (the mock has no auth on REST) ---
async function mockGet(path) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, { headers: { apikey: "mock-anon-key" } });
  return res.json();
}

async function mockPost(table, row) {
  const res = await fetch(`${MOCK}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: "mock-anon-key", "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  return res.json();
}

async function mockPatch(path, row) {
  const res = await fetch(`${MOCK}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { apikey: "mock-anon-key", "Content-Type": "application/json" },
    body: JSON.stringify(row),
  });
  return res.json();
}

async function mockDelete(path) {
  await fetch(`${MOCK}/rest/v1/${path}`, { method: "DELETE", headers: { apikey: "mock-anon-key" } });
}

/** Filenames currently in the mock product-images bucket. */
async function storedFiles(search = "") {
  const res = await fetch(`${MOCK}/storage/v1/object/list/product-images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ search, limit: 1000 }),
  });
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).map((row) => row.name);
}

// --- browser helpers (same selectors as tests/e2e/smoke.mjs) ---
async function signIn(page) {
  await page.goto(`${BASE}/auth/sign-in`, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
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

async function setInput(page, id, value) {
  await page.evaluate(
    ({ id, value }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const proto =
        el.tagName === "SELECT"
          ? window.HTMLSelectElement.prototype
          : el.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    },
    { id, value },
  );
  await sleep(150);
}

async function pageText(page, selector = "main") {
  return (await page.evaluate((sel) => document.querySelector(sel)?.innerText ?? "", selector)).replace(/\s+/g, " ");
}

async function fillAddress(page) {
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const setSel = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("firstName", "Test");
    set("lastName", "User");
    set("email", "test@example.com");
    set("mobile", "01712345678");
    set("address", "House 1, Road 2");
    set("area", "Dhanmondi");
    setSel("division", "Dhaka");
    set("city", "Dhaka");
  });
  await sleep(300);
  await page.evaluate(() => {
    const sel = document.getElementById("district");
    if (sel) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      setter.call(sel, "Dhaka");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Continue to delivery"));
    b && b.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Continue to payment"));
    b && b.click();
  });
  await sleep(400);
}

async function variantStock(name) {
  const rows = await mockGet(
    `product_variants?product_id=eq.${IPHONE_ID}&name=eq.${encodeURIComponent(name)}&select=stock`,
  );
  return rows?.[0]?.stock;
}

// A small EXIF-bearing JPEG for probe 9, written next to this
// script and deleted at the end. 800x600 (both sides under 1200)
// with Software + GPS EXIF — the exact shape LOW 9 used to store
// byte for byte.
const EXIF_JPEG = join(dirname(fileURLToPath(import.meta.url)), "lows-exif-probe.jpg");
async function writeExifFixture() {
  const buffer = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 20, g: 120, b: 90 } },
  })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Software: "lows-e2e-probe-camera" },
        GPS: { GPSLatitudeRef: "N", GPSLatitude: "22/1 34/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "91/1 49/1 0/1" },
      },
    })
    .toBuffer();
  writeFileSync(EXIF_JPEG, buffer);
  const meta = await sharp(EXIF_JPEG).metadata();
  if (!meta.exif?.length) throw new Error("EXIF fixture was written without EXIF");
}

const browser = await launchBrowser();
const page = await browser.newPage();
const created = { productId: null, uploadedFiles: [], orders: [], reviewId: null };
try {
  await signIn(page);

  // -----------------------------------------------------------------
  // LOW 8 + LOW 9 + NV 14 (upload leg): create a product with two
  // uploaded photos, the second also named as a variant photo.
  // -----------------------------------------------------------------
  await writeExifFixture();
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
  check("admin products tab loads", (await pageText(page)).includes("Product moderation"));

  await setInput(page, "product-title", "Lows Test Phone");
  await setInput(page, "product-price", "1499");
  await setInput(page, "product-stock", "10");
  // Category: tick Smartphones (the first ticked category is the
  // product's primary one).
  await page.locator('[data-testid="category-checkbox-smartphones"]').click();
  await sleep(300);

  // Upload the plain photo first, then the small EXIF photo (LOW 9:
  // the small-EXIF upload must still succeed after the fix).
  const uploadInput = page.locator('[data-testid="photo-upload-input"]');
  const photoPathsInForm = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="product-photo-"]')]
        .map((el) => el.value)
        .filter((v) => v.includes("lows-test-phone-")),
    );
  await uploadInput.setInputFiles([TEST_PHOTO]);
  await page.locator('[data-testid="photo-upload-button"]').click();
  const firstUploadOk = await waitFor(async () => (await photoPathsInForm()).length >= 1);
  check("LOW 9: first photo uploads", firstUploadOk);
  await uploadInput.setInputFiles([EXIF_JPEG]);
  await page.locator('[data-testid="photo-upload-button"]').click();
  const bothUploaded = await waitFor(async () => (await photoPathsInForm()).length >= 2);
  check("LOW 8/9: two photos uploaded and listed in the form", bothUploaded);
  const photoPaths = await photoPathsInForm();
  created.uploadedFiles = [...photoPaths];
  const variantPhoto = photoPaths[1];
  check("LOW 9: small EXIF photo was accepted (listed in Storage)", (await storedFiles(variantPhoto)).includes(variantPhoto));

  // The variant names its photo as the fourth part (see the
  // variants hint in the form): the variant row's image_path is
  // the second uploaded file.
  await setInput(page, "product-variants", `Test Colour::5:${variantPhoto}`);
  await setInput(page, "product-description", "Lows batch test product.");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => /Add product|Save product/.test(x.textContent));
    b && b.click();
  });
  const saved = await waitFor(async () => (await pageText(page)).includes("was added"), 20000);
  check("LOW 8: test product saves", saved);
  const products = await mockGet("products?slug=eq.lows-test-phone&select=id");
  created.productId = products?.[0]?.id ?? null;
  check("LOW 8: test product exists in the mock DB", !!created.productId, String(created.productId));
  const imageRows = created.productId
    ? await mockGet(`product_images?product_id=eq.${created.productId}&select=storage_path`)
    : [];
  const variantRows = created.productId
    ? await mockGet(`product_variants?product_id=eq.${created.productId}&select=image_path`)
    : [];
  check("LOW 8: two product_images rows saved", imageRows.length === 2, JSON.stringify(imageRows));
  check("LOW 8: variant row carries the second photo", variantRows.some((r) => r.image_path === variantPhoto), JSON.stringify(variantRows));
  const storedBefore = await storedFiles("lows-test-phone-");
  check(
    "LOW 8: both files are in the bucket before delete",
    photoPaths.every((name) => storedBefore.includes(name)),
    storedBefore.join(", "),
  );

  // Delete the product (two-step Delete in its own card) and prove
  // both files leave the bucket.
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
  await waitFor(async () => (await pageText(page)).includes("Lows Test Phone"), 20000);
  const deleteClicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) =>
        b.textContent.trim() === "Delete" &&
        b.closest("div")?.parentElement?.textContent?.includes("Lows Test Phone"),
    );
    // Fallback: the Delete button inside the card that names the
    // product (walk up until an ancestor holds the title).
    const scoped =
      btn ??
      [...document.querySelectorAll("button")]
        .filter((b) => b.textContent.trim() === "Delete")
        .find((b) => {
          let el = b.parentElement;
          while (el) {
            if (el.textContent?.includes("Lows Test Phone") && el.textContent.includes("Delete")) return true;
            el = el.parentElement;
          }
          return false;
        });
    if (!scoped) return false;
    scoped.click();
    return true;
  });
  check("LOW 8: Delete offered for the test product", deleteClicked);
  await sleep(800);
  const confirmClicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Confirm delete");
    if (!b) return false;
    b.click();
    return true;
  });
  check("LOW 8: delete confirmed", confirmClicked);
  const gone = await waitFor(async () => {
    const rows = await mockGet("products?slug=eq.lows-test-phone&select=id");
    return rows.length === 0;
  }, 20000);
  check("LOW 8: product row is gone after delete", gone);
  const storedAfter = await storedFiles("lows-test-phone-");
  check(
    "LOW 8: product + variant photos leave the bucket on delete",
    photoPaths.every((name) => !storedAfter.includes(name)),
    storedAfter.join(", ") || "(bucket listing empty for this prefix)",
  );
  created.productId = null;
  created.uploadedFiles = [];

  // -----------------------------------------------------------------
  // NV 14: seed 50 product.upload audit rows, the next upload is
  // rejected; remove them, the same upload succeeds.
  // -----------------------------------------------------------------
  const now = Date.now();
  for (let i = 0; i < 50; i += 1) {
    await mockPost("audit_log", {
      actor_id: "user-1",
      action: "product.upload",
      entity_type: "product",
      entity_id: null,
      created_at: new Date(now - (i + 1) * 60 * 1000).toISOString(),
    });
  }
  await page.goto(`${BASE}/admin?tab=products`, { waitUntil: "networkidle0" });
  await setInput(page, "product-title", "Lows Quota Phone");
  await uploadInput.setInputFiles([TEST_PHOTO]);
  await page.locator('[data-testid="photo-upload-button"]').click();
  const capped = await waitFor(async () => (await pageText(page)).includes("today's product photo upload limit (50 photos)"), 20000);
  check("NV 14: 51st upload in 24h is rejected with the daily-limit message", capped);
  const storedDuringCap = await storedFiles("lows-quota-phone-");
  check("NV 14: rejected upload stores nothing", storedDuringCap.length === 0, storedDuringCap.join(", "));
  await mockDelete("audit_log?actor_id=eq.user-1&action=eq.product.upload");
  await page.locator('[data-testid="photo-upload-button"]').click();
  const quotaOk = await waitFor(async () => (await storedFiles("lows-quota-phone-")).length >= 1, 20000);
  check("NV 14: upload succeeds once the seeded audit rows are gone", quotaOk);
  const quotaFiles = await storedFiles("lows-quota-phone-");
  created.uploadedFiles = [...quotaFiles];
  // Clean the quota probe's file + its audit row right away.
  if (quotaFiles.length > 0) {
    await fetch(`${MOCK}/storage/v1/object/product-images`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: quotaFiles }),
    });
  }
  await mockDelete("audit_log?actor_id=eq.user-1&action=eq.product.upload");
  created.uploadedFiles = [];

  // -----------------------------------------------------------------
  // LOW 10: two-variant order, then cancel — both variant stocks
  // return to 12.
  // -----------------------------------------------------------------
  check("LOW 10: variant stocks start at 12/12", (await variantStock("Natural Titanium")) === 12 && (await variantStock("Black Titanium")) === 12);
  await page.goto(`${BASE}/product/${IPHONE_SLUG}`, { waitUntil: "networkidle0" });
  // Pick Natural Titanium, add to cart; then Black Titanium, add.
  for (const colour of ["Natural Titanium", "Black Titanium"]) {
    const picked = (await page.getByRole("button", { name: colour }).count()) > 0;
    check(`LOW 10: colour option ${colour} offered`, picked);
    if (picked) await page.getByRole("button", { name: colour }).click();
    await sleep(500);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith("Add to Cart"));
      b && b.click();
    });
    await sleep(1200);
  }
  await page.goto(`${BASE}/cart`, { waitUntil: "networkidle0" });
  const cartText = await pageText(page);
  check("LOW 10: cart holds both variants", cartText.includes("Natural Titanium") && cartText.includes("Black Titanium"), cartText.slice(0, 200));
  await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
  await sleep(500);
  await fillAddress(page);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll("button[role=tab]")].find((x) => x.textContent.trim() === "Cash on Delivery");
    tab && tab.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Pay"));
    b && b.click();
  });
  await sleep(3000);
  check("LOW 10: COD order lands on its order page", /\/orders\/.+/.test(page.url()), page.url());
  const orderId = page.url().split("/orders/")[1]?.split("?")[0] ?? null;
  check("LOW 10: order exists in the mock DB", !!orderId, String(orderId));
  if (orderId) {
    created.orders.push(orderId);
    const items = await mockGet(`order_items?order_id=eq.${orderId}&select=variant_id`);
    const variantIds = items.map((i) => i.variant_id).sort();
    check(
      "LOW 10: order_items rows carry both variant ids at insert",
      variantIds.includes("var-iphone-natural-titanium") && variantIds.includes("var-iphone-black-titanium"),
      JSON.stringify(items),
    );
    check(
      "LOW 10: both variant stocks decremented to 11",
      (await variantStock("Natural Titanium")) === 11 && (await variantStock("Black Titanium")) === 11,
    );
    // Cancel from the order page (customer cancel, one click) and
    // prove the restore returns BOTH variants to 12.
    await page.goto(`${BASE}/orders/${orderId}`, { waitUntil: "networkidle0" });
    await sleep(1000);
    const cancelOffered = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Cancel order");
      if (!b) return false;
      b.click();
      return true;
    });
    check("LOW 10: order page offers Cancel order", cancelOffered);
    await sleep(3000);
    const cancelled = await waitFor(async () => {
      const rows = await mockGet(`orders?id=eq.${orderId}&select=status`);
      return rows?.[0]?.status === "cancelled";
    }, 20000);
    check("LOW 10: order cancelled", cancelled);
    check(
      "LOW 10: cancel shows the stock-released notice",
      (await pageText(page)).includes("Stock for these items has been released back to inventory."),
    );
    check(
      "LOW 10: both variant stocks restored to 12 after cancel",
      (await variantStock("Natural Titanium")) === 12 && (await variantStock("Black Titanium")) === 12,
      `natural=${await variantStock("Natural Titanium")} black=${await variantStock("Black Titanium")}`,
    );
  }

  // -----------------------------------------------------------------
  // LOW 12: flash deal gone after expiry, back after restore.
  // -----------------------------------------------------------------
  // The Flash deals section shell always renders; the probe reads
  // the grid inside it (the iPhone also appears in other home-page
  // sections, so a whole-page text search would prove nothing).
  const homeHasFlash = async () => {
    await page.goto(BASE, { waitUntil: "networkidle0" });
    return page.evaluate(() => {
      const heading = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "Flash deals");
      const section = heading?.closest("section");
      return section ? section.innerText.includes("Apple iPhone 16 Pro 256GB Natural Titanium") : false;
    });
  };
  check("LOW 12: iPhone is a flash deal before expiry", await homeHasFlash());
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await mockPatch(`products?id=eq.${IPHONE_ID}`, { flash_ends_at: past });
  // The catalogue data cache revalidates at most 60s after it was
  // filled, so a single reload at a fixed 65s is borderline: when
  // the "before" visit itself filled the entry, the first reload
  // after the 60s mark can still serve the stale entry (observed
  // once in a live run — the section flipped within 10s on the next
  // poll). Poll until the section flips, up to 150s, which covers a
  // full revalidate cycle however old the entry was at PATCH time.
  const flashGone = await waitFor(async () => !(await homeHasFlash()), 150000, 10000);
  check("LOW 12: flash deal gone after expiry", flashGone);
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await mockPatch(`products?id=eq.${IPHONE_ID}`, { flash_ends_at: future });
  const flashBack = await waitFor(async () => await homeHasFlash(), 150000, 10000);
  check("LOW 12: flash deal returns once the date is restored", flashBack);

  // -----------------------------------------------------------------
  // LOW 13: second delivered order reviewable.
  // -----------------------------------------------------------------
  const seededOrders = [
    { id: "ord-lows-a", order_number: "TS-LOWSA", user_id: "user-1", status: "delivered", subtotal_poisha: 11990000, delivery_poisha: 0, discount_poisha: 0, total_poisha: 11990000, payment_method: "cod", address_snapshot: {} },
    { id: "ord-lows-b", order_number: "TS-LOWSB", user_id: "user-1", status: "delivered", subtotal_poisha: 11990000, delivery_poisha: 0, discount_poisha: 0, total_poisha: 11990000, payment_method: "cod", address_snapshot: {} },
  ];
  for (const order of seededOrders) {
    await mockPost("orders", order);
    created.orders.push(order.id);
    await mockPost("order_items", {
      order_id: order.id,
      product_id: IPHONE_ID,
      title: IPHONE_TITLE,
      price_poisha: 11990000,
      quantity: 1,
    });
  }
  const firstReview = await mockPost("reviews", {
    user_id: "user-1",
    product_id: IPHONE_ID,
    order_id: "ord-lows-a",
    rating: 5,
    text: "First lows review.",
  });
  created.reviewId = firstReview?.id ?? null;
  await page.goto(`${BASE}/product/${IPHONE_SLUG}`, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith("Reviews"));
    tab && tab.click();
  });
  await sleep(800);
  await setInput(page, "review-comment", "Second lows review, via the second order.");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button[type=submit]")].find((x) => x.textContent.includes("Submit review"));
    b && b.click();
  });
  const reviewed = await waitFor(async () => (await pageText(page)).includes("Thank you — your review was saved."), 20000);
  check("LOW 13: second review submits (first order already reviewed)", reviewed);
  const userReviews = await mockGet(`reviews?user_id=eq.user-1&product_id=eq.${IPHONE_ID}&select=order_id,text`);
  const second = userReviews.find((r) => r.order_id === "ord-lows-b");
  check("LOW 13: second review stored against the second order", !!second, JSON.stringify(userReviews));
} catch (error) {
  console.error("suite error:", error instanceof Error ? error.message : error);
  failures.push("suite threw");
} finally {
  // Leave the mock as it was found.
  try {
    if (created.productId) await mockDelete(`products?id=eq.${created.productId}`);
    for (const orderId of created.orders) {
      await mockDelete(`order_items?order_id=eq.${orderId}`);
      await mockDelete(`orders?id=eq.${orderId}`);
    }
    await mockDelete("reviews?user_id=eq.user-1&product_id=eq." + IPHONE_ID + "&order_id=eq.ord-lows-a");
    await mockDelete("reviews?user_id=eq.user-1&product_id=eq." + IPHONE_ID + "&order_id=eq.ord-lows-b");
    await mockDelete("audit_log?actor_id=eq.user-1&action=eq.product.upload");
    const leftovers = await storedFiles("lows-");
    if (leftovers.length > 0) {
      await fetch(`${MOCK}/storage/v1/object/product-images`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: leftovers }),
      });
    }
    await mockPatch(`products?id=eq.${IPHONE_ID}`, {
      flash_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    try {
      unlinkSync(EXIF_JPEG);
    } catch {}
  } catch (cleanupError) {
    console.log("cleanup note:", cleanupError instanceof Error ? cleanupError.message : cleanupError);
  }
  await browser.close();
}

console.log(`\n${failures.length === 0 ? "ALL LOWS E2E CHECKS PASSED" : `FAILURES: ${failures.join(", ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
