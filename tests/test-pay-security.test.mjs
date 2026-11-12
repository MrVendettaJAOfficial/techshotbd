// Test-pay security tests — TechShot.
//
// Covers the 2026-11-12 fix for the 3 HIGH findings in
// app/checkout/test-pay/page.tsx (audit run-1, head 9c305966):
//   techshot/test-pay/unauthenticated-mark-paid,
//   techshot/test-pay/state-machine-bypass,
//   techshot/test-pay/fail-open-no-secret.
//
// These tests import the REAL modules (lib/orders/checkout/totals.ts
// and lib/payments/test-adapter.ts) through the loader registered by
// tests/register-ts-loader.mjs (see package.json "test"); Node 24
// strips the erasable TypeScript types, so the rules tested here are
// the exact rules the test-pay page runs — not a stub copy of them.
//
// What is proven here:
//   - isLegalTestPaymentOutcome(): the full state matrix — success
//     only from pending_payment, unpaid, non-COD; failed only from
//     pending_payment; cancelled only from pending_payment + unpaid
//     (so a paid order can never be cancelled, a cancelled order
//     can never be resurrected, a COD order can never gain a paid
//     row, and no outcome can double-pay);
//   - fail-closed secret handling: signTestCallback() throws without
//     a secret, verifyCallbackSignature() is false without a secret,
//     with a bad signature and with a stale timestamp, and true with
//     a good signature — and it never throws for a bad proof;
//   - buyer-token compare: an exact match proves ownership, a
//     mismatch, a missing token on either side, or an empty token
//     does not;
//   - createPayment() carries a guest buyerToken on the test-pay
//     redirect as ?key= (URL-encoded) and omits it for signed-in
//     orders, with the ref param unchanged.
//
// What is NOT proven here (the page imports next/navigation and
// cannot run under node): the testPayAction itself — its ownership
// check against orders.user_id, the generic redirects and the
// Supabase-first ordering are covered by the Playwright suite in
// tests/e2e/test-pay-security.mjs.
//
// No real money moves: TEST MODE only.
//
// Run: npm test  (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  CALLBACK_MAX_AGE_MS,
  buyerTokenMatches,
  createTestCallbackPayload,
  isTestPaymentSigningConfigured,
  signTestCallback,
  testAdapter,
  verifyCallbackSignature,
} from "../lib/payments/test-adapter.ts";
import { isLegalTestPaymentOutcome } from "../lib/orders/checkout/totals.ts";

const SIGNING_SECRET = "test-only-signing-secret";

function withSecret(secret) {
  const previous = process.env.TEST_PAYMENT_SIGNING_SECRET;
  if (secret === undefined) delete process.env.TEST_PAYMENT_SIGNING_SECRET;
  else process.env.TEST_PAYMENT_SIGNING_SECRET = secret;
  return () => {
    if (previous === undefined) delete process.env.TEST_PAYMENT_SIGNING_SECRET;
    else process.env.TEST_PAYMENT_SIGNING_SECRET = previous;
  };
}

/** A correctly signed callback payload for an order + status. */
function signed(orderId, status, overrides = {}) {
  const payload = { ...createTestCallbackPayload(orderId, status), ...overrides };
  const signature = signTestCallback(payload.orderId, payload.status, payload.timestamp, payload.nonce);
  return { payload, signature };
}

// ---------------------------------------------------------------------------
// State machine: isLegalTestPaymentOutcome()
// ---------------------------------------------------------------------------

test("state guard: success is legal from pending_payment, unpaid, card", () => {
  assert.equal(isLegalTestPaymentOutcome("pending_payment", "unpaid", "card", "success"), true);
  assert.equal(isLegalTestPaymentOutcome("pending_payment", "failed", "card", "success"), true);
  assert.equal(isLegalTestPaymentOutcome("pending_payment", "unpaid", "bkash", "success"), true);
  assert.equal(isLegalTestPaymentOutcome("pending_payment", "unpaid", "emi", "success"), true);
});

