// Profile creation rule tests — TechShot.
//
// Bug fixed 2026-11-08: after sign-up with email confirmation on,
// signUp returns no session, so the old ensureProfile (which
// required a session for the same user id) threw, signUp swallowed
// the error, and no profiles row was ever created — the profiles
// table stayed empty and the user could not be made admin.
//
// The fix has three layers, all driven by lib/profile-rules.ts:
//   1. a database trigger (supabase/migrations/0002_profile_trigger.sql)
//      creates the row when the auth.users row is inserted;
//   2. ensureCurrentUserProfile() (lib/auth-server.ts) creates a
//      missing row on sign-in and on session load;
//   3. sign-up still tries ensureProfile immediately when a session
//      exists (confirmation off).
//
// The rules themselves live in lib/profile-rules.ts, a pure module
// with no imports. Node 24 strips the erasable TypeScript types in
// that file, so these tests import it directly — the rules tested
// here are the exact rules the server code runs, not a copy
// (same pattern as tests/catalog.test.mjs).
//
// The upsert semantics (insert only when missing, never overwrite)
// are tested against a small in-memory store that mirrors the
// server actions' `upsert(..., { onConflict: "id",
// ignoreDuplicates: true })` call: the TypeScript implementation
// MUST keep that call, or these tests stop describing reality.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildProfileRow,
  deriveDisplayName,
  deriveProfileFromMetadata,
  sanitizeProfileRole,
} from "../lib/profile-rules.ts";

const USER_ID = "00000000-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// Role rule: only "seller" survives; "admin" can never be assigned.
// ---------------------------------------------------------------------------

test("sanitizeProfileRole keeps seller, turns admin into customer", () => {
  assert.equal(sanitizeProfileRole("seller"), "seller");
  assert.equal(sanitizeProfileRole("customer"), "customer");
  assert.equal(sanitizeProfileRole("admin"), "customer");
  assert.equal(sanitizeProfileRole(undefined), "customer");
  assert.equal(sanitizeProfileRole(null), "customer");
  assert.equal(sanitizeProfileRole("ADMIN"), "customer");
});

// ---------------------------------------------------------------------------
// Display name rule: metadata first, email local part, then generic.
// ---------------------------------------------------------------------------

test("deriveDisplayName prefers user_metadata display_name", () => {
  assert.equal(
    deriveDisplayName({ display_name: "Md Joynal Abedin" }, "nothingbutwhy00@gmail.com"),
    "Md Joynal Abedin",
  );
});

test("deriveDisplayName falls back to the email local part", () => {
  assert.equal(deriveDisplayName({}, "nothingbutwhy00@gmail.com"), "nothingbutwhy00");
  assert.equal(deriveDisplayName(null, "md@example.com"), "md");
});

test("deriveDisplayName falls back to a generic name for short or missing names", () => {
  assert.equal(deriveDisplayName({}, "a@b.com"), "TechShot customer");
  assert.equal(deriveDisplayName({ display_name: "A" }, "a@b.com"), "TechShot customer");
  assert.equal(deriveDisplayName(null, null), "TechShot customer");
});

// ---------------------------------------------------------------------------
// Row building: validation and the never-admin rule.
// ---------------------------------------------------------------------------

test("buildProfileRow builds a valid row and sanitizes the role", () => {
  assert.deepEqual(buildProfileRow(USER_ID, "Md Joynal Abedin", "customer"), {
    id: USER_ID,
    display_name: "Md Joynal Abedin",
    role: "customer",
  });
  assert.deepEqual(buildProfileRow(USER_ID, "Shop Owner", "seller").role, "seller");
  assert.equal(buildProfileRow(USER_ID, "Shop Owner", "admin").role, "customer");
});

test("buildProfileRow throws on a missing user id or a too-short name", () => {
  assert.throws(() => buildProfileRow("", "Md Joynal Abedin", "customer"), /Could not create your profile/);
  assert.throws(() => buildProfileRow(USER_ID, "A", "customer"), /Could not create your profile/);
  assert.throws(() => buildProfileRow(USER_ID, "   ", "customer"), /Could not create your profile/);
});

// ---------------------------------------------------------------------------
// Sign-up without a session must not lose the profile.
// ---------------------------------------------------------------------------

