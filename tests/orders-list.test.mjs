// /orders page list tests — TechShot.
//
// Bug fixed 2026-11-08: app/orders/page.tsx read orders only from the
// browser's localStorage (lib/checkout-store) and never from Supabase,
// so on a new device/browser it showed "No orders yet" even though the
// order existed in Supabase — while /account history did show it.
//
// The fix: the page now also calls listSupabaseOrders() (the same
// server action /account uses) and merges the result over the browser
// list with mergeOrders() from lib/account-rules.ts. The merge rules
// are pure, so these tests import the real module directly — the same
// pattern as tests/account.test.mjs. The page-level behaviour (fresh
// browser profile listing a live order) is covered by the Playwright
// check in tests/e2e/smoke.mjs, not here.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mergeOrders } from "../lib/account-rules.ts";

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

// The order as stored in Supabase (via listSupabaseOrders) and the
// browser copy saved at checkout share the same id: checkout registers
// the Supabase order id in the browser store (see
// app/checkout/page.tsx placeOrderAction -> createOrderRecord), so
// de-duplication by id is what makes the merge correct.
const LIVE_ORDER = {
  id: "uuid-live-1",
  orderNumber: "TS-20261108-1001",
  status: "processing",
  total_poisha: 11990000,
  createdAt: "2026-11-08T10:00:00.000Z",
};

const GUEST_ORDER = {
  id: "order_guest_1",
  orderNumber: "TS-20261108-1002",
  status: "confirmed",
  total_poisha: 549000,
  createdAt: "2026-11-08T09:00:00.000Z",
};

test("fresh browser: a live-only order is listed (no local orders)", () => {
  const merged = mergeOrders([], [LIVE_ORDER]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "uuid-live-1");
  assert.equal(merged[0].status, "processing");
});

test("guest / unconfigured: local orders are kept when there is no live list", () => {
  const merged = mergeOrders([GUEST_ORDER], []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "order_guest_1");
});

test("same order in both places is shown once, live copy wins", () => {
  const staleLocal = { ...LIVE_ORDER, status: "pending_payment" };
  const merged = mergeOrders([staleLocal], [LIVE_ORDER]);
  assert.equal(merged.length, 1);
  // The Supabase status (advanced in /admin) is the one shown.
  assert.equal(merged[0].status, "processing");
});

test("live and local-only orders are both listed, newest first", () => {
  const merged = mergeOrders([GUEST_ORDER], [LIVE_ORDER]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "uuid-live-1");
  assert.equal(merged[1].id, "order_guest_1");
});

test("orders page fetches live orders and merges them over the local list", () => {
  const source = readSource("../app/orders/page.tsx");
  assert.match(source, /listSupabaseOrders\(\)/);
  // The merge is scoped to the signed-in viewer: when signed in
  // the live list replaces the local list entirely (server mode),
  // so another account's local orders never surface here (audit
  // #9). The local list stays the fallback for guests only.
  assert.match(source, /mergeOrders\(browserOrders, liveOrders, userId !== null\)/);
  assert.match(source, /mergeOrders\(listOrders\(userId\), liveOrders, userId !== null\)/);
  // The local list is still loaded first (scoped to the viewer)
  // and shown immediately, before the live fetch lands.
  assert.match(source, /listOrders\(userId\)/);
  assert.match(source, /setOrders\(browserOrders\)/);
});

test("order detail page loads the live order when the browser copy is missing", () => {
  // Without this, clicking an order from the (now live) /orders list on
  // a fresh browser landed on "Order not found": the detail page only
  // read localStorage. It now falls back to listSupabaseOrders() and
  // registers the live copy locally so cancel / retry keep working.
  const source = readSource("../app/orders/[id]/page.tsx");
  assert.match(source, /listSupabaseOrders\(\)/);
  assert.match(source, /orders\.find\(\(o\) => o\.id === id\)/);
  assert.match(source, /saveOrder\(live\)/);
});
