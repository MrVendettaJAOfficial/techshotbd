// Per-route skeleton loading tests — TechShot.
//
// The root app/loading.tsx used to be one generic skeleton (two text
// bars, three small cards, one big block) shared by every route, so
// no page ever looked like it was loading — navigation felt blank.
// Each route now has its own loading.tsx that mirrors the real page
// layout (home hero + product grid, shop filters + grid, product
// gallery + info column, account dashboard, admin dashboard), so the
// matching skeleton shows instantly on navigation.
//
// What is proven here (source-level; node --test has no browser):
//   - each loading.tsx exists, is a default export, and carries
//     aria-label="Loading" so a screen reader / test can find it;
//   - each one matches its page's real layout (hero / filters /
//     gallery / form landmarks, same grid classes and card counts);
//   - all use the existing animate-pulse + bg-panel pattern, solid
//     colours only — no gradients, no emoji.
//   - the mini-cart drawer needs no skeleton: its content is
//     synchronous from the cart store (no fetch, no await), so it
//     opens instantly with the lines already in it.
//
// What is NOT proven here: the skeleton actually appearing on screen
// during a navigation. That is covered by the Playwright run in
// tests/e2e/mini-cart-variant-photos.mjs, which navigates to /shop
// and a product page and asserts the skeleton is visible before the
// content arrives.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

function assertSkeletonBasics(name, src) {
  assert.match(src, /export default function Loading/, `${name}: must default-export Loading`);
  assert.match(src, /aria-label="Loading"/, `${name}: must carry aria-label="Loading"`);
  assert.match(src, /animate-pulse/, `${name}: must use animate-pulse`);
  assert.match(src, /bg-panel|bg-border/, `${name}: must use the bg-panel / bg-border blocks`);
  assert.doesNotMatch(src, /bg-gradient|linear-gradient|radial-gradient/, `${name}: no gradients — solid colours only`);
  // No emoji anywhere in a skeleton.
  assert.doesNotMatch(
    src,
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
    `${name}: no emoji`,
  );
}

test("home skeleton (app/loading.tsx) mirrors the home page", () => {
  assert.ok(existsSync(new URL("../app/loading.tsx", import.meta.url)));
  const src = root("app/loading.tsx");
  assertSkeletonBasics("app/loading.tsx", src);
  // Hero: two-column panel with a square visual, like app/page.tsx.
  assert.match(src, /lg:grid-cols-2/, "home skeleton: hero is two columns");
  assert.match(src, /aspect-square/, "home skeleton: hero visual is a square block");
  // Trust strip (4 tiles) + category row (4 tiles) + trending grid (4 cards).
  assert.match(src, /lg:grid-cols-4/, "home skeleton: four-across rows");
  assert.match(src, /sm:grid-cols-2 lg:grid-cols-4/, "home skeleton: trending product grid");
});

test("shop skeleton mirrors the shop page (filters + 9-card grid)", () => {
  assert.ok(existsSync(new URL("../app/shop/loading.tsx", import.meta.url)));
  const src = root("app/shop/loading.tsx");
  assertSkeletonBasics("app/shop/loading.tsx", src);
  // Shop layout: 260px filters sidebar beside the grid.
  assert.match(src, /lg:grid-cols-\[260px_1fr\]/, "shop skeleton: filters sidebar layout");
  // Page one shows 9 cards (PAGE_SIZE = 9), grid sm:2 / xl:3.
  assert.match(src, /sm:grid-cols-2 xl:grid-cols-3/, "shop skeleton: product grid columns");
  assert.match(src, /length: 9/, "shop skeleton: nine product cards");
  // Category pills row above the grid.
  assert.match(src, /rounded-full/, "shop skeleton: category pills");
});

test("product skeleton mirrors the product page (gallery + info column)", () => {
  assert.ok(existsSync(new URL("../app/product/[slug]/loading.tsx", import.meta.url)));
  const src = root("app/product/[slug]/loading.tsx");
  assertSkeletonBasics("app/product/[slug]/loading.tsx", src);
  // Two-column detail: gallery square + thumbnails on the left,
  // title / price / selectors / buttons on the right.
  assert.match(src, /lg:grid-cols-2/, "product skeleton: gallery + info columns");
  assert.match(src, /aspect-square/, "product skeleton: gallery square");
  // Colour / storage selector pills and the tabs row below.
  assert.match(src, /rounded-full/, "product skeleton: selector pills");
  assert.match(src, /border-b border-border/, "product skeleton: tabs row");
});

test("account skeleton mirrors the account dashboard", () => {
  assert.ok(existsSync(new URL("../app/account/loading.tsx", import.meta.url)));
  const src = root("app/account/loading.tsx");
  assertSkeletonBasics("app/account/loading.tsx", src);
  // Account layout: max-w-[900px] column, user card, profile form.
  assert.match(src, /max-w-\[900px\]/, "account skeleton: 900px column");
  assert.match(src, /aria-label="Profile"/, "account skeleton: profile section");
  assert.match(src, /sm:grid-cols-2/, "account skeleton: two-column profile form");
});

test("admin skeleton mirrors the admin dashboard", () => {
  assert.ok(existsSync(new URL("../app/admin/loading.tsx", import.meta.url)));
  const src = root("app/admin/loading.tsx");
  assertSkeletonBasics("app/admin/loading.tsx", src);
  // Admin layout: title, Add-product form card, product rows, then
  // the Orders / Coupons / Users sections.
  assert.match(src, /max-w-shell/, "admin skeleton: shell width");
  assert.match(src, /sm:grid-cols-2/, "admin skeleton: form field grid");
  assert.match(src, /flex items-center justify-between/, "admin skeleton: product rows");
});