test("sign-up without a session still yields a creatable profile row", () => {
  // This is exactly what signUp returns when email confirmation is
  // on: a user id, metadata and an email — but no session. The row
  // must be derivable from those three values alone, so the first
  // sign-in (or the database trigger) can create it.
  const row = deriveProfileFromMetadata(
    USER_ID,
    { display_name: "Md Joynal Abedin", role: "customer" },
    "nothingbutwhy00@gmail.com",
  );
  assert.deepEqual(row, {
    id: USER_ID,
    display_name: "Md Joynal Abedin",
    role: "customer",
  });

  // A seller sign-up keeps the seller role through the same path.
  const sellerRow = deriveProfileFromMetadata(
    USER_ID,
    { display_name: "Tech Seller", role: "seller" },
    "seller@example.com",
  );
  assert.equal(sellerRow.role, "seller");

  // Metadata that claims "admin" never produces an admin row.
  const attackerRow = deriveProfileFromMetadata(
    USER_ID,
    { display_name: "Attacker", role: "admin" },
    "attacker@example.com",
  );
  assert.equal(attackerRow.role, "customer");
});

// ---------------------------------------------------------------------------
// Sign-in creates a missing profile; an existing row is never touched.
// ---------------------------------------------------------------------------

// Mirrors the server actions' upsert(..., { onConflict: "id",
// ignoreDuplicates: true }): insert when the id is absent, do
// nothing when it is already there.
function upsertIgnoreDuplicates(store, row) {
  if (store.has(row.id)) return { created: false };
  store.set(row.id, { ...row });
  return { created: true };
}

// Mirrors ensureCurrentUserProfile(): derive the row from the
// signed-in user's own session metadata and upsert it.
function ensureProfileOnSignIn(store, userId, metadata, email) {
  const row = deriveProfileFromMetadata(userId, metadata, email);
  return upsertIgnoreDuplicates(store, row);
}

test("sign-in creates a missing profile from the session metadata", () => {
  const store = new Map();
  const result = ensureProfileOnSignIn(
    store,
    USER_ID,
    { display_name: "Md Joynal Abedin", role: "customer" },
    "nothingbutwhy00@gmail.com",
  );
  assert.equal(result.created, true);
  assert.deepEqual(store.get(USER_ID), {
    id: USER_ID,
    display_name: "Md Joynal Abedin",
    role: "customer",
  });
});

test("sign-in does not overwrite an existing profile — an admin is never downgraded", () => {
  const store = new Map([
    [USER_ID, { id: USER_ID, display_name: "Md Joynal Abedin", role: "admin" }],
  ]);
  // The user was made admin manually in the database after sign-up.
  // Signing in again must not touch that row, even though the
  // session metadata still says "customer".
  const result = ensureProfileOnSignIn(
    store,
    USER_ID,
    { display_name: "Md Joynal Abedin", role: "customer" },
    "nothingbutwhy00@gmail.com",
  );
  assert.equal(result.created, false);
  assert.deepEqual(store.get(USER_ID), {
    id: USER_ID,
    display_name: "Md Joynal Abedin",
    role: "admin",
  });
});

test("a second sign-in is a no-op once the profile exists", () => {
  const store = new Map();
  ensureProfileOnSignIn(store, USER_ID, { display_name: "Md Joynal Abedin" }, "md@example.com");
  const result = ensureProfileOnSignIn(store, USER_ID, { display_name: "Changed Name" }, "md@example.com");
  assert.equal(result.created, false);
  assert.equal(store.get(USER_ID).display_name, "Md Joynal Abedin");
  assert.equal(store.size, 1);
});

// ---------------------------------------------------------------------------
// Migration 0002: the database safety net must exist and be safe.
// ---------------------------------------------------------------------------

const migration0002 = readFileSync(
  new URL("../supabase/migrations/0002_profile_trigger.sql", import.meta.url),
  "utf8",
);

test("migration 0002 creates a trigger on auth.users insert", () => {
  assert.match(migration0002, /create trigger on_auth_user_created/i);
  assert.match(migration0002, /after insert on auth\.users/i);
  assert.match(migration0002, /execute function public\.handle_new_user\(\)/i);
});

test("migration 0002 trigger is security definer and never assigns admin", () => {
  assert.match(migration0002, /security definer/i);
  assert.match(migration0002, /on conflict \(id\) do nothing/i);
  // No *executable* statement in the file ever sets role to 'admin':
  // strip the -- comments first, because the header documents the
  // manual admin SQL the user runs themselves in the SQL Editor.
  const executable = migration0002
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.equal(/role\s*=\s*'admin'/i.test(executable), false);
  assert.match(executable, /'seller'.*'customer'/s);
});

test("migration 0002 backfills profiles for pre-existing auth users", () => {
  assert.match(migration0002, /insert into public\.profiles[\s\S]*from auth\.users/i);
  assert.match(migration0002, /on conflict \(id\) do nothing/i);
});
