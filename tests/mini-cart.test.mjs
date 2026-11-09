// Mini-cart drawer tests — TechShot.
//
// The drawer is a React component (components/MiniCartDrawer.tsx),
// so `node --test` cannot mount it. What IS proven here, following
// the repo's source-level test pattern (see
// tests/single-seller.test.mjs):
//   - the drawer renders from the SAME cart store the rest of the
//     site uses (useCart / usePricedCartLines) and holds no second
//     cart state of its own (no localStorage, no local item list);
//   - it has the required accessible structure (role="dialog",
//     aria-modal, Escape to close, overlay click to close, focus into
//     the panel on open and back to the header cart button on close);
//   - it shows lines with thumbnail/title/variant/quantity/price,
//     a remove control, the subtotal, the free-delivery hint, and
//     "View full cart" (/cart) + "Checkout" (/checkout) actions, plus
//     the empty-cart state;
//   - the header cart control is now a button that opens the drawer
//     (it used to be a Link to /cart — see the note below), and the
//     count badge is kept;
//   - the free-delivery hint math agrees with the drawer (threshold
//     ৳999, remaining amount formatted with formatBDT).
//
// What is NOT proven here: the click-through itself (open on
// cart-icon click, quantity changes updating the header count,
// "View full cart" landing on /cart, scroll position preserved).
// That is covered by the Playwright run in
// tests/e2e/mini-cart-variant-photos.mjs against the mock Supabase.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { formatBDT, FREE_DELIVERY_THRESHOLD_POISHA } from "../lib/theme.ts";
import { resolveCartLines } from "../lib/orders.ts";

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

// ---------------------------------------------------------------------------
// Behaviour change, stated plainly (2026-11-09): the header cart
// control used to be a Link to /cart, so clicking it navigated away
// from whatever the shopper was browsing. It is now a <button> that
// opens the mini-cart drawer; /cart is still reachable from the
// drawer's "View full cart" button and from the footer. The e2e
// smoke test's cart-badge selector was updated with it (it queried
// an anchor: a[aria-label^="Cart"]); the badge text is unchanged.
// ---------------------------------------------------------------------------

test("drawer uses the shared cart store and holds no second cart state", () => {
  const drawer = read("components/MiniCartDrawer.tsx");
  assert.match(drawer, /useCart\(\)/);
  assert.match(drawer, /usePricedCartLines\(\)/);
  assert.match(drawer, /from "\.\.\/lib\/cart-store"/);
  // No second source of truth: no localStorage access, no stored
  // cart key, no local items list. (The word "localStorage" appears
  // in the file's header comment, so this checks for actual use.)
  assert.equal(/localStorage\.(getItem|setItem|removeItem)/.test(drawer), false);
  assert.equal(/window\.localStorage/.test(drawer), false);
  assert.equal(/techshot-cart-v1/.test(drawer), false);
  assert.equal(/useState<CartItem/.test(drawer), false);
  // No navigation of its own except the two footer links.
  assert.equal(/router\.push/.test(drawer), false);
});

test("drawer has the required accessible dialog structure", () => {
  const drawer = read("components/MiniCartDrawer.tsx");
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /aria-label="Your cart"/);
  // Escape closes.
  assert.match(drawer, /e\.key === "Escape"/);
  assert.match(drawer, /addEventListener\("keydown"/);
  // Clicking the dimmed overlay closes.
  assert.match(drawer, /aria-hidden="true"/);
  assert.match(drawer, /bg-black\/60/);
  // Focus moves into the panel on open (close button) and back to the
  // header cart button on close (trigger ref).
  assert.match(drawer, /closeButtonRef\.current\?\.focus\(\)/);
  assert.match(drawer, /triggerRef\.current\?\.focus\(\)/);
  // Body scroll is locked while the drawer is open.
  assert.match(drawer, /document\.body\.style\.overflow = "hidden"/);
  // Mobile: near-full-width; desktop: fixed right-side panel.
  assert.match(drawer, /fixed inset-0/);
  assert.match(drawer, /w-\[92vw\] max-w-md/);
  assert.match(drawer, /absolute right-0 top-0.*h-full/);
});

