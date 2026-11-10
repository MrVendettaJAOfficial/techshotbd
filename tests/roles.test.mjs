// Staff role tests — TechShot.
//
// These tests import the REAL module (lib/roles.ts) through the
// loader registered by tests/register-ts-loader.mjs (see
// package.json "test"); Node 24 strips the erasable TypeScript
// types, so the rules tested here are the exact rules the server
// actions enforce — not a stub copy.
//
// What is proven here:
//   - isOwner / isCoAdmin / isManager / isStaff identify exactly
//     the roles they name, and treat null / undefined / unknown
//     values (including the legacy "seller") as non-staff;
//   - create / delete is owner, co-admin and manager;
//   - edit / pause is owner, co-admin AND manager (2026-11-10
//     decision: managers CAN edit products, including pausing);
//   - order changes are owner and co-admin ONLY — a manager may not
//     change orders;
//   - broadcasts are owner and co-admin ONLY — a manager may not
//     send them;
//   - user management is the Owner only;
//   - roleLabel returns the display label for every known role and
//     "Customer" for anything else.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";

import {
  canChangeOrders,
  canEditProducts,
  canManageProducts,
  canManageUsers,
  canSendBroadcasts,
  isCoAdmin,
  isManager,
  isOwner,
  isStaff,
  roleLabel,
} from "../lib/roles.ts";

test("isOwner / isCoAdmin / isManager identify exactly their own role", () => {
  assert.equal(isOwner("admin"), true);
  assert.equal(isOwner("co_admin"), false);
  assert.equal(isOwner("manager"), false);
  assert.equal(isCoAdmin("co_admin"), true);
  assert.equal(isCoAdmin("admin"), false);
  assert.equal(isManager("manager"), true);
  assert.equal(isManager("admin"), false);
});

test("role helpers tolerate null, undefined and unknown values as customer", () => {
  for (const role of [null, undefined, "", "customer", "seller", "superadmin"]) {
    assert.equal(isOwner(role), false, String(role));
    assert.equal(isCoAdmin(role), false, String(role));
    assert.equal(isManager(role), false, String(role));
    assert.equal(isStaff(role), false, String(role));
    assert.equal(canManageProducts(role), false, String(role));
    assert.equal(canEditProducts(role), false, String(role));
    assert.equal(canChangeOrders(role), false, String(role));
    assert.equal(canManageUsers(role), false, String(role));
  }
});

test("isStaff is owner, co-admin and manager", () => {
  assert.equal(isStaff("admin"), true);
  assert.equal(isStaff("co_admin"), true);
  assert.equal(isStaff("manager"), true);
  assert.equal(isStaff("customer"), false);
});

test("create / delete products: owner, co-admin and manager", () => {
  assert.equal(canManageProducts("admin"), true);
  assert.equal(canManageProducts("co_admin"), true);
  assert.equal(canManageProducts("manager"), true);
  assert.equal(canManageProducts("customer"), false);
});

test("edit / pause products: owner, co-admin AND manager (2026-11-10)", () => {
  assert.equal(canEditProducts("admin"), true);
  assert.equal(canEditProducts("co_admin"), true);
  assert.equal(canEditProducts("manager"), true);
  assert.equal(canEditProducts("customer"), false);
});

test("manager still cannot change orders, send broadcasts or manage users", () => {
  assert.equal(canChangeOrders("manager"), false);
  assert.equal(canSendBroadcasts("manager"), false);
  assert.equal(canManageUsers("manager"), false);
});

test("change orders: owner and co-admin only, never a manager", () => {
  assert.equal(canChangeOrders("admin"), true);
  assert.equal(canChangeOrders("co_admin"), true);
  assert.equal(canChangeOrders("manager"), false);
  assert.equal(canChangeOrders("customer"), false);
});

test("manage users: the Owner only", () => {
  assert.equal(canManageUsers("admin"), true);
  assert.equal(canManageUsers("co_admin"), false);
  assert.equal(canManageUsers("manager"), false);
  assert.equal(canManageUsers("customer"), false);
});

test("roleLabel returns the display label for every role", () => {
  assert.equal(roleLabel("admin"), "Owner");
  assert.equal(roleLabel("co_admin"), "Co-admin");
  assert.equal(roleLabel("manager"), "Manager");
  assert.equal(roleLabel("customer"), "Customer");
  assert.equal(roleLabel("seller"), "Seller");
  assert.equal(roleLabel(null), "Customer");
  assert.equal(roleLabel(undefined), "Customer");
  assert.equal(roleLabel("superadmin"), "Customer");
});

// ---------------------------------------------------------------------------
// Verification fixes (2026-11-09): the staff self-profile regression
// and the staff orders listing gate.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

