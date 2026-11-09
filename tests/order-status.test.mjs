// Order "returned" status tests — TechShot.
//
// These tests import the REAL module (lib/orders/transitions.ts)
// through the loader registered by tests/register-ts-loader.mjs
// (see package.json "test"); Node 24 strips the erasable TypeScript
// types, so the rules tested here are the exact rules the admin
// server actions in lib/orders/actions.ts enforce — not a stub copy.
//
// What is proven here:
//   - "returned" is a terminal exit, not a flow step: advance stops
//     at it, exactly as at cancelled / refunded;
//   - returned is allowed only from confirmed / processing / shipped
//     (the order was placed and not taken), with no payment
//     condition — an unpaid (e.g. COD) order can be returned too,
//     and the paid case refunds through the adapter first (that
//     adapter-first step lives in lib/orders/actions.ts and needs a
//     database, so it is covered by the live test, not here);
//   - returned is NOT allowed from delivered (they took it — that
//     is a refund) and NOT from pending_payment (nothing shipped
//     yet — cancel there instead), and never from another exit;
//   - the order-change gate admits owner and co-admin and rejects
//     managers (with an error, never a silent success), customers
//     and signed-out callers.
//
// The server actions themselves (Supabase writes, audit rows,
// stock restore, adapter refund, revalidation) are not runnable
// under `node --test` — they need a signed-in staff session and a
// database — so they are covered by the Playwright click-through in
// tests/e2e/ and by live testing against the TechshotBD project
// (see README).
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  checkOrderRole,
  isLegalOrderTransition,
  nextOrderStatus,
} from "../lib/orders/transitions.ts";

test("returned is a terminal exit: advance stops there", () => {
  assert.equal(nextOrderStatus("returned"), null);
  assert.equal(nextOrderStatus("cancelled"), null);
  assert.equal(nextOrderStatus("refunded"), null);
  assert.equal(nextOrderStatus("delivered"), null);
});

test("returned is allowed from confirmed, processing and shipped", () => {
  assert.equal(isLegalOrderTransition("confirmed", "returned"), true);
  assert.equal(isLegalOrderTransition("processing", "returned"), true);
  assert.equal(isLegalOrderTransition("shipped", "returned"), true);
});

test("returned has no payment condition: unpaid orders can be returned too", () => {
  assert.equal(isLegalOrderTransition("confirmed", "returned", "unpaid"), true);
  assert.equal(isLegalOrderTransition("shipped", "returned", "unpaid"), true);
  assert.equal(isLegalOrderTransition("processing", "returned", "paid"), true);
});

test("returned is NOT allowed from delivered or pending_payment", () => {
  assert.equal(isLegalOrderTransition("delivered", "returned", "paid"), false);
  assert.equal(isLegalOrderTransition("delivered", "returned", "unpaid"), false);
  assert.equal(isLegalOrderTransition("pending_payment", "returned"), false);
  assert.equal(isLegalOrderTransition("pending_payment", "returned", "paid"), false);
});

test("returned is NOT allowed from another exit, or to itself", () => {
  assert.equal(isLegalOrderTransition("cancelled", "returned"), false);
  assert.equal(isLegalOrderTransition("refunded", "returned"), false);
  assert.equal(isLegalOrderTransition("returned", "returned"), false);
  assert.equal(isLegalOrderTransition("returned", "confirmed"), false);
  assert.equal(isLegalOrderTransition("returned", "delivered"), false);
});

test("returned does not disturb the existing cancel / refund rules", () => {
  assert.equal(isLegalOrderTransition("confirmed", "cancelled"), true);
  assert.equal(isLegalOrderTransition("shipped", "cancelled"), false);
  assert.equal(isLegalOrderTransition("delivered", "refunded", "paid"), true);
  assert.equal(isLegalOrderTransition("delivered", "refunded", "unpaid"), false);
  assert.equal(isLegalOrderTransition("pending_payment", "refunded", "paid"), false);
});

test("order-change gate admits owner and co-admin, rejects managers", () => {
  assert.equal(checkOrderRole("admin").ok, true);
  assert.equal(checkOrderRole("co_admin").ok, true);
  assert.equal(checkOrderRole("manager").ok, false);
  assert.equal(checkOrderRole("customer").ok, false);
  assert.equal(checkOrderRole("seller").ok, false);
  assert.equal(checkOrderRole(null).ok, false);
  assert.equal(checkOrderRole(undefined).ok, false);
});

test("customer order page treats returned as a terminal state", () => {
  // The 5-step tracker on app/orders/[id] must not show a returned
  // order as mid-flow: returned is terminal, like cancelled and
  // refunded, with its own message (not the cancelled one).
  // app/orders/[id]/page.tsx is now the thin composition: the
  // presentational summary / timeline live in
  // components/order-detail/{summary, timeline}.tsx.
  const page = ["../app/orders/[id]/page.tsx", "../components/order-detail/summary.tsx", "../components/order-detail/timeline.tsx"]
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
    .join("\n");
  assert.match(page, /returned: "Returned"/);
  assert.match(
    page,
    /order\.status === "cancelled" \|\| order\.status === "refunded" \|\| order\.status === "returned"/,
  );
  assert.match(page, /order\.status === "returned"/);
  assert.match(page, /was not received, so its items are back in stock/);
});

test("getOrderStatusFromServer reads the database row before the in-memory record", () => {
  // The in-memory record is the checkout-time snapshot: admin moves
  // (advance, return, refund, cancel) write the database only, so
  // returning it first froze the customer order page at Confirmed
  // in the browser that placed the order, even though /orders (live
  // wins in the merge) already showed the new status. The database
  // row is now the source of truth; the in-memory record is only the
  // fallback for orders with no database row.
  // getOrderStatusFromServer now lives in lib/orders/server/status.ts
  // (cleanup split of lib/orders-server.ts); the function itself is
  // unchanged.
  const server = readFileSync(new URL("../lib/orders/server/status.ts", import.meta.url), "utf8");
  const fn = server.slice(server.indexOf("export async function getOrderStatusFromServer"));
  const dbFirst = fn.indexOf('.from("orders")');
  const memFallback = fn.indexOf("getOrderRecord(orderId)");
  assert.ok(dbFirst > 0 && memFallback > 0, "both sources present");
  assert.ok(dbFirst < memFallback, "database row is read before the in-memory record");
});

test("customer order page adopts forward and terminal server moves", () => {
  // The detail page used to reconcile only while the browser copy
  // was still pending payment, so an admin advance / return / refund
  // never showed in the browser that placed the order.
  // app/orders/[id]/page.tsx is now the thin composition: the
  // presentational summary / timeline live in
  // components/order-detail/{summary, timeline}.tsx.
  const page = ["../app/orders/[id]/page.tsx", "../components/order-detail/summary.tsx", "../components/order-detail/timeline.tsx"]
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
    .join("\n");
  assert.equal(page.includes('if (browserOrder && browserOrder.status === "pending_payment")'), false);
  assert.match(page, /const serverAhead = flow\.indexOf\(server\.status\) > flow\.indexOf\(browserOrder\.status\)/);
  assert.match(page, /const serverTerminal =/);
  assert.match(page, /terminal\.includes\(server\.status\) && !terminal\.includes\(browserOrder\.status\)/);
});
