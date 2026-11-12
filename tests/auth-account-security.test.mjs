// Auth / account security — TechShot.
//
// Regression tests for the 3-MEDIUM batch (audit run-1, head
// 9c305966): #8 unauthenticated order-confirmation PII, #9
// browser-local orders / profile / addresses / wishlist leaking to
// the next account on a shared browser, #10 reset-password page
// changing the password for any signed-in session.
//
// The pure rules (lib/account-rules.ts, lib/password-rules.ts) are
// tested by importing the real modules directly, and the
// browser-local store (lib/checkout/storage.ts) runs against a fake
// window.localStorage installed below — storage.ts reads `window`
// at call time, so the fake only has to exist before the first
// call, not before the import. The server-only wiring (recovery
// marker cookie, sign-out clearing, page gates) cannot run under
// `node --test` — those modules import next/headers, which plain
// Node cannot load — so it is pinned by source assertions, the
// same pattern as tests/password-reset.test.mjs.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  canViewConfirmationOrder,
  mergeOrders,
  timingSafeEqualStrings,
} from "../lib/account-rules.ts";
import { isRecoveryAmr } from "../lib/password-rules.ts";
import {
  addAddress,
  addToWishlist,
  deleteAddress,
  getAddresses,
  getDefaultAddress,
  getOrder,
  getProfile,
  getWishlist,
  listOrders,
  removeFromWishlist,
  saveOrder,
  saveProfile,
  updateAddress,
  updateOrderStatus,
} from "../lib/checkout/storage.ts";

function readSource(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

// ---------------------------------------------------------------------------
// Fake browser storage for lib/checkout/storage.ts.
// ---------------------------------------------------------------------------

const fakeStore = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (fakeStore.has(key) ? fakeStore.get(key) : null),
    setItem: (key, value) => fakeStore.set(key, String(value)),
    removeItem: (key) => fakeStore.delete(key),
    clear: () => fakeStore.clear(),
  },
};

function resetStorage() {
  fakeStore.clear();
}

function makeAddress(overrides = {}) {
  return {
    id: "addr-1",
    firstName: "Test",
    lastName: "User",
    email: "test@example.com",
    mobile: "01712345678",
    address: "House 1, Road 2",
    area: "Dhanmondi",
    division: "Dhaka",
    district: "Dhaka",
    city: "Dhaka",
    isDefault: true,
    ...overrides,
  };
}

