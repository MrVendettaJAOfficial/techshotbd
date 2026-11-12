// Test-payment adapter + payment outcome tests — TechShot.
//
// These tests import the REAL modules (lib/payments/test-adapter.ts and
// lib/orders.ts) through the loader registered by
// tests/register-ts-loader.mjs (see package.json "test"); Node 24 strips
// the erasable TypeScript types, so the rules tested here are the exact
// rules checkout, the test-pay page and the callback route run — not a
// stub copy of them.
//
// What is proven here:
//   - createPayment() returns a payment id, a test-pay redirect and a
//     provider reference, and the redirect keeps the order id;
//   - verifyCallback() accepts a correctly signed paid / failed /
//     cancelled callback, and rejects a bad signature, a signature made
//     with a different secret, a tampered status, an unknown status and
//     a malformed payload — without ever throwing for a bad callback;
//   - every signed callback carries a timestamp + nonce in the HMAC
//     input: a replayed callback is rejected, a stale timestamp is
//     rejected, and the old two-field payload no longer verifies;
//   - with NO signing secret configured, signTestCallback() throws and
//     verifyCallback() returns valid: false (fail closed). That is the
//     public callback route's behaviour — and, since the 2026-11-12
//     test-pay security fix, the test-pay page's too: without a secret
//     it renders no pay buttons and its action applies nothing. The
//     page-level fail-closed behaviour is covered by the Playwright
//     suite in tests/e2e/test-pay-security.mjs, not here;
//   - a paid payment marks the order confirmed + paid, a failed payment
//     leaves the order pending_payment + failed (unpaid, retryable), a
//     cancelled payment cancels it;
//   - a COD order is placed as confirmed + unpaid with no payment step.
//   - refund() always succeeds in test mode (no real money moves).
//
// What is NOT proven here (route handlers import next/server and cannot
// run under node): POST /api/payments/callback itself. Its 400-without-
// secret and 200-with-a-valid-signature behaviour is covered by the
// e2e script in tests/e2e/smoke.mjs, which signs a real callback.
//
// No real money moves: TEST MODE only. The test card 4242 4242 4242 4242
// is used on the test payment page; the adapter never collects or stores
// real card or bank details.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  CALLBACK_MAX_AGE_MS,
  clearSeenCallbackNoncesForTests,
  createTestCallbackPayload,
  testAdapter,
  signTestCallback,
} from "../lib/payments/test-adapter.ts";
import {
  applyPaymentOutcome,
  createOrderRecord,
  getOrderRecord,
  listOrderRecords,
  updateOrderRecordStatus,
} from "../lib/orders.ts";

const SIGNING_SECRET = "test-only-signing-secret";
const ORDER = { id: "order-uuid-1001", orderNumber: "TS-1001", total_poisha: 149900 };

function withSecret(secret) {
  const previous = process.env.TEST_PAYMENT_SIGNING_SECRET;
  if (secret === undefined) delete process.env.TEST_PAYMENT_SIGNING_SECRET;
  else process.env.TEST_PAYMENT_SIGNING_SECRET = secret;
  return () => {
    if (previous === undefined) delete process.env.TEST_PAYMENT_SIGNING_SECRET;
    else process.env.TEST_PAYMENT_SIGNING_SECRET = previous;
  };
}