test("state guard: success is refused from confirmed / cancelled / delivered", () => {
  for (const status of ["confirmed", "processing", "shipped", "delivered", "cancelled", "refunded", "returned"]) {
    assert.equal(
      isLegalTestPaymentOutcome(status, "unpaid", "card", "success"),
      false,
      `success from ${status} must be refused`,
    );
  }
});

test("state guard: success is refused on a COD order", () => {
  // COD orders are confirmed + unpaid by design and never take a
  // payment step; paying one must never create a paid row.
  assert.equal(isLegalTestPaymentOutcome("pending_payment", "unpaid", "cod", "success"), false);
  assert.equal(isLegalTestPaymentOutcome("confirmed", "unpaid", "cod", "success"), false);
});

test("state guard: no outcome at all is legal on a COD order", () => {
  // A COD order takes no payment step: failed/cancelled must be
  // refused too, so a COD order can never be flipped back to
  // pending_payment or gain any payments row.
  for (const outcome of ["success", "failed", "cancelled"]) {
    assert.equal(
      isLegalTestPaymentOutcome("pending_payment", "unpaid", "cod", outcome),
      false,
      `COD + ${outcome} must be refused`,
    );
    assert.equal(
      isLegalTestPaymentOutcome("pending_payment", "failed", "cod", outcome),
      false,
      `COD (failed) + ${outcome} must be refused`,
    );
  }
});

test("state guard: success is refused on an already-paid order (no double-pay)", () => {
  assert.equal(isLegalTestPaymentOutcome("pending_payment", "paid", "card", "success"), false);
  assert.equal(isLegalTestPaymentOutcome("confirmed", "paid", "card", "success"), false);
});

test("state guard: failed is legal only from pending_payment", () => {
  assert.equal(isLegalTestPaymentOutcome("pending_payment", "unpaid", "card", "failed"), true);
  assert.equal(isLegalTestPaymentOutcome("pending_payment", "failed", "card", "failed"), true);
  for (const status of ["confirmed", "cancelled", "delivered"]) {
    assert.equal(
      isLegalTestPaymentOutcome(status, "unpaid", "card", "failed"),
      false,
      `failed from ${status} must be refused`,
    );
  }
});

test("state guard: cancelled is legal from pending_payment + unpaid, refused once paid", () => {
  assert.equal(isLegalTestPaymentOutcome("pending_payment", "unpaid", "card", "cancelled"), true);
  assert.equal(isLegalTestPaymentOutcome("pending_payment", "failed", "card", "cancelled"), true);
  // A paid order is refunded through the admin / cancel path, never
  // cancelled here — cancelling would keep the money.
  assert.equal(isLegalTestPaymentOutcome("pending_payment", "paid", "card", "cancelled"), false);
  assert.equal(isLegalTestPaymentOutcome("confirmed", "paid", "card", "cancelled"), false);
  assert.equal(isLegalTestPaymentOutcome("confirmed", "unpaid", "card", "cancelled"), false);
  assert.equal(isLegalTestPaymentOutcome("cancelled", "unpaid", "card", "cancelled"), false);
});

// ---------------------------------------------------------------------------
// Fail-closed secret handling
// ---------------------------------------------------------------------------

test("fail closed: isTestPaymentSigningConfigured tracks the secret", () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    assert.equal(isTestPaymentSigningConfigured(), true);
  } finally {
    restore();
  }
  const restoreEmpty = withSecret(undefined);
  try {
    assert.equal(isTestPaymentSigningConfigured(), false);
  } finally {
    restoreEmpty();
  }
  const restoreBlank = withSecret("");
  try {
    assert.equal(isTestPaymentSigningConfigured(), false);
  } finally {
    restoreBlank();
  }
});

test("fail closed: signing throws and the pure proof check is false without a secret", () => {
  const restore = withSecret(undefined);
  try {
    assert.throws(
      () => signTestCallback("order-1", "paid", Date.now(), "test-nonce-12345678"),
      /not configured/,
    );
    // A payload signed under no secret cannot exist; a forged one
    // must not verify, and the check must not throw.
    const payload = createTestCallbackPayload("order-1", "paid");
    assert.equal(verifyCallbackSignature(payload, "0".repeat(64)), false);
    assert.equal(verifyCallbackSignature(payload, ""), false);
  } finally {
    restore();
  }
});