test("drawer shows lines, quantities, remove, subtotal and the free-delivery hint", () => {
  const drawer = read("components/MiniCartDrawer.tsx");
  // Line rendering reuses the /cart rules: priced line matched by
  // slug + variant, title/image fall back to the seed catalogue.
  assert.match(drawer, /l\.productId === item\.slug/);
  assert.match(drawer, /line\?\.title \?\?/);
  assert.match(drawer, /line\?\.image \?\? product\?\.image/);
  assert.match(drawer, /ProductImage/);
  // Quantity +/- and remove go through the shared store.
  assert.match(drawer, /cart\.setQuantity\(\s*item\.slug,\s*item\.variant,\s*item\.quantity - 1/s);
  assert.match(drawer, /cart\.setQuantity\(\s*item\.slug,\s*item\.variant,\s*item\.quantity \+ 1/s);
  assert.match(drawer, /cart\.remove\(item\.slug, item\.variant\)/);
  assert.match(drawer, /aria-label="Decrease quantity"/);
  assert.match(drawer, /aria-label="Increase quantity"/);
  // Subtotal from the priced lines, formatted like /cart.
  assert.match(drawer, /line\.price_poisha \* line\.quantity/);
  assert.match(drawer, /formatBDT\(subtotalPoisha\)/);
  // Free-delivery hint: amount still needed, or the unlocked message
  // (the apostrophe is &apos; in JSX; it renders as "You've got free
  // delivery").
  assert.match(drawer, /FREE_DELIVERY_THRESHOLD_POISHA/);
  assert.match(drawer, /You&apos;ve got free delivery/);
  assert.match(drawer, /more to unlock free delivery/);
});

test("drawer footer: View full cart, Checkout, and the empty-cart state", () => {
  const drawer = read("components/MiniCartDrawer.tsx");
  assert.match(drawer, /View full cart/);
  assert.match(drawer, /href="\/cart"/);
  assert.match(drawer, /Checkout/);
  assert.match(drawer, /href="\/checkout"/);
  // Both footer links close the drawer when clicked.
  assert.match(drawer, /href="\/cart"\s*\n\s*onClick={onClose}/);
  assert.match(drawer, /href="\/checkout"\s*\n\s*onClick={onClose}/);
  // Empty cart: message + a button that only closes the panel.
  assert.match(drawer, /Your cart is empty/);
  assert.match(drawer, /Continue shopping/);
  assert.match(drawer, /cart\.items\.length === 0/);
});

test("header cart control is a button that opens the drawer (not a link to /cart)", () => {
  const header = read("components/Header.tsx");
  assert.match(header, /import MiniCartDrawer from "\.\/MiniCartDrawer"/);
  assert.match(header, /<button/);
  assert.match(header, /aria-haspopup="dialog"/);
  assert.match(header, /onClick={\(\) => setCartOpen\(true\)}/);
  assert.match(header, /<MiniCartDrawer/);
  assert.match(header, /open={cartOpen}/);
  assert.match(header, /triggerRef={cartButtonRef}/);
  // The header no longer links anywhere to /cart; the drawer owns
  // the only route to it from the header.
  assert.equal(/href="\/cart"/.test(header), false);
  // The count badge and its aria-label are kept.
  assert.match(header, /aria-label={`Cart, \${displayCount} items`}/);
  assert.match(header, /displayCount > 0/);
});

test("the e2e smoke test's cart-badge selector follows the button change", () => {
  const smoke = read("tests/e2e/smoke.mjs");
  assert.equal(/a\[aria-label\^="Cart"\]/.test(smoke), false);
  assert.match(smoke, /\[aria-label\^="Cart"\]/);
});

test("/cart page is untouched in behaviour", () => {
  // The page is now a thin composition: the summary sidebar (with the
  // checkout link) lives in components/cart/cart-summary.tsx. Read
  // both, so the page is still pinned to the same behaviour.
  const cart = ["app/cart/page.tsx", "components/cart/cart-summary.tsx"]
    .map((rel) => read(rel))
    .join("\n");
  // Still the full cart page: empty state, checkout link, same
  // priced-line rules the drawer mirrors.
  assert.match(cart, /Your cart is empty/);
  assert.match(cart, /href="\/checkout"/);
  assert.match(cart, /usePricedCartLines\(\)/);
});

test("free-delivery hint math: ৳999 threshold, remaining amount formatted", () => {
  assert.equal(FREE_DELIVERY_THRESHOLD_POISHA, 99900);
  // A ৳149 line is ৳850 short of free delivery.
  const small = resolveCartLines([{ slug: "youtube-premium-1-month", quantity: 1 }]).lines;
  assert.equal(small[0].price_poisha, 14900);
  assert.equal(
    formatBDT(FREE_DELIVERY_THRESHOLD_POISHA - small[0].price_poisha),
    "৳850",
  );
  // A ৳1,19,900 line is over the threshold — free delivery.
  const big = resolveCartLines([
    { slug: "apple-iphone-16-pro-256gb-natural-titanium", variant: "256GB Natural Titanium", quantity: 1 },
  ]).lines;
  assert.equal(big[0].price_poisha, 11990000);
  assert.ok(big[0].price_poisha >= FREE_DELIVERY_THRESHOLD_POISHA);
});
