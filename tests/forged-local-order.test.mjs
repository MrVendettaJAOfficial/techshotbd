// Forged localStorage order — TechShot (audit run-1, low 5).
//
// storedOrderSchema validated only per-field shape, so a
// localStorage entry with arbitrary totals, an arbitrary coupon
// discount and status delivered / paymentStatus paid passed
// validation and rendered in /orders and /orders/[id] as a real
// paid order, and updateOrderStatus() let any browser code set
// any status/paymentStatus with no payment proof. The fix
// (2026-11-18) has three layers:
//
//   1. Cross-field validation in storedOrderSchema: the lines sum
//      to the subtotal, the savings match the compare-at prices,
//      the delivery fee matches the pricing rule, and the total is
//      subtotal minus the discount actually applied plus the
//      delivery fee. Inconsistent entries are dropped on read,
//      exactly like shape-invalid ones.
//   2. updateOrderStatus() refuses a patch that marks an order
//      paid unless the caller passes { corroborated: true } — the
//      only caller that does is the order detail page's server
//      reconciliation, which adopts a paymentStatus the server
//      itself returned.
//   3. The order detail page labels a browser copy that claims
//      paid/delivered with no server record behind it as an
//      unverified copy.
//
// Design decision (see the report): a "delivered" STATUS is not
// gated in updateOrderStatus — in unconfigured/demo mode the
// admin list advances local orders through the fulfilment flow,
// and blocking that would break the demo admin flow. A forged
// delivered copy is handled by layers 1 and 3 instead (its
// totals must reconcile, and it renders labelled unverified).
// Likewise a guest's own legitimately placed order still
// renders: guest orders are real database rows when Supabase is
// configured, and when it is not, the browser copy is the order
// — the label only fires on a paid/delivered claim with no
// server record, and the totals check passes for every order
// checkout actually writes.
//
// Run: npm test (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { validateStoredOrders } from "../lib/checkout/validation.ts";
import {
  getOrder,
  listOrders,
  saveOrder,
  updateOrderStatus,
} from "../lib/checkout/storage.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readSource(rel) {
  return readFileSync(path.join(root, rel), "utf8");
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
    id: "addr_1",
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

