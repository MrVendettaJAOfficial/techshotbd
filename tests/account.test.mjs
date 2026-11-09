// Account dashboard rule tests — TechShot.
//
// Bug fixed 2026-11-08 (bug 3): after sign-in the user saw no success
// message and /account showed only browser-local data — no name /
// email / role from Supabase, no Supabase orders, and no sign-out
// button — because the page read lib/checkout-store (localStorage)
// and never asked Supabase for the signed-in user's profile,
// addresses, orders or wishlist.
//
// The fix: sign-in / sign-up / email-confirmation all land on
// /account?signed_in=1 and the page shows a visible "Signed in
// successfully" banner; /account reads the profile, addresses,
// orders and wishlist from Supabase when configured
// (lib/account-server.ts getAccountData) and keeps the localStorage
// data only as the fallback. The pure mapping / merge / validation
// rules live in lib/account-rules.ts (no imports), so these tests
// import the real module directly — the same pattern as
// tests/profile.test.mjs.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isValidBangladeshiMobile,
  mapDbAddressToLocal,
  mapDbWishlistRowToLocal,
  mapLocalAddressToDb,
  mergeOrders,
  splitDbName,
  splitFullAddress,
  validateAddressInput,
} from "../lib/account-rules.ts";

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

// ---------------------------------------------------------------------------
// DB address <-> browser address mapping (round-trip).
// ---------------------------------------------------------------------------

const DB_ADDRESS = {
  id: "addr-1",
  name: "Md Joynal Abedin",
  phone: "01712345678",
  division: "Chattogram",
  district: "Chattogram",
  city: "Chattogram",
  full_address: "House 1, Road 2, Dhanmondi",
  is_default: true,
};

test("splitDbName splits on the first space", () => {
  assert.deepEqual(splitDbName("Md Joynal Abedin"), {
    firstName: "Md",
    lastName: "Joynal Abedin",
  });
  assert.deepEqual(splitDbName("Ayesha"), { firstName: "Ayesha", lastName: "" });
});

test("splitFullAddress splits on the LAST comma, so commas in the street survive", () => {
  assert.deepEqual(splitFullAddress("House 1, Road 2, Dhanmondi"), {
    address: "House 1, Road 2",
    area: "Dhanmondi",
  });
  assert.deepEqual(splitFullAddress("House 1"), { address: "House 1", area: "" });
});

test("mapDbAddressToLocal maps a Supabase addresses row", () => {
  assert.deepEqual(mapDbAddressToLocal(DB_ADDRESS), {
    id: "addr-1",
    firstName: "Md",
    lastName: "Joynal Abedin",
    email: "",
    mobile: "01712345678",
    address: "House 1, Road 2",
    area: "Dhanmondi",
    division: "Chattogram",
    district: "Chattogram",
    city: "Chattogram",
    isDefault: true,
  });
});

test("mapLocalAddressToDb joins name and street + area", () => {
  assert.deepEqual(
    mapLocalAddressToDb({
      firstName: "Md",
      lastName: "Joynal Abedin",
      mobile: "01712345678",
      address: "House 1, Road 2",
      area: "Dhanmondi",
      division: "Chattogram",
      district: "Chattogram",
      city: "Chattogram",
      isDefault: false,
    }),
    {
      name: "Md Joynal Abedin",
      phone: "01712345678",
      division: "Chattogram",
      district: "Chattogram",
      city: "Chattogram",
      full_address: "House 1, Road 2, Dhanmondi",
      is_default: false,
    },
  );
});

test("address mapping round-trips through the database shape", () => {
  const local = mapDbAddressToLocal(DB_ADDRESS);
  const back = mapLocalAddressToDb({ ...local, isDefault: true });
  assert.equal(back.name, DB_ADDRESS.name);
  assert.equal(back.full_address, DB_ADDRESS.full_address);
  assert.equal(back.phone, DB_ADDRESS.phone);
});

// ---------------------------------------------------------------------------
// Wishlist mapping.
// ---------------------------------------------------------------------------

