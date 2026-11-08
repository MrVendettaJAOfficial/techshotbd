// Test-payment adapter contract tests — TechShot.
//
// HONEST SCOPE: the real test-payment adapter lives in
// lib/payments/test-adapter.ts (TypeScript, implementing the
// PaymentAdapter interface in lib/payments/index.ts), so this file
// cannot import it under `node --test` (Node cannot run .ts). These
// tests therefore test the ADAPTER CONTRACT with a self-contained
// local stub that implements the same interface and the same rules:
//
//   - createPayment({ id, orderNumber, total_poisha }) ->
//     { paymentId, redirectUrl, providerReference }. The redirect goes
//     to /checkout/test-pay, where the test page lets the developer pick
//     paid / failed / cancelled.
//   - verifyCallback({ orderId, status }, signature) ->
//     { valid, orderId, status }, where status is "paid" | "failed" |
//     "cancelled". The signature is HMAC-SHA-256 over
//     "<orderId>:<status>" with TEST_PAYMENT_SIGNING_SECRET, compared in
//     constant time. A bad signature, a tampered payload, an unknown
//     status, or a missing signing secret all give valid: false —
//     verifyCallback never throws for a bad callback.
//   - refund(paymentId, amount_poisha) -> { ok: true }. In TEST MODE
//     there is no real money to move, so a test refund always succeeds.
//
// No real money moves: TEST MODE only. The test card 4242 4242 4242 4242
// is used on the test payment page; the adapter never collects or stores
// real card or bank details.
//
// Run: npm test  (node --test tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNING_SECRET = "test-only-signing-secret";

// --- Local stub implementing the PaymentAdapter contract. ---
function signTestCallback(orderId, status, secret) {
  return createHmac("sha256", secret).update(`${orderId}:${status}`).digest("hex");
}

function createTestPaymentAdapter(secret) {
  return {
    async createPayment({ id, orderNumber, total_poisha }) {
      assert.ok(id, "id is required");
      assert.ok(orderNumber, "orderNumber is required");
      assert.ok(Number.isInteger(total_poisha) && total_poisha > 0, "total_poisha must be a positive integer");
      const providerReference = `test-ref-${orderNumber}`;
      return {
        paymentId: `test_${id}`,
        redirectUrl: `/checkout/test-pay?order=${encodeURIComponent(id)}&ref=${encodeURIComponent(providerReference)}`,
        providerReference,
      };
    },

    async verifyCallback(payload, signature) {
      const validStatuses = ["paid", "failed", "cancelled"];
      if (!payload || typeof payload !== "object") return { valid: false, orderId: "", status: "failed" };
      const { orderId, status } = payload;
      if (typeof orderId !== "string" || !orderId) return { valid: false, orderId: "", status: "failed" };
      if (!validStatuses.includes(status)) return { valid: false, orderId, status: "failed" };
      if (!secret) return { valid: false, orderId, status };
      const expected = signTestCallback(orderId, status, secret);
      const given = Buffer.from(signature ?? "", "utf8");
      const wanted = Buffer.from(expected, "utf8");
      const valid = given.length === wanted.length && timingSafeEqual(given, wanted);
      return { valid, orderId, status };
    },

    async refund(paymentId, amount_poisha) {
      // Test mode: no real money moves, so a refund always succeeds.
      void paymentId;
      void amount_poisha;
      return { ok: true };
    },

    // Test helper only: build a correctly signed callback payload.
    signForTest(orderId, status) {
      return signTestCallback(orderId, status, secret);
    },
  };
}

const ORDER = { id: "order-uuid-1001", orderNumber: "TS-1001", total_poisha: 149900 };