/** A real stored order: totals exactly as checkout computes them. */
function validOrder(overrides = {}) {
  return {
    id: "order_1",
    orderNumber: "TS-20261118-0001",
    items: [
      { productId: "apple-iphone-16-pro", title: "Apple iPhone 16 Pro", price_poisha: 11990000, mrp_poisha: 12990000, quantity: 1 },
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
    createdAt: "2026-11-18T10:00:00.000Z",
    updatedAt: "2026-11-18T10:00:00.000Z",
    ...overrides,
  };
}

/** The audit's exact forged payload: items worth 11990000 poisha,
 *  subtotal/total of 100, a 5000000-poisha coupon discount, marked
 *  delivered + paid. */
function forgedAuditOrder() {
  return {
    id: "forged-order-1",
    orderNumber: "TS-20260101-9999",
    items: [
      { productId: "iphone-uuid", title: "Apple iPhone 16 Pro 256GB Natural Titanium", price_poisha: 11990000, mrp_poisha: 12990000, quantity: 1 },
    ],
    address: {
      id: "addr_1", firstName: "Victim", lastName: "User", email: "victim@example.com",
      mobile: "01700000000", address: "1 Secret Road", area: "Agrabad",
      division: "Chattogram", district: "Chattogram", city: "Chattogram", isDefault: true,
    },
    delivery: "standard",
    paymentMethod: "bkash",
    subtotal_poisha: 100,
    savings_poisha: 0,
    couponCode: "FIRST2000",
    couponDiscount_poisha: 5000000,
    deliveryFee_poisha: 0,
    total_poisha: 100,
    status: "delivered",
    paymentStatus: "paid",
    testMode: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Cross-field validation
// ---------------------------------------------------------------------------

test("forged local order: the audit's delivered + paid payload is dropped", () => {
  assert.deepEqual(validateStoredOrders([forgedAuditOrder()]), []);
  assert.deepEqual(
    validateStoredOrders([validOrder(), forgedAuditOrder()]).map((o) => o.id),
    ["order_1"],
  );
});

test("forged local order: each inconsistent field alone is enough to drop it", () => {
  // Items sum (11990000) vs a tampered subtotal.
  assert.deepEqual(validateStoredOrders([validOrder({ subtotal_poisha: 100 })]), []);
  // A tampered total.
  assert.deepEqual(validateStoredOrders([validOrder({ total_poisha: 100 })]), []);
  // Savings that do not match the compare-at prices.
  assert.deepEqual(validateStoredOrders([validOrder({ savings_poisha: 0 })]), []);
  // A delivery fee the pricing rule would never produce for this
  // subtotal (standard over 99900 is free).
  assert.deepEqual(validateStoredOrders([validOrder({ deliveryFee_poisha: 6000 })]), []);
  // A coupon discount with no matching total (the discount is
  // taken off, so the total must fall by the same amount).
  assert.deepEqual(
    validateStoredOrders([validOrder({ couponCode: "FIRST2000", couponDiscount_poisha: 200000 })]),
    [],
  );
});

test("real orders still pass: checkout totals, live-mapped orders, clamped coupons", () => {
  // The plain checkout order.
  assert.equal(validateStoredOrders([validOrder()]).length, 1);
  // A standard order under the free-delivery threshold pays 6000.
  assert.equal(
    validateStoredOrders([
      validOrder({
        items: [{ productId: "x", title: "X", price_poisha: 50000, mrp_poisha: 60000, quantity: 1 }],
        subtotal_poisha: 50000,
        savings_poisha: 10000,
        deliveryFee_poisha: 6000,
        total_poisha: 56000,
      }),
    ]).length,
    1,
  );
  // Express is a flat 49900.
  assert.equal(
    validateStoredOrders([
      validOrder({
        delivery: "express",
        deliveryFee_poisha: 49900,
        total_poisha: 11990000 + 49900,
      }),
    ]).length,
    1,
  );
  // A live Supabase order mapped by lib/orders/server/list.ts:
  // items carry mrp = price, so the savings are 0 — and the
  // stored savings are 0 too. It must not be dropped on re-read.
  assert.equal(
    validateStoredOrders([
      validOrder({
        items: [{ productId: "apple-iphone-16-pro", title: "Apple iPhone 16 Pro", price_poisha: 11990000, mrp_poisha: 11990000, quantity: 1 }],
        savings_poisha: 0,
      }),
    ]).length,
    1,
  );
  // A coupon whose face value exceeds the subtotal: checkout
  // clamps what is actually taken off, so a total of 0 is
  // consistent and the order passes.
  assert.equal(
    validateStoredOrders([
      validOrder({
        items: [{ productId: "x", title: "X", price_poisha: 100000, mrp_poisha: 100000, quantity: 1 }],
        subtotal_poisha: 100000,
        savings_poisha: 0,
        couponCode: "BIG",
        couponDiscount_poisha: 500000,
        deliveryFee_poisha: 0,
        total_poisha: 0,
      }),
    ]).length,
    1,
  );
});

test("forged local order: written to storage, it is dropped on read (and repaired)", () => {
  resetStorage();
  saveOrder(forgedAuditOrder());
  assert.deepEqual(listOrders(), []);
  assert.equal(getOrder("forged-order-1"), null);
  // The repair writes the cleaned list back, so the forgery
  // cannot reappear on the next read either.
  assert.deepEqual(JSON.parse(fakeStore.get("techshot:orders") ?? "[]"), []);
  resetStorage();
});

// ---------------------------------------------------------------------------
// updateOrderStatus(): no self-asserted paid state
// ---------------------------------------------------------------------------

test("updateOrderStatus refuses to mark an order paid without server corroboration", () => {
  resetStorage();
  saveOrder(validOrder({ status: "pending_payment", paymentStatus: "unpaid" }));
  assert.equal(updateOrderStatus("order_1", { status: "confirmed", paymentStatus: "paid" }), null);
  assert.equal(getOrder("order_1").paymentStatus, "unpaid");
  assert.equal(getOrder("order_1").status, "pending_payment");
  resetStorage();
});

test("updateOrderStatus adopts a server-corroborated paid state", () => {
  resetStorage();
  saveOrder(validOrder({ status: "pending_payment", paymentStatus: "unpaid" }));
  const updated = updateOrderStatus(
    "order_1",
    { status: "confirmed", paymentStatus: "paid" },
    undefined,
    { corroborated: true },
  );
  assert.equal(updated?.paymentStatus, "paid");
  assert.equal(updated?.status, "confirmed");
  assert.equal(getOrder("order_1").paymentStatus, "paid");
  resetStorage();
});

test("updateOrderStatus still allows the non-payment moves the browser legitimately makes", () => {
  resetStorage();
  saveOrder(validOrder({ status: "pending_payment", paymentStatus: "unpaid" }));
  // A failed payment (retryable) is not a paid claim.
  assert.equal(updateOrderStatus("order_1", { status: "pending_payment", paymentStatus: "failed" })?.paymentStatus, "failed");
  // A local-only cancel marks the payment refunded/cancelled, never paid.
  assert.equal(
    updateOrderStatus("order_1", { status: "cancelled", paymentStatus: "cancelled" })?.status,
    "cancelled",
  );
  // A delivered status is deliberately NOT gated (demo-mode admin
  // advances local orders) — see the header note.
  saveOrder(validOrder({ id: "order_2", status: "shipped", paymentStatus: "unpaid" }));
  assert.equal(updateOrderStatus("order_2", { status: "delivered" })?.status, "delivered");
  resetStorage();
});

// ---------------------------------------------------------------------------
// The unverified label on the order detail page
// ---------------------------------------------------------------------------

test("order detail page labels an uncorroborated paid/delivered copy as unverified", () => {
  const page = readSource("app/orders/[id]/page.tsx");
  assert.ok(page.includes("Unverified copy"), "the unverified label exists");
  assert.ok(
    page.includes("serverCorroborated === false"),
    "the label is gated on the server check resolving with no record",
  );
  assert.ok(
    page.includes('order.paymentStatus === "paid"'),
    "the label fires on a paid claim",
  );
  assert.ok(
    page.includes('(unverified)'),
    "the payment status line itself carries the qualifier",
  );
});
