// Favicon + sign-in copy tests — TechShot.
//
// 2026-11-08: the site shipped with no favicon (a 404 in the console on
// every page) and the sign-in page still said "Sign in to shop, sell,
// and track your orders" after the store went single-seller. The
// favicon is a text SVG (app/icon.svg) because the GitHub snapshot
// push is UTF-8 only and cannot carry a binary .ico. These tests pin
// both fixes down.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

// ---------------------------------------------------------------------------
// Favicon: a text SVG the snapshot push can carry, solid colours only.
// The favicon is the owner's TS mark (green #009F59 + light #E0E4EC)
// on the logo navy (#00162E) — the orange bolt is gone since the
// 2026-11-09 logo swap.
// ---------------------------------------------------------------------------

test("app/icon.svg exists and is a solid-colour SVG favicon", () => {
  assert.equal(existsSync(new URL("../app/icon.svg", import.meta.url)), true);
  const svg = read("app/icon.svg");
  assert.match(svg, /<svg[^>]*viewBox=/);
  assert.doesNotMatch(svg, /gradient/i);
  assert.doesNotMatch(svg, /emoji/i);
  // The owner's TS mark on the logo navy — no orange left.
  assert.match(svg, /#00162E/);
  assert.match(svg, /#009F59/);
  assert.match(svg, /#E0E4EC/);
  assert.doesNotMatch(svg, /#f97316/);
});

test("no binary favicon is referenced anywhere", () => {
  assert.equal(existsSync(new URL("../public/favicon.ico", import.meta.url)), false);
  assert.equal(existsSync(new URL("../app/favicon.ico", import.meta.url)), false);
});

// ---------------------------------------------------------------------------
// Sign-in copy: no selling reference left for customers.
// ---------------------------------------------------------------------------

test("sign-in page does not mention selling", () => {
  const page = read("app/auth/sign-in/page.tsx");
  assert.doesNotMatch(page, /\bsell\b/i);
  assert.match(page, /Sign in to shop and track your orders\./);
});

test("no customer-facing page invites the visitor to sell", () => {
  const visible = [
    "app/auth/sign-in/page.tsx",
    "app/auth/sign-up/page.tsx",
    "app/page.tsx",
    "app/shop/page.tsx",
  ];
  for (const rel of visible) {
    const source = read(rel);
    const withoutComments = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    assert.doesNotMatch(withoutComments, /become a seller/i, rel);
    assert.doesNotMatch(withoutComments, /sell on techshot/i, rel);
    assert.doesNotMatch(withoutComments, /start selling/i, rel);
  }
});