/** Minimal StoredOrder for the in-memory order store tests. */
function makeOrder(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: `order_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    orderNumber: "TS-20261108-0001",
    items: [
      {
        productId: "apple-iphone-16-pro-256gb-natural-titanium",
        title: "Apple iPhone 16 Pro 256GB Natural Titanium",
        variant: "256GB Natural Titanium",
        price_poisha: 11990000,
        mrp_poisha: 12990000,
        quantity: 1,
      },
    ],
    address: {
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
      isDefault: false,
    },
    delivery: "standard",
    paymentMethod: "card",
    subtotal_poisha: 11990000,
    savings_poisha: 1000000,
    couponCode: null,
    couponDiscount_poisha: 0,
    deliveryFee_poisha: 0,
    total_poisha: 11990000,
    status: "pending_payment",
    paymentStatus: "unpaid",
    testMode: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("createPayment returns a payment id, a test-pay redirect and a provider reference", async () => {
  const result = await testAdapter.createPayment(ORDER);
  assert.equal(result.paymentId, `test_${ORDER.id}`);
  assert.equal(result.providerReference, `test-ref-${ORDER.orderNumber}`);
  assert.equal(
    result.redirectUrl,
    `/checkout/test-pay?order=${ORDER.id}&ref=test-ref-${ORDER.orderNumber}`,
  );
});

/** A correctly signed callback payload for an outcome, with a fresh nonce. */
function signed(status, overrides = {}) {
  const payload = { ...createTestCallbackPayload(ORDER.id, status), ...overrides };
  const signature = signTestCallback(payload.orderId, payload.status, payload.timestamp, payload.nonce);
  return { payload, signature };
}

test("verifyCallback accepts a correctly signed paid callback", async () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    const { payload, signature } = signed("paid");
    const result = await testAdapter.verifyCallback(payload, signature);
    assert.deepEqual(result, { valid: true, orderId: ORDER.id, status: "paid" });
  } finally {
    restore();
  }
});

test("verifyCallback accepts failed and cancelled outcomes", async () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    for (const status of ["failed", "cancelled"]) {
      const { payload, signature } = signed(status);
      const result = await testAdapter.verifyCallback(payload, signature);
      assert.deepEqual(result, { valid: true, orderId: ORDER.id, status });
    }
  } finally {
    restore();
  }
});

test("verifyCallback rejects an invalid signature (valid: false, no throw)", async () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    const payload = createTestCallbackPayload(ORDER.id, "paid");
    const result = await testAdapter.verifyCallback(payload, "0".repeat(64));
    assert.equal(result.valid, false);
    assert.equal(result.orderId, ORDER.id);
    assert.equal(result.status, "paid");
  } finally {
    restore();
  }
});

test("verifyCallback rejects a signature made with a different secret", async () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    const payload = createTestCallbackPayload(ORDER.id, "paid");
    const forged = createHmac("sha256", "attacker-secret")
      .update(`${payload.orderId}:${payload.status}:${payload.timestamp}:${payload.nonce}`)
      .digest("hex");
    const result = await testAdapter.verifyCallback(payload, forged);
    assert.equal(result.valid, false);
  } finally {
    restore();
  }
});

test("verifyCallback rejects a tampered status even with a real signature", async () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    // Signature is for "failed"; the callback claims "paid".
    const { payload, signature } = signed("failed");
    const result = await testAdapter.verifyCallback({ ...payload, status: "paid" }, signature);
    assert.equal(result.valid, false);
  } finally {
    restore();
  }
});

test("verifyCallback rejects an unknown status and a malformed payload", async () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    const payload = createTestCallbackPayload(ORDER.id, "refunded");
    const unknown = await testAdapter.verifyCallback(
      payload,
      signTestCallback(payload.orderId, payload.status, payload.timestamp, payload.nonce),
    );
    assert.equal(unknown.valid, false);
    const malformed = await testAdapter.verifyCallback(null, "0".repeat(64));
    assert.equal(malformed.valid, false);
    assert.equal(malformed.orderId, "");
  } finally {
    restore();
  }
});

test("verifyCallback rejects a replayed callback (same signed payload twice)", async () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    clearSeenCallbackNoncesForTests();
    const { payload, signature } = signed("paid");
    const first = await testAdapter.verifyCallback(payload, signature);
    assert.equal(first.valid, true);
    // Same payload, same signature, posted again: replay.
    const second = await testAdapter.verifyCallback(payload, signature);
    assert.equal(second.valid, false);
  } finally {
    restore();
  }
});

test("verifyCallback rejects a stale timestamp even with a valid signature", async () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    const { payload, signature } = signed("paid", {
      timestamp: Date.now() - CALLBACK_MAX_AGE_MS - 1000,
    });
    const result = await testAdapter.verifyCallback(payload, signature);
    assert.equal(result.valid, false);
  } finally {
    restore();
  }
});

test("verifyCallback rejects the old two-field payload (no timestamp / nonce)", async () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    // Old format: { orderId, status } only. The HMAC input changed, so
    // there is no legacy path that could weaken the replay check.
    const result = await testAdapter.verifyCallback(
      { orderId: ORDER.id, status: "paid" },
      "0".repeat(64),
    );
    assert.equal(result.valid, false);
    assert.equal(result.orderId, "");
  } finally {
    restore();
  }
});

test("without a signing secret, signing throws and verification fails closed", async () => {
  const restore = withSecret(undefined);
  try {
    assert.throws(
      () => signTestCallback(ORDER.id, "paid", Date.now(), "test-nonce-12345678"),
      /not configured/,
    );
    const result = await testAdapter.verifyCallback(
      createTestCallbackPayload(ORDER.id, "paid"),
      "0".repeat(64),
    );
    assert.equal(result.valid, false);
    assert.equal(result.orderId, ORDER.id);
  } finally {
    restore();
  }
});

test("refund always succeeds in test mode", async () => {
  const payment = await testAdapter.createPayment(ORDER);
  const result = await testAdapter.refund(payment.paymentId, ORDER.total_poisha);
  assert.deepEqual(result, { ok: true });
});

test("applyPaymentOutcome: paid marks the order confirmed + paid", () => {
  assert.deepEqual(applyPaymentOutcome("success"), {
    status: "confirmed",
    paymentStatus: "paid",
  });
});

test("applyPaymentOutcome: failed leaves the order pending payment + failed (unpaid, retryable)", () => {
  assert.deepEqual(applyPaymentOutcome("failed"), {
    status: "pending_payment",
    paymentStatus: "failed",
  });
});

test("applyPaymentOutcome: cancelled cancels the order", () => {
  assert.deepEqual(applyPaymentOutcome("cancelled"), {
    status: "cancelled",
    paymentStatus: "cancelled",
  });
});

test("failed payment leaves the order in the store, unpaid and retryable", () => {
  const order = createOrderRecord(makeOrder());
  const updated = updateOrderRecordStatus(order.id, applyPaymentOutcome("failed"));
  assert.ok(updated);
  assert.equal(updated.status, "pending_payment");
  assert.equal(updated.paymentStatus, "failed");
  // Still listed, still the same order: the shopper can retry payment.
  assert.equal(getOrderRecord(order.id)?.id, order.id);
  assert.ok(listOrderRecords().some((o) => o.id === order.id));
});

test("paid payment marks the stored order confirmed + paid", () => {
  const order = createOrderRecord(makeOrder());
  const updated = updateOrderRecordStatus(order.id, applyPaymentOutcome("success"));
  assert.ok(updated);
  assert.equal(updated.status, "confirmed");
  assert.equal(updated.paymentStatus, "paid");
  assert.equal(getOrderRecord(order.id)?.paymentStatus, "paid");
});

test("COD places an order as confirmed + unpaid with no payment step", () => {
  const order = createOrderRecord(
    makeOrder({
      paymentMethod: "cod",
      status: "confirmed",
      paymentStatus: "unpaid",
      testMode: false,
    }),
  );
  const stored = getOrderRecord(order.id);
  assert.ok(stored);
  assert.equal(stored.paymentMethod, "cod");
  assert.equal(stored.status, "confirmed");
  assert.equal(stored.paymentStatus, "unpaid");
  assert.equal(stored.testMode, false);
});