test("mapDbWishlistRowToLocal maps the products embed, drops deleted products", () => {
  assert.deepEqual(
    mapDbWishlistRowToLocal({
      product_id: "prod-1",
      products: {
        title: "Apple iPhone 16 Pro",
        slug: "apple-iphone-16-pro",
        price_poisha: 11990000,
        compare_at_poisha: 12990000,
      },
    }),
    {
      productId: "apple-iphone-16-pro",
      title: "Apple iPhone 16 Pro",
      price_poisha: 11990000,
      mrp_poisha: 12990000,
    },
  );
  assert.equal(
    mapDbWishlistRowToLocal({ product_id: "prod-gone", products: null }),
    null,
  );
});

// ---------------------------------------------------------------------------
// Order merge: Supabase copy wins, local copy is the fallback.
// ---------------------------------------------------------------------------

const LOCAL_ORDER = {
  id: "order-1",
  orderNumber: "TS-20261108-0001",
  status: "pending_payment",
  total_poisha: 11990000,
  createdAt: "2026-11-08T10:00:00.000Z",
};
const LOCAL_ONLY_ORDER = {
  id: "order-2",
  orderNumber: "TS-20261108-0002",
  status: "confirmed",
  total_poisha: 549000,
  createdAt: "2026-11-08T09:00:00.000Z",
};

test("mergeOrders de-duplicates by id and the Supabase copy wins", () => {
  const remote = [{ ...LOCAL_ORDER, status: "confirmed" }];
  const merged = mergeOrders([LOCAL_ORDER, LOCAL_ONLY_ORDER], remote);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((o) => o.id === "order-1").status, "confirmed");
  // The local-only (guest / unconfigured) order is never dropped.
  assert.equal(merged.find((o) => o.id === "order-2").status, "confirmed");
});

test("mergeOrders is newest first", () => {
  const merged = mergeOrders([LOCAL_ONLY_ORDER], [LOCAL_ORDER]);
  assert.equal(merged[0].id, "order-1");
  assert.equal(merged[1].id, "order-2");
});

// ---------------------------------------------------------------------------
// Address validation + mobile rule.
// ---------------------------------------------------------------------------

const VALID_ADDRESS = {
  firstName: "Md",
  lastName: "Joynal Abedin",
  email: "md@example.com",
  mobile: "01712345678",
  address: "House 1, Road 2",
  area: "Dhanmondi",
  division: "Dhaka",
  district: "Dhaka",
  city: "Dhaka",
};

test("isValidBangladeshiMobile accepts 01XXXXXXXXX and +880", () => {
  assert.equal(isValidBangladeshiMobile("01712345678"), true);
  assert.equal(isValidBangladeshiMobile("+8801712345678"), true);
  // Bare "880…" without the + is not accepted by the app's rule.
  assert.equal(isValidBangladeshiMobile("8801712345678"), false);
  assert.equal(isValidBangladeshiMobile("01212345678"), false);
  assert.equal(isValidBangladeshiMobile("0171234567"), false);
  assert.equal(isValidBangladeshiMobile(""), false);
});

test("validateAddressInput passes a valid address and flags a bad one", () => {
  assert.deepEqual(validateAddressInput(VALID_ADDRESS), {});
  const errors = validateAddressInput({ ...VALID_ADDRESS, mobile: "123", division: "" });
  assert.equal(errors.mobile, "Enter a valid Bangladeshi mobile number, e.g. 01XXXXXXXXX.");
  assert.equal(errors.division, "Division is required.");
  assert.equal(validateAddressInput({ ...VALID_ADDRESS, firstName: " " }).firstName, "First name is required.");
});

// ---------------------------------------------------------------------------
// Wiring: the sign-in success message, the dashboard, and profile
// creation on every auth path. These read the real source files, the
// same way tests/profile.test.mjs asserts on migration 0002.
// ---------------------------------------------------------------------------

const accountPage = [
  "../app/account/page.tsx",
  "../components/account/profile-section.tsx",
  "../components/account/addresses-section.tsx",
  "../components/account/orders-section.tsx",
  "../components/account/wishlist-section.tsx",
]
  .map((path) => readSource(path))
  .join("\n");
