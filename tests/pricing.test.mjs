// Pricing rule tests — TechShot (BDT).
//
// HONEST SCOPE: lib/pricing.ts is TypeScript and is written by a parallel
// workstream, so this file cannot import it directly under `node --test`
// (Node cannot run .ts). These tests therefore test the PRICING RULE
// TABLE itself, implemented here in plain JS from the same constants
// that live in lib/theme.ts. The TypeScript implementation in
// lib/pricing.ts MUST match this rule table exactly:
//
//   - All money is in poisha (100 poisha = ৳1).
//   - Standard delivery is free when the order subtotal is ৳999 or more
//     (FREE_DELIVERY_THRESHOLD_POISHA = 99900); below that it costs ৳60.
//   - Express delivery costs ৳499 (EXPRESS_DELIVERY_POISHA = 49900).
//   - Coupon FIRST2000 gives ৳2,000 off (FIRST2000_VALUE_POISHA =
//     200000), only when the subtotal is ৳50,000 or more
//     (FIRST2000_MIN_POISHA = 5000000).
//   - Totals are never negative: discounts are capped at the subtotal,
//     and the final total is floored at 0.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";

// Rule table, copied from lib/theme.ts (same numbers, plain JS).
const FREE_DELIVERY_THRESHOLD_POISHA = 99900; // ৳999
const STANDARD_DELIVERY_POISHA = 6000; // ৳60 below the threshold
const EXPRESS_DELIVERY_POISHA = 49900; // ৳499
const FIRST2000_MIN_POISHA = 5000000; // ৳50,000
const FIRST2000_VALUE_POISHA = 200000; // ৳2,000

function deliveryFeePoisha(subtotalPoisha, method) {
  if (subtotalPoisha <= 0) return 0; // an empty cart costs no delivery
  if (method === "express") return EXPRESS_DELIVERY_POISHA;
  return subtotalPoisha >= FREE_DELIVERY_THRESHOLD_POISHA ? 0 : STANDARD_DELIVERY_POISHA;
}

function couponDiscountPoisha(subtotalPoisha, code) {
  if (code !== "FIRST2000") return 0;
  if (subtotalPoisha < FIRST2000_MIN_POISHA) return 0;
  return Math.min(FIRST2000_VALUE_POISHA, subtotalPoisha);
}

function orderTotalPoisha(subtotalPoisha, method, code) {
  const discount = couponDiscountPoisha(subtotalPoisha, code);
  const fee = deliveryFeePoisha(subtotalPoisha, method);
  return Math.max(0, subtotalPoisha - discount + fee);
}

test("free delivery at exactly ৳999 (99900 poisha)", () => {
  assert.equal(deliveryFeePoisha(99900, "standard"), 0);
});

test("free delivery above ৳999", () => {
  assert.equal(deliveryFeePoisha(150000, "standard"), 0);
});

test("standard delivery fee below ৳999", () => {
  assert.equal(deliveryFeePoisha(99899, "standard"), STANDARD_DELIVERY_POISHA);
  assert.equal(deliveryFeePoisha(100, "standard"), STANDARD_DELIVERY_POISHA);
});

test("an empty cart costs no delivery", () => {
  assert.equal(deliveryFeePoisha(0, "standard"), 0);
  assert.equal(deliveryFeePoisha(0, "express"), 0);
});

test("express delivery is always ৳499, even above the free threshold", () => {
  assert.equal(deliveryFeePoisha(99900, "express"), EXPRESS_DELIVERY_POISHA);
  assert.equal(deliveryFeePoisha(500000, "express"), EXPRESS_DELIVERY_POISHA);
  assert.equal(deliveryFeePoisha(100, "express"), EXPRESS_DELIVERY_POISHA);
});

test("FIRST2000 gives ৳2,000 off at exactly ৳50,000", () => {
  assert.equal(couponDiscountPoisha(5000000, "FIRST2000"), 200000);
});

test("FIRST2000 gives ৳2,000 off above ৳50,000", () => {
  assert.equal(couponDiscountPoisha(7500000, "FIRST2000"), 200000);
});

test("FIRST2000 gives nothing below ৳50,000", () => {
  assert.equal(couponDiscountPoisha(4999900, "FIRST2000"), 0);
  assert.equal(couponDiscountPoisha(100000, "FIRST2000"), 0);
});

test("unknown coupon codes give no discount", () => {
  assert.equal(couponDiscountPoisha(6000000, "WELCOME150"), 0);
  assert.equal(couponDiscountPoisha(6000000, ""), 0);
  assert.equal(couponDiscountPoisha(6000000, "first2000"), 0);
});

test("totals are never negative", () => {
  // A discount larger than the subtotal cannot drive the total below 0.
  assert.equal(couponDiscountPoisha(100, "FIRST2000"), 0);
  assert.ok(orderTotalPoisha(0, "standard", "FIRST2000") >= 0);
  assert.ok(orderTotalPoisha(100, "express", "FIRST2000") >= 0);
  assert.equal(orderTotalPoisha(0, "standard", undefined), 0);
});

test("full totals combine subtotal, discount and delivery", () => {
  // ৳60,000 subtotal, FIRST2000, standard delivery (free over ৳999).
  assert.equal(orderTotalPoisha(6000000, "standard", "FIRST2000"), 5800000);
  // ৳500 subtotal, no coupon, standard delivery (৳60 fee).
  assert.equal(orderTotalPoisha(50000, "standard", undefined), 56000);
  // ৳500 subtotal, no coupon, express delivery (৳499 fee).
  assert.equal(orderTotalPoisha(50000, "express", undefined), 99900);
});
