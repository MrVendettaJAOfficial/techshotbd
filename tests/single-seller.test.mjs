// Single-seller store tests — TechShot.
//
// TechShot has one seller: the owner, who manages products in /admin.
// There are no seller accounts, no seller sign-up, no /seller route
// and no seller approval flow (removed 2026-11-08). These tests pin
// that down from both directions:
//   - the rules: a "seller" role value is rejected / sanitized to
//     "customer" wherever a role can enter the app;
//   - the surface: the seller route, dashboard, component, links and
//     approval helpers are gone from the source tree.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { buildProfileRow, sanitizeProfileRole } from "../lib/profile-rules.ts";

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

function stripComments(source) {
  // TS/TSX use // comments and /* */ block comments (including
  // JSDoc); SQL uses -- comments. A mention of a role inside a
  // comment is not a role value in the code, so all three are
  // stripped before any "seller" literal check.
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("--"))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Role rules: "seller" is rejected / sanitized to "customer" everywhere.
// ---------------------------------------------------------------------------

test("sanitizeProfileRole turns seller into customer", () => {
  assert.equal(sanitizeProfileRole("seller"), "customer");
  assert.equal(buildProfileRow("00000000-0000-0000-0000-000000000001", "Shop Owner", "seller").role, "customer");
});

test("sign-up schema only accepts role customer (lib/auth.ts)", () => {
  const auth = read("lib/auth.ts");
  assert.match(auth, /role:\s*z\.literal\("customer"\)/);
  assert.equal(/z\.enum\(\["customer",\s*"seller"\]\)/.test(auth), false);
  assert.equal(/"seller"/.test(stripComments(auth)), false);
  assert.equal(/getSellerVerified|addSellerApproval/.test(auth), false);
});

test("auth-server only ever creates customer profiles, no seller verification", () => {
  const server = read("lib/auth-server.ts");
  assert.equal(/getSellerVerified/.test(server), false);
  assert.equal(/"seller"/.test(stripComments(server)), false);
  assert.match(server, /role:\s*"customer"/);
  // The one role write in this file is the Owner-only changeUserRole
  // added with the roles build (migration 0006); it may assign only
  // the four real roles, never "seller".
  assert.match(server, /const ASSIGNABLE_ROLES = \["customer", "co_admin", "manager", "admin"\]/);
  assert.equal(/"seller"/.test(server.match(/ASSIGNABLE_ROLES = \[[^\]]*\]/)?.[0] ?? ""), false);
});

test("profile trigger migration only ever creates customer (executable SQL)", () => {
  const migration = read("supabase/migrations/0002_profile_trigger.sql");
  const executable = stripComments(migration);
  assert.equal(/'seller'/.test(executable), false);
  assert.match(executable, /v_role := 'customer'/);
});

// ---------------------------------------------------------------------------
// The seller surface is gone: route, dashboard, component, links.
// ---------------------------------------------------------------------------

test("/seller route and SellerProductsSection are deleted", () => {
  assert.equal(existsSync(new URL("../app/seller", import.meta.url)), false);
  assert.equal(existsSync(new URL("../app/seller/page.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../components/SellerProductsSection.tsx", import.meta.url)), false);
});

test("middleware guards /admin only, not /seller", () => {
  const middleware = read("middleware.ts");
  assert.match(middleware, /matcher:\s*\["\/admin\/:path\*"\]/);
  assert.equal(/\/seller/.test(stripComments(middleware)), false);
});

test("sign-up page offers no seller role", () => {
  const page = read("app/auth/sign-up/page.tsx");
  assert.equal(/value="seller"/.test(page), false);
  assert.equal(/>Seller</.test(page), false);
  assert.match(page, /role:\s*z\.literal\("customer"\)/);
});

test("no seller links in header, footer or auth pages", () => {
  for (const rel of ["components/Header.tsx", "components/Footer.tsx", "app/auth/sign-up/page.tsx", "app/auth/sign-in/page.tsx"]) {
    const source = read(rel);
    assert.equal(/\/seller/.test(source), false, `${rel} still links to /seller`);
    assert.equal(/Sell on TechShot/.test(source), false, `${rel} still has seller copy`);
  }
});

test("product actions require staff roles and never mention a seller", () => {
  const actions = read("lib/products/actions.ts");
  // The Owner-only requireAdmin gate became the staff gate with the
  // roles build (migration 0006): create / delete / upload is any
  // staff role, edit / pause is owner and co-admin only, enforced
  // through lib/roles.ts — never a seller check.
  assert.match(actions, /async function requireStaff/);
  assert.match(actions, /canManageProducts\(role\)/);
  assert.match(actions, /canEditProducts\(role\)/);
  assert.equal(/requireSellerOrAdmin|getSellerVerified|mayPublish/.test(actions), false);
  assert.equal(/"seller"/.test(stripComments(actions)), false);
  assert.match(actions, /seller_id: null/);
});

test("product queries have no seller fetch; demo store has no seller helpers", () => {
  assert.equal(/fetchSellerProducts/.test(read("lib/products/queries.ts")), false);
  const demo = read("lib/demo-store.ts");
  assert.equal(/SellerApproval|SellerProductsOverride|getSellerApprovals|addSellerApproval|decideSellerApproval/.test(demo), false);
  const admin = read("app/admin/AdminDashboard.tsx");
  assert.equal(/SellerApproval|getSellerApprovals|decideSellerApproval|Seller approvals/.test(admin), false);
});

test("account page and admin users list show no seller role", () => {
  const account = read("app/account/page.tsx");
  assert.equal(/"seller"/.test(stripComments(account)), false);
  assert.match(account, /role === "admin" \? "Admin" : "Customer"/);
  const admin = read("app/admin/AdminDashboard.tsx");
  assert.equal(/account\.role === "seller"/.test(admin), false);
});

test("README states single-seller and documents the legacy table", () => {
  const readme = read("README.md");
  assert.match(readme, /Single-seller store/);
  assert.match(readme, /no `\/seller` route/);
  assert.match(readme, /Legacy, kept in the database/);
  assert.match(readme, /seller_profiles/);
  assert.equal(/in `\/seller` \(your own products\)/.test(readme), false);
});
