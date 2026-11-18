// TestAdapter.refund reporting — TechShot (audit run-1, low 6).
//
// TestAdapter.refund() used to return { ok: true } for any
// non-empty payment id and any amount >= 0 — a payment that does
// not exist, an amount of 0, an amount unrelated to any order,
// and the same refund repeated all "succeeded". The fix
// (2026-11-18) makes refund() honest about what the test adapter
// can and cannot check:
//
//   * it verifies the shape of a real refund: a non-empty payment
//     id and a positive whole-poisha amount (0, negative and
//     fractional amounts are refused);
//   * it is idempotent within the process: a second refund of the
//     same payment id is refused (a different amount for the same
//     id is refused the same way);
//   * it CANNOT verify that the payment exists, is paid, or that
//     the amount equals the paid amount — the test adapter has no
//     payment store to look the payment up in, and this file pins
//     that limit honestly instead of pretending otherwise. That
//     verification lives in the caller: changeOrderStatus
//     (lib/orders/actions/shared.ts) loads the latest PAID payment
//     for the order first and passes that payment's id and exact
//     amount, and only the caller that won the status claim
//     reaches refund() at all. A real gateway adapter must verify
//     the payment against the provider.
//
// The PaymentAdapter interface (lib/payments/index.ts) is
// unchanged: refund() keeps its (paymentId, amount_poisha) shape
// so the real gateway plugs in behind it later.
//
// Run: npm test (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";

import {
  clearRefundedPaymentsForTests,
  testAdapter,
} from "../lib/payments/test-adapter.ts";

test("refund: a first refund of a payment succeeds", async () => {
  clearRefundedPaymentsForTests();
  assert.deepEqual(await testAdapter.refund("pay-first-1", 11990000), { ok: true });
  clearRefundedPaymentsForTests();
});

test("refund: the same payment refunded twice succeeds only once", async () => {
  clearRefundedPaymentsForTests();
  assert.deepEqual(await testAdapter.refund("pay-twice-1", 1500000), { ok: true });
  assert.deepEqual(await testAdapter.refund("pay-twice-1", 1500000), { ok: false });
  // A different amount for the same payment id is refused too —
  // the idempotency key is the payment, not the amount.
  assert.deepEqual(await testAdapter.refund("pay-twice-1", 1), { ok: false });
  clearRefundedPaymentsForTests();
});

test("refund: a different payment id is unaffected by an earlier refund", async () => {
  clearRefundedPaymentsForTests();
  assert.deepEqual(await testAdapter.refund("pay-other-1", 100000), { ok: true });
  assert.deepEqual(await testAdapter.refund("pay-other-2", 100000), { ok: true });
  clearRefundedPaymentsForTests();
});

test("refund: amounts that are not a real refund are refused", async () => {
  clearRefundedPaymentsForTests();
  assert.deepEqual(await testAdapter.refund("pay-amount-0", 0), { ok: false });
  assert.deepEqual(await testAdapter.refund("pay-amount-neg", -100), { ok: false });
  assert.deepEqual(await testAdapter.refund("pay-amount-frac", 10.5), { ok: false });
  clearRefundedPaymentsForTests();
});

test("refund: an empty or non-string payment id is refused", async () => {
  clearRefundedPaymentsForTests();
  assert.deepEqual(await testAdapter.refund("", 100000), { ok: false });
  assert.deepEqual(await testAdapter.refund(null, 100000), { ok: false });
  assert.deepEqual(await testAdapter.refund(undefined, 100000), { ok: false });
  clearRefundedPaymentsForTests();
});

test("refund: the test-only clear helper resets the idempotency record", async () => {
  clearRefundedPaymentsForTests();
  assert.deepEqual(await testAdapter.refund("pay-clear-1", 100000), { ok: true });
  assert.deepEqual(await testAdapter.refund("pay-clear-1", 100000), { ok: false });
  clearRefundedPaymentsForTests();
  assert.deepEqual(await testAdapter.refund("pay-clear-1", 100000), { ok: true });
  clearRefundedPaymentsForTests();
});
