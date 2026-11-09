// Code-built logo wordmark tests — TechShot.
//
// 2026-11-09: the header and footer used a blue rounded square with
// a Zap icon and "TechShot." text. The owner asked for the wordmark
// rebuilt in code to match his own logo (shared as an SVG on
// 2026-11-09): TS monogram, "TechShot" in extra-bold geometric sans,
// smaller green "BD", tagline "A Shot of Tech, You Can Trust" —
// navy #00162E, green #0F9A70, white #F1F7FE, flat, no gradients.
// The logo lives in components/Logo.tsx (no image files); the green
// is a named token in lib/theme.ts, and the site's blue/orange
// accents are untouched. These tests pin the lockup down.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

// ---------------------------------------------------------------------------
// Logo tokens: the owner's palette, named once, used everywhere.
// ---------------------------------------------------------------------------

test("theme.ts carries the logo palette as named tokens", () => {
  const theme = read("lib/theme.ts");
  assert.match(theme, /logoGreen:\s*"#0F9A70"/);
  assert.match(theme, /logoNavy:\s*"#00162E"/);
  assert.match(theme, /logoWhite:\s*"#F1F7FE"/);
});

test("the recolour promotes the logo green to the site brand (blue is gone)", () => {
  // 2026-11-09 recolour: the site's primary accent is now the logo
  // green, not the old Figma blue. Orange stays, deals-only.
  const theme = read("lib/theme.ts");
  assert.match(theme, /brand:\s*"#0F9A70"/);
  assert.match(theme, /accent:\s*"#f97316"/);
  assert.doesNotMatch(theme, /#3b82f6/);
});

test("tailwind maps the logo tokens to classes", () => {
  const config = read("tailwind.config.ts");
  assert.match(config, /logoGreen:\s*theme\.colors\.logoGreen/);
  assert.match(config, /logoNavy:\s*theme\.colors\.logoNavy/);
  assert.match(config, /logoWhite:\s*theme\.colors\.logoWhite/);
});

// ---------------------------------------------------------------------------
// Logo component: the lockup, in code, no image files.
// ---------------------------------------------------------------------------

test("components/Logo.tsx exists and renders the full lockup", () => {
  assert.equal(existsSync(new URL("../components/Logo.tsx", import.meta.url)), true);
  const logo = read("components/Logo.tsx");
  // Monogram: an inline SVG with a T over an S and a circuit trace.
  assert.match(logo, /<svg[^>]*viewBox="0 0 48 48"/);
  assert.match(logo, /<polyline/);
  assert.match(logo, /<text[^>]*>\s*S\s*<\/text>/);
  assert.match(logo, /<text[^>]*>\s*T\s*<\/text>/);
  // Wordmark + BD + tagline, exactly as the owner's logo.
  assert.match(logo, />TechShot</);
  assert.match(logo, />BD</);
  assert.match(logo, /A Shot of Tech, You Can Trust/);
  // The whole lockup links home.
  assert.match(logo, /href="\/"/);
  assert.match(logo, /aria-label="TechShot home"/);
});

test("the logo uses Montserrat extra-bold for the wordmark", () => {
  const logo = read("components/Logo.tsx");
  assert.match(logo, /import \{ Montserrat \} from "next\/font\/google"/);
  assert.match(logo, /weight: \["300", "800"\]/);
  assert.match(logo, /font-extrabold/);
  // Tagline is light with wide tracking.
  assert.match(logo, /font-light tracking-\[0\.22em\]/);
});

test("the logo tagline hides on small screens by default", () => {
  const logo = read("components/Logo.tsx");
  // "responsive" (the default): hidden below sm, shown from sm up.
  assert.match(logo, /"responsive" \| "always" \| "never"/);
  assert.match(logo, /hidden sm:block/);
  // Footer shows it at every width.
  const footer = read("components/Footer.tsx");
  assert.match(footer, /<Logo tagline="always" \/>/);
});

test("the logo uses tokens, never hard-coded hex, and no gradients", () => {
  const logo = read("components/Logo.tsx");
  // The header comment names the palette in prose; the check below
  // is about the rendered code, so comments are stripped first.
  const code = logo
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(code, /#[0-9a-fA-F]{6}/);
  assert.doesNotMatch(logo, /gradient/i);
  assert.match(logo, /text-logoGreen/);
  assert.match(logo, /bg-logoNavy/);
  assert.match(logo, /text-logoWhite/);
});

// ---------------------------------------------------------------------------
// Header + footer use the logo; the old Zap lockup is gone.
// ---------------------------------------------------------------------------

test("header and footer render the logo component", () => {
  const header = read("components/Header.tsx");
  assert.match(header, /import Logo from "\.\/Logo"/);
  assert.match(header, /<Logo \/>/);
  assert.doesNotMatch(header, /Zap/);
  assert.doesNotMatch(header, /TechShot<span/);
  const footer = read("components/Footer.tsx");
  assert.match(footer, /import Logo from "\.\/Logo"/);
  assert.match(footer, /<Logo tagline="always" \/>/);
  assert.doesNotMatch(footer, /Zap/);
});