test("migration 0006 lets staff edit their own profile without self-promotion", () => {
  // The self-update policy used to require role = 'customer', so a
  // co_admin / manager could no longer update their own
  // display_name / phone. The policy now only requires the row to
  // stay the caller's own, and a BEFORE UPDATE trigger stops anyone
  // except the Owner changing a role value — a policy alone cannot
  // compare the old role with the new one. Both files must agree:
  // migration 0006 and the fresh-install mirror (policies.sql).
  for (const file of ["supabase/migrations/0006_roles.sql", "supabase/policies.sql"]) {
    const sql = read(file);
    assert.match(sql, /create or replace function public\.prevent_non_owner_role_change\(\)/);
    assert.match(sql, /old\.role is distinct from new\.role/);
    assert.match(sql, /old\.id = auth\.uid\(\)/);
    assert.match(sql, /not public\.is_admin\(\)/);
    assert.match(sql, /create trigger profiles_prevent_role_change/);
    assert.match(sql, /before update on public\.profiles/);
  }
  const migration = read("supabase/migrations/0006_roles.sql");
  const updateOwn = migration.slice(
    migration.indexOf('create policy "profiles_update_own"'),
    migration.indexOf("create or replace function public.prevent_non_owner_role_change()"),
  );
  assert.match(updateOwn, /with check \(id = auth\.uid\(\)\);/);
  assert.equal(/role = 'customer'/.test(updateOwn), false);
  // Insert is still customer-only: new sign-ups can never
  // self-promote at creation time.
  assert.match(migration, /with check \(id = auth\.uid\(\) and role = 'customer'\)/);
});

test("staff order listing admits every staff role, not just the Owner", () => {
  // listAdminOrders used to return [] unless the caller was role
  // "admin", so a co-admin or manager saw an empty Orders tab in
  // /admin. The change gate (owner / co-admin only) lives in
  // lib/orders/actions.ts; this listing is the read side, so any
  // staff role may use it.
  // listAdminOrders now lives in lib/orders/server/list.ts (cleanup
  // split of lib/orders-server.ts).
  const server = read("lib/orders/server/list.ts");
  assert.match(server, /if \(!isStaff\(caller\?\.role\)\) return \[\];/);
  assert.equal(/if \(caller\?\.role !== "admin"\) return \[\];/.test(server), false);
});

// ---------------------------------------------------------------------------
// Manager edit (2026-11-10): migration 0010 widens products UPDATE
// from owner/co-admin only to all staff. Migration 0006 is applied
// live and is NEVER edited in place — it still carries the old
// co_admin-only policy, and 0010 replaces it.
// ---------------------------------------------------------------------------

test("migration 0010 widens products UPDATE to all staff, mirrored in policies.sql", () => {
  // 0006 is untouched: it still defines the old co_admin-only
  // policy (the live database still has it until 0010 is applied).
  const old = read("supabase/migrations/0006_roles.sql");
  assert.match(old, /create policy "products_co_admin_update" on public\.products/);
  assert.match(old, /using \(public\.is_co_admin\(\)\)/);

  // 0010 drops the old policy and creates the staff-wide one.
  const migration = read("supabase/migrations/0010_manager_product_update.sql");
  assert.match(migration, /drop policy if exists "products_co_admin_update" on public\.products;/);
  assert.match(migration, /create policy "products_staff_update" on public\.products/);
  assert.match(migration, /using \(public\.is_staff\(\)\)/);
  assert.match(migration, /with check \(public\.is_staff\(\)\);/);
  // No other table is touched: no orders policy is created here.
  assert.equal(/on public\.orders/.test(migration), false);
  assert.equal(/on public\.profiles/.test(migration), false);
  assert.equal(/on public\.announcements/.test(migration), false);

  // The fresh-install mirror agrees: policies.sql has the staff
  // update policy and no co_admin update policy left on products.
  const policies = read("supabase/policies.sql");
  assert.match(policies, /create policy "products_staff_update" on public\.products/);
  assert.match(policies, /using \(public\.is_staff\(\)\)/);
  const productsSection = policies.slice(
    policies.indexOf('drop policy if exists "products_staff_insert"'),
    policies.indexOf("-- ===========================================================================\n-- product_images"),
  );
  assert.equal(/create policy "products_co_admin_update"/.test(productsSection), false);
  // Orders are unchanged in the mirror: still co_admin-only update.
  assert.match(policies, /create policy "orders_co_admin_update" on public\.orders/);
});

test("product server-action edit gate admits managers, and the UI shows them Edit / Pause", () => {
  // The gate itself is one line in shared.ts and delegates to
  // canEditProducts, which now admits every staff role — so the
  // "edit" action (updateProduct + setProductStatus) is open to
  // managers without any gate change. Pin the delegation, not a copy.
  const shared = read("lib/products/actions/shared.ts");
  assert.match(shared, /action === "edit" \? canEditProducts\(role\) : canManageProducts\(role\)/);
  // The product list no longer hides Edit / Pause from managers.
  const list = read("components/product-manager/product-list.tsx");
  assert.equal(/hidden for that role/.test(list), false);
  assert.match(list, /const canEdit = canEditProducts\(callerRole\);/);
});
