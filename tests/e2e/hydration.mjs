// TechShot hydration e2e check (Playwright).
//
// Regression check for the 2026-11-08 home-page hydration errors
// (minified React #425 / #422): FlashCountdown rendered Date.now()
// during its first render, so the server HTML and the hydrated HTML
// differed by a second. The fix renders a static placeholder until
// mount (see components/FlashCountdown.tsx).
//
// What it proves against a running production build:
//   1. the home page loads with ZERO React hydration errors
//      (#425 / #422) across several fresh loads and a reload;
//   2. the flash countdown still renders and ticks (its displayed
//      seconds change between two reads a few seconds apart);
//   3. /shop and /auth/sign-in stay clean (they were clean before).
//
// Run: build + serve the app with no env vars, then
//   BASE_URL=http://127.0.0.1:3100 node tests/e2e/hydration.mjs
//
// Needs a Chromium: `npx playwright install chromium` once, and
// playwright-core resolvable (install it in a scratch directory and
// run from there, or `npm i -D playwright-core` in this repo — it is
// NOT a repo dependency). Exits non-zero when any check fails.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  try {
    ({ chromium } = require("playwright"));
  } catch {
    console.error(
      "Playwright is not installed. Install it once:\n" +
        "  npm i -D playwright-core && npx playwright install chromium",
    );
    process.exit(2);
  }
}

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(name);
}

function isHydrationError(text) {
  return /React error #(425|422)/.test(text) || /hydration/i.test(text);
}

async function launchBrowser() {
  const opts = { args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  try {
    return await chromium.launch(opts);
  } catch {
    // The installed Playwright expects a Chromium build that is not
    // downloaded; fall back to the downloaded chromium-1148 binary.
    const exe = process.env.CHROMIUM_PATH ?? "/home/hatch/.cache/ms-playwright/chromium-1148/chrome-linux/chrome";
    return await chromium.launch({ ...opts, executablePath: exe });
  }
}

async function loadAndCollect(browser, path, { reload = false } = {}) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await sleep(1500);
  if (reload) {
    await page.reload({ waitUntil: "networkidle" });
    await sleep(1500);
  }
  const timerText = await page.evaluate(() => {
    const el = document.querySelector('[role="timer"]');
    return el ? el.innerText.replace(/\s+/g, " ").trim() : null;
  });
  await page.close();
  return { consoleErrors, pageErrors, timerText };
}

function assertClean(label, collected) {
  const hydration = [...collected.consoleErrors, ...collected.pageErrors].filter(isHydrationError);
  check(`${label}: no React hydration errors (#425/#422)`, hydration.length === 0, hydration.join(" | ").slice(0, 300));
  check(
    `${label}: no console errors at all`,
    collected.consoleErrors.length === 0,
    collected.consoleErrors.join(" | ").slice(0, 300),
  );
  check(
    `${label}: no page errors at all`,
    collected.pageErrors.length === 0,
    collected.pageErrors.join(" | ").slice(0, 300),
  );
}

async function main() {
  const browser = await launchBrowser();

  // --- 1. home page: several fresh loads + a reload, all clean ---
  for (let i = 1; i <= 3; i++) {
    assertClean(`home load #${i}`, await loadAndCollect(browser, "/"));
  }
  assertClean("home reload", await loadAndCollect(browser, "/", { reload: true }));

  // --- 2. countdown still renders and ticks ---
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await sleep(500);
  const readTimer = () =>
    page.evaluate(() => {
      const el = document.querySelector('[role="timer"]');
      return el ? el.innerText.replace(/\s+/g, " ").trim() : null;
    });
  const first = await readTimer();
  check("flash countdown renders on the home page", !!first && /HOURS/.test(first), first ?? "missing");
  await sleep(3000);
  const second = await readTimer();
  check("flash countdown ticks (displayed time changes)", !!first && !!second && first !== second, `${first} -> ${second}`);
  await page.close();

  // --- 3. /shop and /auth/sign-in stay clean ---
  assertClean("/shop", await loadAndCollect(browser, "/shop"));
  assertClean("/auth/sign-in", await loadAndCollect(browser, "/auth/sign-in"));

  await browser.close();
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED: ${failures.join(", ")}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HYDRATION SCRIPT FAILED:", e);
  process.exit(1);
});
