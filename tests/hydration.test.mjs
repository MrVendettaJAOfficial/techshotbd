// Hydration regression tests — TechShot.
//
// 2026-11-08: the home page threw minified React errors #425 / #422
// (hydration mismatch) in the browser console on most loads, while
// /auth/sign-in and /shop stayed clean. Root cause: FlashCountdown
// rendered remainingParts(Date.now()) during its first render, so the
// server rendered one second value and the client hydrated a second
// later with a different one. The fix renders a static placeholder
// until the component has mounted (see components/FlashCountdown.tsx)
// and only then starts the live countdown in an effect.
//
// These tests pin the fix at the source level. The live behaviour —
// zero hydration errors across repeated home loads plus a ticking
// countdown — is covered by the Playwright check in
// tests/e2e/hydration.mjs against a production build.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

const source = read("components/FlashCountdown.tsx");
// Comments explain the bug and may name Date.now(); strip them so the
// checks below test code, not prose.
const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ---------------------------------------------------------------------------
// First render must be deterministic: no clock or randomness in the
// render path or in a useState initializer.
// ---------------------------------------------------------------------------

test("FlashCountdown: no Date.now() / new Date() in the first-render path", () => {
  // Date.now() may only appear inside remainingParts(), which is only
  // ever called from inside useEffect (after mount) — never during
  // render and never in a useState initializer. `new Date(endsAt)` in
  // the render path is fine: it only parses the prop, it reads no clock.
  const renderPath = code.split("useEffect")[0];
  assert.doesNotMatch(renderPath, /Date\.now\(\)/);
  assert.doesNotMatch(renderPath, /new Date\(\s*\)/);
  assert.doesNotMatch(code, /useState\(\(\) => remainingParts/);
  assert.doesNotMatch(code, /useState\(remainingParts/);
  assert.doesNotMatch(code, /Math\.random\(\)/);
  // The one remaining Date.now() lives in remainingParts, called from
  // the effect only.
  assert.match(code, /function remainingParts\(endsAtMs: number\)/);
  assert.equal((code.match(/Date\.now\(\)/g) ?? []).length, 1);
});

test("FlashCountdown: a mounted flag gates the live time, set in useEffect", () => {
  assert.match(code, /const \[mounted, setMounted\] = useState\(false\)/);
  assert.match(code, /useEffect\(\(\) => \{\s*\n\s*setMounted\(true\);/);
  // The rendered boxes use the live parts only after mount.
  assert.match(code, /const parts = mounted \? now : PLACEHOLDER;/);
});

test("FlashCountdown: the pre-mount placeholder is a static constant", () => {
  assert.match(
    code,
    /const PLACEHOLDER = \{ hours: 0, minutes: 0, seconds: 0 \};/,
  );
  assert.match(code, /useState\(PLACEHOLDER\)/);
});

test("FlashCountdown: the effect ticks immediately on mount, then every second", () => {
  assert.match(code, /setNow\(remainingParts\(endsAtMs\)\);/);
  assert.match(code, /window\.setInterval\(\s*\n?\s*\(\) => setNow\(remainingParts\(endsAtMs\)\),\s*\n?\s*1000,/);
  assert.match(code, /return \(\) => window\.clearInterval\(timer\);/);
});

test("FlashCountdown: no suppressHydrationWarning escape hatch", () => {
  assert.doesNotMatch(code, /suppressHydrationWarning/);
});

// ---------------------------------------------------------------------------
// No other component on the home page renders time or randomness
// during first render. (Checked 2026-11-08: Header, NewsletterForm,
// ProductCard, ProductImage, Footer and the home page itself only use
// constant useState initial values; ProductCard reads localStorage in
// useEffect only, which runs after hydration.)
// ---------------------------------------------------------------------------

test("home page tree: no other component renders Date.now() / Math.random() on first render", () => {
  const homeTree = [
    "app/page.tsx",
    "components/Header.tsx",
    "components/Footer.tsx",
    "components/NewsletterForm.tsx",
    "components/ProductCard.tsx",
    "components/ProductImage.tsx",
    "components/Stars.tsx",
  ];
  for (const rel of homeTree) {
    const file = read(rel);
    assert.doesNotMatch(file, /Date\.now\(\)/, `${rel} must not call Date.now()`);
    assert.doesNotMatch(file, /Math\.random\(\)/, `${rel} must not call Math.random()`);
    assert.doesNotMatch(file, /suppressHydrationWarning/, `${rel} must not suppress hydration warnings`);
  }
});
