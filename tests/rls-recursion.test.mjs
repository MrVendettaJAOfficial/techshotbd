// Live-test regression tests — TechShot (first live Supabase test, 2026-11-08).
//
// Bug found live: any SELECT on public.orders as an authenticated
// customer failed with "infinite recursion detected in policy for
// relation orders", so /orders in a fresh browser showed "No orders
// yet" and /account showed no live orders, even though the orders
// existed. Checkout, /admin and first-browser order pages worked
// because they read through the service-role client (RLS bypass) or
// the browser copy — they never hit the recursive policy path.
//
// Root cause: orders_select_seller (on orders) read public.order_items
// while order_items_select_buyer (on order_items) reads public.orders.
// Fix (migration 0004): drop orders_select_seller — sellers were
// removed when the store went single-seller, so the policy was legacy.
//
// These tests pin the fix at the source level (the policies are SQL,
// so the cycle can only be caught by reading the policy file — there
// is no local Postgres here to evaluate them). The live behaviour
// (fresh-browser /orders listing the customer's orders) is covered by
// the live test run; re-run it after applying migration 0004.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policies = readFileSync(path.join(root, "supabase/policies.sql"), "utf8");
const migration0004 = path.join(root, "supabase/migrations/0004_drop_seller_order_policy.sql");

// Split the policy file into its CREATE POLICY statements so a
// reference can be attributed to the table the policy guards.
function policiesOn(table) {
  const statements = policies.split(/create policy/i).slice(1);
  return statements
    .filter((s) => new RegExp(`^\\s*"[^"]+"\\s+on\\s+public\\.${table}\\b`, "i").test(s))
    .map((s) => s.slice(0, s.indexOf(";")));
}

test("no policy on orders references order_items (recursion source)", () => {
  for (const stmt of policiesOn("orders")) {
    assert.doesNotMatch(
      stmt,
      /from\s+public\.order_items/i,
      `a policy on orders still reads order_items: ${stmt.slice(0, 120)}`,
    );
  }
});

test("no policy on order_items references orders while an orders policy references order_items", () => {
  // One-way references are safe; a cycle needs both directions.
  const ordersRefsItems = policiesOn("orders").some((s) => /from\s+public\.order_items/i.test(s));
  const itemsRefsOrders = policiesOn("order_items").some((s) => /from\s+public\.orders/i.test(s));
  assert.equal(
    ordersRefsItems && itemsRefsOrders,
    false,
    "orders and order_items policies reference each other — infinite recursion",
  );
  // The buyer path must survive: order_items_select_buyer still reads
  // orders (one-way), so buyers keep seeing their own items.
  assert.equal(itemsRefsOrders, true, "order_items_select_buyer must still read orders");
});

test("migration 0004 exists and drops orders_select_seller", () => {
  assert.equal(existsSync(migration0004), true, "0004 migration file is missing");
  const sql = readFileSync(migration0004, "utf8");
  assert.match(sql, /drop\s+policy\s+if\s+exists\s+"orders_select_seller"\s+on\s+public\.orders/i);
});

test("buyer order access is intact after the fix", () => {
  assert.match(policies, /create policy\s+"orders_select_own"/i);
  assert.match(policies, /create policy\s+"order_items_select_buyer"/i);
  assert.match(policies, /create policy\s+"orders_admin_all"/i);
});
