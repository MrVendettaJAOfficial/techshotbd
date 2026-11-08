// Order status transition tests — TechShot.
//
// These tests import the REAL module (lib/orders/transitions.ts)
// through the loader registered by tests/register-ts-loader.mjs
// (see package.json "test"); Node 24 strips the erasable TypeScript
// types, so the rules tested here are the exact rules the admin
// server actions in lib/orders/actions.ts enforce — not a stub copy.
//
// What is proven here:
//   - Advance moves exactly one step forward in the flow
//     pending_payment -> confirmed -> processing -> shipped ->
//     delivered, and stops at delivered;
//   - backwards jumps and skipped steps are rejected;
//   - cancel is allowed only from pending_payment / confirmed;
//   - refund is allowed only when the latest payment is paid, and
//     only from confirmed / processing / shipped / delivered;
//   - the admin gate rejects a missing role and any non-admin role.
//
// The server actions themselves (Supabase writes, audit rows,
// revalidation) are not runnable under `node --test` — they need a
// signed-in admin session and a database — so they are covered by
// the Playwright click-through in tests/e2e/ and by live testing
// against the TechshotBD project (see README).
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";

import {
  checkAdminRole,
  isLegalOrderTransition,
  nextOrderStatus,
} from "../lib/orders/transitions.ts";

test("advance moves one step forward through the whole flow", () => {
  assert.equal(nextOrderStatus("pending_payment"), "confirmed");
  assert.equal(nextOrderStatus("confirmed"), "processing");
  assert.equal(nextOrderStatus("processing"), "shipped");
  assert.equal(nextOrderStatus("shipped"), "delivered");
  assert.equal(nextOrderStatus("delivered"), null);
});

test("advance stops at terminal states", () => {
  assert.equal(nextOrderStatus("cancelled"), null);
  assert.equal(nextOrderStatus("refunded"), null);
});

test("backwards jumps and skipped steps are illegal", () => {
  assert.equal(isLegalOrderTransition("shipped", "processing"), false);
  assert.equal(isLegalOrderTransition("delivered", "shipped"), false);
  assert.equal(isLegalOrderTransition("confirmed", "shipped"), false);
  assert.equal(isLegalOrderTransition("pending_payment", "delivered"), false);
  assert.equal(isLegalOrderTransition("confirmed", "confirmed"), false);
});

test("one-step-forward moves are legal", () => {
  assert.equal(isLegalOrderTransition("pending_payment", "confirmed"), true);
  assert.equal(isLegalOrderTransition("confirmed", "processing"), true);
  assert.equal(isLegalOrderTransition("processing", "shipped"), true);
  assert.equal(isLegalOrderTransition("shipped", "delivered"), true);
});

test("cancel is allowed only from pending_payment or confirmed", () => {
  assert.equal(isLegalOrderTransition("pending_payment", "cancelled"), true);
  assert.equal(isLegalOrderTransition("confirmed", "cancelled"), true);
  assert.equal(isLegalOrderTransition("processing", "cancelled"), false);
  assert.equal(isLegalOrderTransition("shipped", "cancelled"), false);
  assert.equal(isLegalOrderTransition("delivered", "cancelled"), false);
});

test("refund requires a paid payment", () => {
  assert.equal(isLegalOrderTransition("confirmed", "refunded", "paid"), true);
  assert.equal(isLegalOrderTransition("processing", "refunded", "paid"), true);
  assert.equal(isLegalOrderTransition("shipped", "refunded", "paid"), true);
  assert.equal(isLegalOrderTransition("delivered", "refunded", "paid"), true);
  assert.equal(isLegalOrderTransition("confirmed", "refunded", "unpaid"), false);
  assert.equal(isLegalOrderTransition("confirmed", "refunded", "failed"), false);
  assert.equal(isLegalOrderTransition("confirmed", "refunded"), false);
  assert.equal(isLegalOrderTransition("pending_payment", "refunded", "paid"), false);
});

test("admin gate rejects missing and non-admin roles", () => {
  assert.equal(checkAdminRole(null).ok, false);
  assert.equal(checkAdminRole(undefined).ok, false);
  assert.equal(checkAdminRole("customer").ok, false);
  assert.equal(checkAdminRole("seller").ok, false);
  assert.equal(checkAdminRole("admin").ok, true);
});
