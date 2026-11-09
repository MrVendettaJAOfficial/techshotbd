// TechShot Storage product-photo checks (Playwright, mock Supabase).
//
// Proves the storefront resolves product photos to Supabase Storage
// URLs when configured, and that next/image accepts them:
//   1. the server-rendered /shop HTML contains a Storage URL for a
//      product photo (the mock returns no product_images rows, so the
//      slug fallback /images/products/<slug>.jpg is what gets mapped);
//   2. loading /shop in a real browser shows no remotePatterns /
//      invalid-src / CSP image error — the configured origin is
//      allowed by next.config remotePatterns and the CSP img-src;
//   3. the browser actually requested a Storage photo URL (via
//      next/image) and no local product-photo path — captured from the
//      request log, because the mock 404s the photo and ProductImage
//      swaps each <img> for its solid-colour fallback almost at once.
//
// The mock serves no /storage/v1/... objects, so a successful photo
// LOAD cannot be proven here; the live load is verified after deploy
// (or with keys for a live check). What is proven here is the URL
// mapping and that next/image accepts the remote host.
//
// Run (see README, "End-to-end checks"):
//   Mock:      MOCK_ADMIN=0 node tests/e2e/mock-supabase.mjs  (port 3101)
//   App:       NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3101 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key \
//                SUPABASE_SERVICE_ROLE_KEY=mock-service-key TEST_PAYMENT_SIGNING_SECRET=<redacted> PORT=3100 npm run start
//   Then:      BASE_URL=http://127.0.0.1:3100 MOCK_URL=http://127.0.0.1:3101 node tests/e2e/storage-images.mjs
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
const STORAGE_MARKER = "storage/v1/object/public/product-images/";

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

const browser = await launchBrowser();
const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
const requestedUrls = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(String(err)));
// The mock serves no Storage objects, so the photo requests 404 and
// ProductImage swaps each <img> for its solid-colour fallback almost
// immediately — live <img> elements are usually gone by the time the
// page settles. The requested URLs are the reliable record of what
// the storefront asked for, so they are captured here instead.
page.on("request", (req) => requestedUrls.push(req.url()));

try {
  // 1. Server-rendered HTML carries a Storage photo URL.
  const html = await (await fetch(`${BASE}/shop`)).text();
  const storageInHtml = html.includes(encodeURIComponent(STORAGE_MARKER)) || html.includes(STORAGE_MARKER);
  check("SSR /shop HTML contains a Storage photo URL", storageInHtml);

  // 2. Load /shop in the browser; no remote-pattern / CSP image error.
  await page.goto(`${BASE}/shop`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  const badErrors = [...consoleErrors, ...pageErrors].filter((text) =>
    /remotePatterns|Invalid src|Content Security Policy.*img-src|Refused to load the image/i.test(text),
  );
  check("no remotePatterns / invalid-src / CSP img error on /shop", badErrors.length === 0, badErrors.join(" | "));

  // 3. The browser actually requested Storage photo URLs (via
  // next/image), and no local product-photo path.
  const decodedRequests = requestedUrls.map((url) => {
    try {
      return decodeURIComponent(url);
    } catch {
      return url;
    }
  });
  const storageRequests = decodedRequests.filter((url) => url.includes(STORAGE_MARKER));
  check(
    "browser requested a Storage photo URL",
    storageRequests.length > 0,
    `${storageRequests.length} requests; e.g. ${storageRequests[0] ?? "none"}`,
  );
  const localRequests = decodedRequests.filter((url) =>
    url.includes("/images/products/"),
  );
  check("browser requested no local product photo", localRequests.length === 0, localRequests.join(" | "));
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\nFAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