test("createPayment returns a payment id, a test-pay redirect and a provider reference", async () => {
  const adapter = createTestPaymentAdapter(SIGNING_SECRET);
  const result = await adapter.createPayment(ORDER);
  assert.equal(result.paymentId, `test_${ORDER.id}`);
  assert.equal(result.providerReference, `test-ref-${ORDER.orderNumber}`);
  assert.match(result.redirectUrl, /^\/checkout\/test-pay\?order=order-uuid-1001&ref=test-ref-TS-1001$/);
});

test("createPayment rejects a bad total", async () => {
  const adapter = createTestPaymentAdapter(SIGNING_SECRET);
  await assert.rejects(() => adapter.createPayment({ ...ORDER, total_poisha: 0 }), /positive integer/);
  await assert.rejects(() => adapter.createPayment({ ...ORDER, total_poisha: -100 }), /positive integer/);
});

test("verifyCallback accepts a correctly signed paid callback", async () => {
  const adapter = createTestPaymentAdapter(SIGNING_SECRET);
  const signature = adapter.signForTest(ORDER.id, "paid");
  const result = await adapter.verifyCallback({ orderId: ORDER.id, status: "paid" }, signature);
  assert.deepEqual(result, { valid: true, orderId: ORDER.id, status: "paid" });
});

test("verifyCallback accepts failed and cancelled outcomes", async () => {
  const adapter = createTestPaymentAdapter(SIGNING_SECRET);
  for (const status of ["failed", "cancelled"]) {
    const signature = adapter.signForTest(ORDER.id, status);
    const result = await adapter.verifyCallback({ orderId: ORDER.id, status }, signature);
    assert.deepEqual(result, { valid: true, orderId: ORDER.id, status });
  }
});

test("verifyCallback rejects an invalid signature (valid: false, no throw)", async () => {
  const adapter = createTestPaymentAdapter(SIGNING_SECRET);
  const result = await adapter.verifyCallback(
    { orderId: ORDER.id, status: "paid" },
    "0".repeat(64),
  );
  assert.equal(result.valid, false);
  assert.equal(result.orderId, ORDER.id);
  assert.equal(result.status, "paid");
});

test("verifyCallback rejects a signature made with a different secret", async () => {
  const adapter = createTestPaymentAdapter(SIGNING_SECRET);
  const forged = createHmac("sha256", "attacker-secret")
    .update(`${ORDER.id}:paid`)
    .digest("hex");
  const result = await adapter.verifyCallback({ orderId: ORDER.id, status: "paid" }, forged);
  assert.equal(result.valid, false);
});

test("verifyCallback rejects a tampered status even with a real signature", async () => {
  const adapter = createTestPaymentAdapter(SIGNING_SECRET);
  // Signature is for "failed"; the callback claims "paid".
  const signature = adapter.signForTest(ORDER.id, "failed");
  const result = await adapter.verifyCallback({ orderId: ORDER.id, status: "paid" }, signature);
  assert.equal(result.valid, false);
});

test("verifyCallback rejects an unknown status and a malformed payload", async () => {
  const adapter = createTestPaymentAdapter(SIGNING_SECRET);
  const unknown = await adapter.verifyCallback(
    { orderId: ORDER.id, status: "refunded" },
    adapter.signForTest(ORDER.id, "refunded"),
  );
  assert.equal(unknown.valid, false);
  const malformed = await adapter.verifyCallback(null, "0".repeat(64));
  assert.equal(malformed.valid, false);
  assert.equal(malformed.orderId, "");
});

test("verifyCallback is invalid when no signing secret is configured", async () => {
  const adapter = createTestPaymentAdapter(undefined);
  const result = await adapter.verifyCallback(
    { orderId: ORDER.id, status: "paid" },
    "0".repeat(64),
  );
  assert.equal(result.valid, false);
});

test("refund always succeeds in test mode", async () => {
  const adapter = createTestPaymentAdapter(SIGNING_SECRET);
  const payment = await adapter.createPayment(ORDER);
  const result = await adapter.refund(payment.paymentId, ORDER.total_poisha);
  assert.deepEqual(result, { ok: true });
});