test("fail closed: verifyCallbackSignature accepts a good signature", () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    const { payload, signature } = signed("order-1", "paid");
    assert.equal(verifyCallbackSignature(payload, signature), true);
    const cancelled = signed("order-1", "cancelled");
    assert.equal(verifyCallbackSignature(cancelled.payload, cancelled.signature), true);
  } finally {
    restore();
  }
});

test("fail closed: verifyCallbackSignature rejects a bad signature, a foreign secret and a tampered status", () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    const { payload } = signed("order-1", "paid");
    assert.equal(verifyCallbackSignature(payload, "0".repeat(64)), false);
    const forged = createHmac("sha256", "attacker-secret")
      .update(`${payload.orderId}:${payload.status}:${payload.timestamp}:${payload.nonce}`)
      .digest("hex");
    assert.equal(verifyCallbackSignature(payload, forged), false);
    // Signature is for "paid"; the payload claims "failed".
    const tampered = signed("order-1", "failed");
    assert.equal(verifyCallbackSignature({ ...tampered.payload, status: "paid" }, tampered.signature), false);
  } finally {
    restore();
  }
});

test("fail closed: verifyCallbackSignature rejects a stale timestamp even with a valid signature", () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    const { payload, signature } = signed("order-1", "paid", {
      timestamp: Date.now() - CALLBACK_MAX_AGE_MS - 1000,
    });
    assert.equal(verifyCallbackSignature(payload, signature), false);
  } finally {
    restore();
  }
});

test("fail closed: verifyCallbackSignature never throws for a malformed proof", () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    assert.equal(verifyCallbackSignature(null, "0".repeat(64)), false);
    assert.equal(verifyCallbackSignature({}, "0".repeat(64)), false);
    assert.equal(verifyCallbackSignature({ orderId: "order-1", status: "paid" }, "0".repeat(64)), false);
    assert.equal(
      verifyCallbackSignature({ orderId: "order-1", status: "paid", timestamp: Date.now(), nonce: "short" }, "0".repeat(64)),
      false,
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Buyer-token compare
// ---------------------------------------------------------------------------

test("buyer token: an exact match proves ownership, anything else does not", () => {
  const token = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(buyerTokenMatches(token, token), true);
  assert.equal(buyerTokenMatches(token, "550e8400-e29b-41d4-a716-446655440001"), false);
  assert.equal(buyerTokenMatches(token, token.slice(0, -1)), false);
  assert.equal(buyerTokenMatches(token, `${token} `), false);
  assert.equal(buyerTokenMatches(token, null), false);
  assert.equal(buyerTokenMatches(token, undefined), false);
  assert.equal(buyerTokenMatches(token, ""), false);
  assert.equal(buyerTokenMatches(null, token), false);
  assert.equal(buyerTokenMatches(null, null), false);
  assert.equal(buyerTokenMatches("", ""), false);
});

// ---------------------------------------------------------------------------
// Redirect URL carries the guest key
// ---------------------------------------------------------------------------

test("createPayment appends the guest key to the test-pay redirect, URL-encoded", async () => {
  const token = "550e8400-e29b-41d4-a716-446655440000";
  const result = await testAdapter.createPayment({
    id: "order-uuid-1001",
    orderNumber: "TS-1001",
    total_poisha: 149900,
    buyerToken: token,
  });
  assert.equal(
    result.redirectUrl,
    `/checkout/test-pay?order=order-uuid-1001&ref=test-ref-TS-1001&key=${token}`,
  );
  assert.equal(result.providerReference, "test-ref-TS-1001");
});

test("createPayment omits the key for signed-in orders (no buyerToken)", async () => {
  const result = await testAdapter.createPayment({
    id: "order-uuid-1001",
    orderNumber: "TS-1001",
    total_poisha: 149900,
  });
  assert.equal(
    result.redirectUrl,
    "/checkout/test-pay?order=order-uuid-1001&ref=test-ref-TS-1001",
  );
});