const signInPage = readSource("../app/auth/sign-in/page.tsx");
const signUpPage = readSource("../app/auth/sign-up/page.tsx");
const callbackPage = readSource("../app/auth/callback/page.tsx");
// lib/auth-server.ts is now a re-export barrel: the code lives in
// lib/auth-server/{session, profile, admin-users}.ts. Read the three
// modules together so these assertions still cover the whole module.
const authServer = ["session", "profile", "admin-users"]
  .map((part) => readSource(`../lib/auth-server/${part}.ts`))
  .join("\n");
const authClient = readSource("../lib/auth.ts");
const accountServer = readSource("../lib/account-server.ts");

test("sign-in, sign-up and email confirmation all land on /account with the success flag", () => {
  assert.match(signInPage, /router\.push\("\/account\?signed_in=1"\)/);
  assert.match(signUpPage, /router\.push\("\/account\?signed_in=1"\)/);
  // The callback routes through getAuthCallbackDestination (recovery
  // links go to /auth/reset-password instead); non-recovery links
  // still land on /account?signed_in=1 — the destination rule is
  // pinned in tests/password-reset.test.mjs.
  assert.match(callbackPage, /getAuthCallbackDestination\(type\)/);
});

test("/account shows the signed-in success banner, name/email/role, orders, wishlist and sign-out", () => {
  assert.match(accountPage, /Signed in successfully/);
  assert.match(accountPage, /role="status"/);
  assert.match(accountPage, /Role:/);
  assert.match(accountPage, /Order history/);
  assert.match(accountPage, /aria-label="Wishlist"/);
  assert.match(accountPage, /aria-label="Addresses"/);
  assert.match(accountPage, /Sign out/);
  assert.match(accountPage, /getAccountData/);
});

test("/account reads Supabase data when configured and falls back to local data otherwise", () => {
  assert.match(accountServer, /getAccountData/);
  assert.match(accountServer, /listSupabaseOrders/);
  assert.match(accountServer, /from\("addresses"\)/);
  assert.match(accountServer, /from\("wishlists"\)/);
  // No service-role client in the account reads: RLS (owner-only
  // policies) is the boundary, so the per-request client is used.
  assert.equal(/createAdminClient/.test(accountServer), false);
});

test("getAccountData self-heals a missing profile instead of rendering an empty dashboard", () => {
  assert.match(accountServer, /ensureCurrentUserProfile\(\)/);
});

test("auth-code exchange creates the missing profile (never overwrites, never downgrades an admin)", () => {
  // exchangeAuthCode runs after exchangeCodeForSession — a session
  // exists by then, so ensureProfile's session check passes and the
  // row is created on confirmation as well as on sign-up/sign-in.
  assert.match(authServer, /exchangeAuthCode/);
  assert.match(authServer, /await ensureProfile\(data\.user\.id, row\.display_name, row\.role\)/);
  assert.match(authServer, /upsert\(row, \{ onConflict: "id", ignoreDuplicates: true \}\)/);
  // Sign-in still creates a missing profile from the session.
  assert.match(authClient, /await ensureCurrentUserProfile\(\)/);
});

test("sign-up and sign-in never downgrade an admin in any code path", () => {
  // Every profile write on the sign-up / sign-in paths goes through
  // the insert-only upsert in ensureProfile: no .update() call
  // exists there, so an existing admin row is never overwritten.
  // The ONE role update in this file is changeUserRole, the
  // Owner-only role assignment added with the roles build
  // (migration 0006): it refuses non-owners and self-changes, and
  // it is the only place a profiles role may be written.
  const ensure = authServer.slice(
    authServer.indexOf("export async function ensureProfile"),
    authServer.indexOf("export async function ensureCurrentUserProfile"),
  );
  assert.ok(ensure.length > 0, "ensureProfile found");
  assert.equal(/\.update\(/.test(ensure), false);
  assert.match(ensure, /upsert\(row, \{ onConflict: "id", ignoreDuplicates: true \}\)/);
  const roleUpdates = [...authServer.matchAll(/\.update\(\{\s*role[^}]*\}\)/g)];
  assert.equal(roleUpdates.length, 1, "exactly one role update exists (changeUserRole)");
  assert.match(authServer, /export async function changeUserRole/);
  assert.match(authServer, /canManageUsers\(caller\.role\)/);
  assert.match(authServer, /You cannot change your own role/);
});