function makeOrder(overrides = {}) {
  return {
    id: "order-1",
    orderNumber: "TS-20261112-0001",
    items: [
      {
        productId: "apple-iphone-16-pro",
        title: "Apple iPhone 16 Pro",
        price_poisha: 11990000,
        mrp_poisha: 12990000,
        quantity: 1,
      },
    ],
    address: makeAddress(),
    delivery: "standard",
    paymentMethod: "cod",
    subtotal_poisha: 11990000,
    savings_poisha: 1000000,
    couponCode: null,
    couponDiscount_poisha: 0,
    deliveryFee_poisha: 0,
    total_poisha: 11990000,
    status: "confirmed",
    paymentStatus: "unpaid",
    userId: null,
    buyerToken: null,
    testMode: false,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// #8 — order confirmation is owner-only.
// ---------------------------------------------------------------------------

test("#8 timingSafeEqualStrings compares in constant time, not by early exit", () => {
  assert.equal(timingSafeEqualStrings("abc", "abc"), true);
  assert.equal(timingSafeEqualStrings("", ""), true);
  // Same length, differs only in the last character: an early-exit
  // compare would answer faster here; this one must still say no.
  assert.equal(timingSafeEqualStrings("aaa", "aab"), false);
  assert.equal(timingSafeEqualStrings("aaa", "baa"), false);
  // Different lengths are unequal by definition.
  assert.equal(timingSafeEqualStrings("aaa", "aaaa"), false);
  assert.equal(timingSafeEqualStrings("aaaa", "aaa"), false);
});

test("#8 a signed-in order is visible only to its owner", () => {
  const order = { userId: "user-1", buyerToken: null };
  assert.equal(canViewConfirmationOrder(order, "user-1", null), true);
  assert.equal(canViewConfirmationOrder(order, null, null), false);
  assert.equal(canViewConfirmationOrder(order, "user-2", null), false);
  // Even the correct guest key does not open someone else's
  // signed-in order: the session, not the key, proves ownership.
  assert.equal(canViewConfirmationOrder(order, "user-2", "some-key"), false);
});

test("#8 a guest order is visible only to the holder of its buyerToken", () => {
  const order = { userId: null, buyerToken: "550e8400-e29b-41d4-a716-446655440000" };
  assert.equal(
    canViewConfirmationOrder(order, null, "550e8400-e29b-41d4-a716-446655440000"),
    true,
  );
  assert.equal(canViewConfirmationOrder(order, null, null), false);
  assert.equal(canViewConfirmationOrder(order, null, ""), false);
  assert.equal(canViewConfirmationOrder(order, null, "wrong-key"), false);
  assert.equal(
    canViewConfirmationOrder(order, null, "550e8400-e29b-41d4-a716-446655440001"),
    false,
  );
  // A signed-in viewer with no key does not open a guest order
  // either: the key is the guest's proof, and signing in as
  // someone else is not it.
  assert.equal(canViewConfirmationOrder(order, "user-1", null), false);
});

test("#8 an order with no key and no owner is never visible", () => {
  // Orders placed before buyerTokens existed carry neither: fail
  // closed, there is no key that can open them.
  assert.equal(
    canViewConfirmationOrder({ userId: null, buyerToken: null }, null, "any-key"),
    false,
  );
  assert.equal(canViewConfirmationOrder(null, "user-1", "any-key"), false);
});

test("#8 confirmation page gates on the owner rule, not on the order id", () => {
  const page = readSource("app/checkout/confirmation/page.tsx");
  assert.match(page, /canViewConfirmationOrder/);
  assert.match(page, /canViewConfirmationOrder\(order, user\?\.id \?\? null, searchParams\.key \?\? null\)/);
  assert.match(page, /getCurrentUser\(\)/);
  assert.match(page, /searchParams\.key/);
  // The denial and the unknown order share one branch, with no
  // reason shown for a denial.
  assert.match(page, /if \(!order \|\| !allowed\) \{/);
  assert.match(page, /Order not found/);
});

test("#8 order creation sites already carry userId + buyerToken (no fix needed there)", () => {
  // Supabase path: signed-in orders carry the session id and no
  // key; guest orders carry user_id NULL and a fresh random key.
  const create = readSource("lib/orders/server/create.ts");
  assert.match(create, /const buyerToken = userId \? null : randomUUID\(\);/);
  assert.match(create, /userId,\n    buyerToken,/);
  // Local (unconfigured) path: the session id when there is one,
  // otherwise null — and a fresh random key.
  const checkout = readSource("app/checkout/page.tsx");
  assert.match(checkout, /userId: localUserId,/);
  assert.match(checkout, /buyerToken: randomUUID\(\),/);
});

// ---------------------------------------------------------------------------
// #9 — browser-local records are scoped to their owner.
// ---------------------------------------------------------------------------

test("#9 listOrders returns only the viewer's orders", () => {
  resetStorage();
  saveOrder(makeOrder({ id: "a-1", userId: "user-1", createdAt: "2026-11-12T10:00:00.000Z" }));
  saveOrder(makeOrder({ id: "a-2", userId: "user-1", createdAt: "2026-11-12T11:00:00.000Z" }));
  saveOrder(makeOrder({ id: "b-1", userId: "user-2", createdAt: "2026-11-12T12:00:00.000Z" }));
  saveOrder(makeOrder({ id: "g-1", userId: null, createdAt: "2026-11-12T09:00:00.000Z" }));

  assert.deepEqual(
    listOrders("user-1").map((o) => o.id),
    ["a-2", "a-1"],
  );
  assert.deepEqual(
    listOrders("user-2").map((o) => o.id),
    ["b-1"],
  );
  // The guest view sees guest orders only — never another
  // account's orders placed on this browser.
  assert.deepEqual(
    listOrders(null).map((o) => o.id),
    ["g-1"],
  );
  // No id at all is the legacy unfiltered list, for the callers
  // that cannot know the viewer (admin list, inbox, order detail
  // fallback). Pages that know the viewer must pass the id.
  assert.equal(listOrders().length, 4);
});

test("#9 getOrder returns another account's order to nobody but its owner", () => {
  resetStorage();
  saveOrder(makeOrder({ id: "a-1", userId: "user-1" }));
  assert.equal(getOrder("a-1", "user-1")?.id, "a-1");
  assert.equal(getOrder("a-1", "user-2"), null);
  assert.equal(getOrder("a-1", null), null);
  assert.equal(getOrder("missing", "user-1"), null);
  // Legacy unfiltered lookup still works for callers without a viewer.
  assert.equal(getOrder("a-1")?.id, "a-1");
});

test("#9 saving one account's order never drops another account's orders", () => {
  resetStorage();
  saveOrder(makeOrder({ id: "a-1", userId: "user-1" }));
  saveOrder(makeOrder({ id: "b-1", userId: "user-2" }));
  assert.equal(listOrders().length, 2);
  assert.deepEqual(
    listOrders("user-1").map((o) => o.id),
    ["a-1"],
  );
});

test("#9 a legacy order with no userId reads back as a guest order", () => {
  resetStorage();
  const legacy = makeOrder({ id: "old-1" });
  delete legacy.userId;
  delete legacy.buyerToken;
  saveOrder(legacy);
  assert.deepEqual(
    listOrders(null).map((o) => o.id),
    ["old-1"],
  );
  assert.deepEqual(listOrders("user-1"), []);
});

test("#9 updateOrderStatus honours the owner guard", () => {
  resetStorage();
  saveOrder(makeOrder({ id: "a-1", userId: "user-1", status: "confirmed" }));
  // The wrong owner cannot move it, and the stored copy is unchanged.
  assert.equal(
    updateOrderStatus("a-1", { status: "cancelled" }, "user-2"),
    null,
  );
  assert.equal(getOrder("a-1", "user-1")?.status, "confirmed");
  // The owner can, and the legacy no-id call still works.
  assert.equal(
    updateOrderStatus("a-1", { status: "cancelled" }, "user-1")?.status,
    "cancelled",
  );
  assert.equal(
    updateOrderStatus("a-1", { status: "shipped" })?.status,
    "shipped",
  );
});

test("#9 the stored profile belongs to one account only", () => {
  resetStorage();
  saveProfile(
    { displayName: "A User", phone: "01700000001", email: "a@example.com" },
    "user-1",
  );
  assert.equal(getProfile("user-1").displayName, "A User");
  assert.equal(getProfile("user-2").displayName, "");
  assert.equal(getProfile(null).displayName, "");
  // Legacy no-id read returns the stored profile, as before.
  assert.equal(getProfile().displayName, "A User");
  // Saving as a guest overwrites with a guest-stamped profile.
  saveProfile({ displayName: "Guest", phone: "", email: "" });
  assert.equal(getProfile(null).displayName, "Guest");
  assert.equal(getProfile("user-1").displayName, "");
});

test("#9 addresses are scoped, and the default rule stays inside one account", () => {
  resetStorage();
  const a1 = addAddress(
    {
      firstName: "A",
      lastName: "User",
      email: "a@example.com",
      mobile: "01700000001",
      address: "House 1",
      area: "Dhanmondi",
      division: "Dhaka",
      district: "Dhaka",
      city: "Dhaka",
      isDefault: true,
    },
    "user-1",
  );
  const a2 = addAddress(
    {
      firstName: "A",
      lastName: "Second",
      email: "a@example.com",
      mobile: "01700000001",
      address: "House 2",
      area: "Dhanmondi",
      division: "Dhaka",
      district: "Dhaka",
      city: "Dhaka",
      isDefault: true,
    },
    "user-1",
  );
  const b1 = addAddress(
    {
      firstName: "B",
      lastName: "User",
      email: "b@example.com",
      mobile: "01700000002",
      address: "House 9",
      area: "Agrabad",
      division: "Chattogram",
      district: "Chattogram",
      city: "Chattogram",
      isDefault: true,
    },
    "user-2",
  );

  assert.deepEqual(
    getAddresses("user-1").map((a) => a.id),
    [a1.id, a2.id],
  );
  assert.deepEqual(
    getAddresses("user-2").map((a) => a.id),
    [b1.id],
  );
  assert.deepEqual(getAddresses(null), []);
  // B's first address is B's default, and it did not demote A's.
  assert.equal(getDefaultAddress("user-1")?.id, a2.id);
  assert.equal(getDefaultAddress("user-2")?.id, b1.id);
  // Deleting A's default promotes A's next address, not B's.
  deleteAddress(a2.id);
  assert.equal(getDefaultAddress("user-1")?.id, a1.id);
  assert.equal(getDefaultAddress("user-2")?.id, b1.id);
  // Setting a default demotes only the same owner's addresses.
  updateAddress(a1.id, { isDefault: true });
  assert.equal(getDefaultAddress("user-1")?.id, a1.id);
  assert.equal(getDefaultAddress("user-2")?.id, b1.id);
});

test("#9 wishlist entries are scoped, and two owners can hold the same product", () => {
  resetStorage();
  addToWishlist(
    { productId: "apple-iphone-16-pro", title: "iPhone", price_poisha: 11990000, mrp_poisha: 12990000 },
    "user-1",
  );
  addToWishlist(
    { productId: "apple-iphone-16-pro", title: "iPhone", price_poisha: 11990000, mrp_poisha: 12990000 },
    "user-2",
  );
  // Both entries are stored: one owner's add did not swallow the
  // other's, and each viewer sees only their own.
  assert.equal(getWishlist().length, 2);
  assert.equal(getWishlist("user-1").length, 1);
  assert.equal(getWishlist("user-2").length, 1);
  assert.equal(getWishlist(null).length, 0);
  // Removing user-1's entry leaves user-2's in place.
  removeFromWishlist("apple-iphone-16-pro", "user-1");
  assert.equal(getWishlist("user-1").length, 0);
  assert.equal(getWishlist("user-2").length, 1);
});

test("#9 mergeOrders in server mode renders live orders only", () => {
  const localA = {
    id: "a-1",
    orderNumber: "TS-LOCAL-1",
    status: "confirmed",
    total_poisha: 100,
    createdAt: "2026-11-12T10:00:00.000Z",
  };
  const remoteB = {
    id: "b-1",
    orderNumber: "TS-LIVE-1",
    status: "processing",
    total_poisha: 200,
    createdAt: "2026-11-12T11:00:00.000Z",
  };
  // Signed in: another account's local orders never surface.
  assert.deepEqual(
    mergeOrders([localA], [remoteB], true).map((o) => o.id),
    ["b-1"],
  );
  // Signed in with no live orders: the local list is not a
  // fallback — the user sees no orders at all.
  assert.deepEqual(mergeOrders([localA], [], true), []);
  // Guest / unconfigured (default): the old merge is unchanged —
  // local orders are kept and the live copy wins on the same id.
  const merged = mergeOrders([localA], [remoteB]);
  assert.deepEqual(
    merged.map((o) => o.id),
    ["b-1", "a-1"],
  );
});

test("#9 sign-out clears the account keys and never the cart", () => {
  const auth = readSource("lib/auth.ts");
  assert.match(auth, /clearLocalAccountData\(\)/);
  assert.match(auth, /STORAGE_KEYS\.orders/);
  assert.match(auth, /STORAGE_KEYS\.profile/);
  assert.match(auth, /STORAGE_KEYS\.addresses/);
  assert.match(auth, /STORAGE_KEYS\.wishlist/);
  // The cart is owner-tagged and filtered on render instead of
  // being deleted (see lib/cart-store.ts): sign-out must not
  // remove it, or a guest cart would not survive sign-out.
  assert.equal(auth.includes("techshot-cart-v1"), false);
  // And the clearing runs before the Supabase sign-out, so it
  // happens even if the server call fails.
  const clearAt = auth.indexOf("clearLocalAccountData();");
  const signOutAt = auth.indexOf("supabase.auth.signOut()", clearAt);
  assert.ok(clearAt > -1 && signOutAt > -1 && clearAt < signOutAt);
});

test("#9 /orders and /account render only the signed-in user's orders", () => {
  const ordersPage = readSource("app/orders/page.tsx");
  assert.match(ordersPage, /getSession\(\)/);
  assert.match(ordersPage, /listOrders\(userId\)/);
  assert.match(ordersPage, /mergeOrders\(browserOrders, liveOrders, userId !== null\)/);
  assert.match(ordersPage, /mergeOrders\(listOrders\(userId\), liveOrders, userId !== null\)/);

  const accountPage = readSource("app/account/page.tsx");
  // Mount seeds the guest view; the auth effect re-seeds with the
  // signed-in user's id; server data merges in server mode.
  assert.match(accountPage, /listOrders\(null\)/);
  assert.match(accountPage, /listOrders\(user\.id\)/);
  assert.match(accountPage, /getProfile\(user\.id\)/);
  assert.match(accountPage, /getAddresses\(user\.id\)/);
  assert.match(accountPage, /getWishlist\(user\.id\)/);
  assert.match(accountPage, /mergeOrders\(local, data\.orders, true\)/);
});

test("#9 cart is owner-tagged and filtered on render, never deleted on sign-out", () => {
  const cart = readSource("lib/cart-store.ts");
  // The stored shape carries the owner id (same key as before).
  assert.match(cart, /JSON\.stringify\(\{ userId: cart\.userId, items: cart\.items \}\)/);
  assert.match(cart, /resolveVisibleCart/);
  assert.match(cart, /if \(\(stored\.userId \?\? null\) !== currentUserId\) return \[\];/);
  // Legacy bare-array carts still load, as the guest cart.
  assert.match(cart, /if \(Array\.isArray\(parsed\)\) return \{ userId: null, items: validCartItems\(parsed\) \};/);
  // Sign-out keeps the cart: no removal anywhere in the file.
  assert.equal(/removeItem\(STORAGE_KEY\)/.test(cart), false);
  // Only the guest cart is ever uploaded into a new sign-in's
  // server cart, and only the owner's lines sync to the server.
  assert.match(cart, /cartRef\.current\.userId === null \? cartRef\.current\.items : \[\]/);
  assert.match(cart, /if \(cart\.userId !== serverUserId\) return;/);
});

// ---------------------------------------------------------------------------
// #10 — only a recovery session may reset the password.
// ---------------------------------------------------------------------------

test("#10 isRecoveryAmr identifies recovery sessions from the amr claim", () => {
  assert.equal(isRecoveryAmr([{ method: "recovery", timestamp: 1700000000 }]), true);
  assert.equal(isRecoveryAmr([{ method: "password", timestamp: 1700000000 }]), false);
  assert.equal(isRecoveryAmr([{ method: "otp" }]), false);
  // A recovery entry among others still counts.
  assert.equal(
    isRecoveryAmr([{ method: "password" }, { method: "recovery" }]),
    true,
  );
  assert.equal(isRecoveryAmr([]), false);
  assert.equal(isRecoveryAmr(undefined), false);
  assert.equal(isRecoveryAmr(null), false);
  assert.equal(isRecoveryAmr("recovery"), false);
  assert.equal(isRecoveryAmr([{ method: "Recovery" }]), false);
  assert.equal(isRecoveryAmr([{}]), false);
});

test("#10 the recovery marker is set server-side, only for type=recovery", () => {
  // The cookie name and lifetime live in
  // lib/auth-server/recovery-cookie.ts: a "use server" file may
  // only export async functions, so the constants cannot live in
  // recovery.ts (the production build rejects them there).
  const cookie = readSource("lib/auth-server/recovery-cookie.ts");
  assert.match(cookie, /export const RECOVERY_COOKIE = "techshot-recovery";/);
  assert.match(cookie, /RECOVERY_COOKIE_MAX_AGE_SECONDS = 60 \* 60/);
  const recovery = readSource("lib/auth-server/recovery.ts");
  // Short-lived (one hour) and httpOnly, so browser JavaScript
  // cannot read or forge it.
  assert.match(recovery, /httpOnly: true,/);
  assert.match(recovery, /maxAge: RECOVERY_COOKIE_MAX_AGE_SECONDS,/);
  // The gate requires the marker and vetoes an ordinary session.
  assert.match(recovery, /if \(!hasMarker\(\)\) return false;/);
  assert.match(recovery, /if \(assurance === "not-recovery"\) return false;/);
  // Consuming deletes the marker: a second consume finds none.
  assert.match(recovery, /cookies\(\)\.delete\(RECOVERY_COOKIE\)/);

  const session = readSource("lib/auth-server/session.ts");
  assert.match(session, /export async function exchangeAuthCode\(code: string, type\?: string \| null\)/);
  assert.match(session, /if \(type === "recovery"\) \{[\s\S]*?await setRecoveryMarker\(\);/);
  // No other exchange type sets the marker.
  assert.equal((session.match(/setRecoveryMarker\(\)/g) ?? []).length, 1);

  const callback = readSource("app/auth/callback/page.tsx");
  assert.match(callback, /exchangeAuthCode\(code, type\)/);
  // Legacy implicit-flow recovery links get the same marker.
  assert.match(callback, /if \(isRecovery\) \{[\s\S]*?await setRecoveryMarker\(\)\.catch/);
  // The implicit branch must establish the session explicitly with
  // setSession(): the @supabase/ssr browser client defaults to PKCE
  // flow and never reads a #access_token fragment into a session on
  // its own, so a getSession()-only branch is dead and shows
  // "Sign-in did not complete" for every legacy recovery link.
  assert.match(
    callback,
    /setSession\(\{\s*access_token: params\.get\("access_token"\)/,
  );
  assert.doesNotMatch(callback, /auth\.getSession\(\)/);
});

test("#10 updatePasswordAfterReset consumes the marker before touching the password", () => {
  const auth = readSource("lib/auth.ts");
  assert.match(auth, /consumeRecoveryMarker\(\)/);
  const consumeAt = auth.indexOf("consumeRecoveryMarker()", auth.indexOf("updatePasswordAfterReset"));
  const updateAt = auth.indexOf(
    "updateUser({ password: parsed.data.password })",
  );
  assert.ok(consumeAt > -1 && updateAt > -1 && consumeAt < updateAt);
  // Without a marker the call refuses with the expired-link error.
  assert.match(auth, /if \(!marker\.ok\) \{\n\s*throw new Error\(\n\s*"This reset link has expired or was already used/);
  // changePassword still re-authenticates with the current password
  // first — it is the only path for an ordinary signed-in user.
  assert.match(auth, /signInWithPassword\(\{\n\s*email,\n\s*password: parsed\.data\.currentPassword,/);
});

test("#10 reset-password page gates on the server check, not on any session", () => {
  const page = readSource("app/auth/reset-password/page.tsx");
  assert.match(page, /hasRecoverySession\(\)/);
  assert.equal(page.includes('getSession'), false);
  assert.equal(page.includes("session !== null"), false);
  // The expired-link message still points at a fresh link, and a
  // signed-in visitor is pointed at change-password instead.
  assert.match(page, /has expired or was already used/);
  assert.match(page, /href="\/account#security"/);
  // A successful reset still signs the recovery session out.
  assert.match(page, /updatePasswordAfterReset/);
  assert.match(page, /signOut\(\)/);
  assert.match(page, /\/auth\/sign-in\?reset=1/);
});

test("#10 no other caller of updatePasswordAfterReset exists", () => {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) {
        const text = readFileSync(full, "utf8");
        // The call (or definition) carries the open paren; comment
        // mentions of the name elsewhere do not count as callers.
        if (text.includes("updatePasswordAfterReset(")) hits.push(full);
      }
    }
  };
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const dir of ["app", "lib", "components"]) walk(path.join(root, dir));
  // The definition in lib/auth.ts and the one call in the
  // reset-password page — nothing else may change a password
  // through the recovery path.
  assert.deepEqual(
    hits.map((h) => path.relative(root, h)).sort(),
    ["app/auth/reset-password/page.tsx", "lib/auth.ts"],
  );
});

test("#8/#9/#10 edited files use solid colours only, no gradients, no emoji", () => {
  for (const rel of [
    "app/checkout/confirmation/page.tsx",
    "app/orders/page.tsx",
    "app/account/page.tsx",
    "app/auth/reset-password/page.tsx",
    "app/auth/callback/page.tsx",
    "lib/checkout/storage.ts",
    "lib/account-rules.ts",
    "lib/auth.ts",
    "lib/auth-server/recovery.ts",
  ]) {
    const source = readSource(rel);
    assert.equal(/gradient/i.test(source), false, rel);
    assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(source), false, rel);
  }
});
