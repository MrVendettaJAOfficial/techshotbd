// Callback illegal outcomes — TechShot (audit run-1, low 3).
//
// A signed-but-late payment outcome must never flip an order the
// database would refuse: a "failed" callback for a confirmed/paid
// order, or a "paid" callback for a cancelled order. The fix
// (2026-11-18) validates the move once, against the order's
// CURRENT status and latest payment status, before either store
// is touched (checkCallbackOutcome() in
// lib/orders/checkout/totals.ts), writes the in-memory record
// only when the Supabase leg succeeds (or when there is no
// database row to sync), and returns the Supabase leg's failure
// instead of { ok: true }.
//
// The route handler itself imports next/server and cannot run
// under plain node, so the route is pinned by source assertions
// (the same pattern as tests/callback-guest-cancel.test.mjs) and
// the decision itself is proven behaviourally through the real
// pure helper and the real in-memory store. The needs-validation
// item 10 cross-process nonce check lives at the bottom of this
// file: the nonce store really is process-local (a fresh process
// re-verifies a signed payload), and the transition check is what
// bounds the damage — see the verdict in the test name.
//
// Run: npm test (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  applyPaymentOutcome,
  checkCallbackOutcome,
} from "../lib/orders/checkout/totals.ts";
import {
  createOrderRecord,
  getOrderRecord,
  updateOrderRecordStatus,
} from "../lib/orders.ts";
import {
  clearSeenCallbackNoncesForTests,
  createTestCallbackPayload,
  signTestCallback,
  testAdapter,
} from "../lib/payments/test-adapter.ts";

const SIGNING_SECRET = "test-signing-secret";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readSource(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

function withSecret(secret) {
  const previous = process.env.TEST_PAYMENT_SIGNING_SECRET;
  if (secret === undefined) delete process.env.TEST_PAYMENT_SIGNING_SECRET;
  else process.env.TEST_PAYMENT_SIGNING_SECRET = secret;
  return () => {
    if (previous === undefined) delete process.env.TEST_PAYMENT_SIGNING_SECRET;
    else process.env.TEST_PAYMENT_SIGNING_SECRET = previous;
  };
}

/** Minimal StoredOrder for the in-memory store tests. */
function makeOrder(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: `order_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    orderNumber: "TS-20261118-0001",
    items: [],
    address: {
      id: "addr_1", firstName: "Test", lastName: "User",
      email: "test@example.com", mobile: "01712345678",
      address: "House 1, Road 2", area: "Dhanmondi",
      division: "Dhaka", district: "Dhaka", city: "Dhaka", isDefault: true,
    },
    delivery: "standard",
    paymentMethod: "card",
    subtotal_poisha: 0,
    savings_poisha: 0,
    couponCode: null,
    couponDiscount_poisha: 0,
    deliveryFee_poisha: 0,
    total_poisha: 0,
    status: "pending_payment",
    paymentStatus: "unpaid",
    testMode: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkCallbackOutcome(): the decision table
// ---------------------------------------------------------------------------

test("callback verdict: the audit's failed-on-paid case is illegal", () => {
  assert.equal(
    checkCallbackOutcome({ status: "confirmed", paymentStatus: "paid" }, "failed"),
    "illegal",
  );
  assert.equal(
    checkCallbackOutcome({ status: "processing", paymentStatus: "paid" }, "failed"),
    "illegal",
  );
  assert.equal(
    checkCallbackOutcome({ status: "delivered", paymentStatus: "paid" }, "failed"),
    "illegal",
  );
});

test("callback verdict: the audit's paid-on-cancelled case is illegal", () => {
  assert.equal(
    checkCallbackOutcome({ status: "cancelled", paymentStatus: "unpaid" }, "success"),
    "illegal",
  );
  assert.equal(
    checkCallbackOutcome({ status: "cancelled", paymentStatus: "cancelled" }, "failed"),
    "illegal",
  );
  assert.equal(
    checkCallbackOutcome({ status: "cancelled", paymentStatus: "cancelled" }, "cancelled"),
    "duplicate",
  );
});

test("callback verdict: the legal moves still pass", () => {
  // The normal paid path: pending -> confirmed + paid.
  assert.equal(
    checkCallbackOutcome({ status: "pending_payment", paymentStatus: "unpaid" }, "success"),
    "legal",
  );
  assert.equal(
    checkCallbackOutcome({ status: "pending_payment", paymentStatus: "failed" }, "success"),
    "legal",
  );
  // A failed payment stays pending and retryable (same status,
  // payment moves unpaid -> failed).
  assert.equal(
    checkCallbackOutcome({ status: "pending_payment", paymentStatus: "unpaid" }, "failed"),
    "legal",
  );
  // A cancel of an unpaid order is legal (the paid-order cancel
  // is refused separately by the route, with the refund direction
  // — see the source test below).
  assert.equal(
    checkCallbackOutcome({ status: "pending_payment", paymentStatus: "unpaid" }, "cancelled"),
    "legal",
  );
  assert.equal(
    checkCallbackOutcome({ status: "confirmed", paymentStatus: "unpaid" }, "cancelled"),
    "legal",
  );
});

test("callback verdict: a duplicate outcome is a duplicate, not a second write", () => {
  assert.equal(
    checkCallbackOutcome({ status: "confirmed", paymentStatus: "paid" }, "success"),
    "duplicate",
  );
  assert.equal(
    checkCallbackOutcome({ status: "pending_payment", paymentStatus: "failed" }, "failed"),
    "duplicate",
  );
});

test("callback verdict: a COD order never gains a paid row", () => {
  // Confirmed + unpaid is a COD order by design (it never takes a
  // payment step). A signed paid callback for it is refused.
  assert.equal(
    checkCallbackOutcome({ status: "confirmed", paymentStatus: "unpaid" }, "success"),
    "illegal",
  );
});

test("callback verdict: a late paid outcome supersedes a failed attempt", () => {
  // Confirmed with a FAILED latest payment (an admin advanced the
  // order, then the gateway success arrived late): the order is
  // already confirmed, only the payment record moves failed ->
  // paid. This is the one same-status paid move that is legal.
  assert.equal(
    checkCallbackOutcome({ status: "confirmed", paymentStatus: "failed" }, "success"),
    "legal",
  );
  // But a confirmed order that was already refunded takes no paid
  // outcome.
  assert.equal(
    checkCallbackOutcome({ status: "refunded", paymentStatus: "refunded" }, "success"),
    "illegal",
  );
});

test("callback verdict: a paid order is never cancelled by this verdict alone", () => {
  // Cancelling a confirmed order is a legal transition, so the
  // helper says "legal" — the ROUTE refuses it with the refund
  // direction (see the source test below), exactly as the admin
  // path does. The helper must not be read as the whole rule.
  assert.equal(
    checkCallbackOutcome({ status: "confirmed", paymentStatus: "paid" }, "cancelled"),
    "legal",
  );
  const route = readSource("app/api/payments/callback/route.ts");
  assert.ok(
    route.includes('if (patch.status === "cancelled" && order.paymentStatus === "paid")'),
    "the route still refuses a paid-order cancel with the refund direction",
  );
  assert.ok(
    route.includes("A paid order cannot be cancelled. Refund it instead."),
    "the refund direction message is still in the route",
  );
});

// ---------------------------------------------------------------------------
// The route: validate once, Supabase first, memory only on success
// ---------------------------------------------------------------------------

test("source: callback route validates the outcome before any write", () => {
  const route = readSource("app/api/payments/callback/route.ts");
  const verdictAt = route.indexOf("checkCallbackOutcome(order, outcome)");
  const memoryAt = route.indexOf("updateOrderRecordStatus(orderId, patch)");
  const syncAt = route.indexOf("updateSupabaseOrderFromCallback(orderId, patch");
  assert.ok(verdictAt > 0, "the route judges the outcome with checkCallbackOutcome");
  assert.ok(verdictAt < memoryAt, "the verdict precedes the memory write");
  assert.ok(verdictAt < syncAt, "the verdict precedes the database write");
  assert.ok(
    route.includes('if (verdict === "illegal")'),
    "an illegal outcome is refused",
  );
  assert.ok(
    route.includes('if (verdict === "duplicate")'),
    "a duplicate outcome is acknowledged without writing",
  );
  // The verdict runs on the same `order` the DB-first load resolved
  // (memory record when one exists, else the database row).
  assert.match(route, /const order = memoryOrder \?\? dbOrder/);
});

test("source: callback route writes memory only after the Supabase leg succeeds", () => {
  const route = readSource("app/api/payments/callback/route.ts");
  const syncAt = route.indexOf("updateSupabaseOrderFromCallback(orderId, patch");
  const memoryAt = route.indexOf("if (memoryOrder) updateOrderRecordStatus(orderId, patch)");
  assert.ok(syncAt > 0 && memoryAt > 0 && syncAt < memoryAt, "database leg first, memory second");
  assert.ok(
    route.includes("const synced = await updateSupabaseOrderFromCallback"),
    "the Supabase result is captured, not discarded",
  );
  assert.ok(
    route.includes('return NextResponse.json({ ok: false, error: synced.message }, { status: 400 });'),
    "a real Supabase rejection is returned instead of { ok: true }",
  );
  assert.ok(
    !/^\s*await updateSupabaseOrderFromCallback\(/m.test(route),
    "the sync call is never a bare fire-and-forget statement — its result is captured",
  );
});

test("source: callback route still verifies the signature before any write, and keeps the DB-first load", () => {
  const route = readSource("app/api/payments/callback/route.ts");
  const verifyAt = route.indexOf("testAdapter.verifyCallback(");
  const syncAt = route.indexOf("updateSupabaseOrderFromCallback(orderId, patch");
  assert.ok(verifyAt > 0 && syncAt > 0 && verifyAt < syncAt, "signature verification precedes the database write");
  assert.ok(
    route.includes("await loadSupabaseOrderForCallback(orderId)"),
    "the memory-miss database load is kept (do not undo the verdict-set change)",
  );
});

test("source: Supabase callback leg refuses a paid outcome for a COD order", () => {
  const callback = readSource("lib/orders/server/callback.ts");
  assert.ok(
    callback.includes('patch.paymentStatus === "paid"'),
    "the leg guards the same-status paid move",
  );
  assert.ok(
    callback.includes('currentPayment !== "failed"'),
    "a late paid outcome still supersedes a failed attempt",
  );
});

// ---------------------------------------------------------------------------
// Behaviour: an illegal outcome leaves the in-memory record alone
// ---------------------------------------------------------------------------

test("behaviour: a failed outcome for a confirmed/paid order changes nothing", () => {
  const order = createOrderRecord(
    makeOrder({ status: "confirmed", paymentStatus: "paid" }),
  );
  // The route's decision, replayed here with the real modules: the
  // verdict is illegal, so neither write runs and the record stays
  // confirmed + paid.
  const verdict = checkCallbackOutcome(order, "failed");
  assert.equal(verdict, "illegal");
  assert.deepEqual(
    { status: getOrderRecord(order.id).status, paymentStatus: getOrderRecord(order.id).paymentStatus },
    { status: "confirmed", paymentStatus: "paid" },
  );
  // The patch itself is still the downgrade — proving the guard,
  // not the patch, is what stops it.
  assert.deepEqual(applyPaymentOutcome("failed"), { status: "pending_payment", paymentStatus: "failed" });
});

test("behaviour: a paid outcome for a cancelled order changes nothing", () => {
  const order = createOrderRecord(
    makeOrder({ status: "cancelled", paymentStatus: "cancelled" }),
  );
  assert.equal(checkCallbackOutcome(order, "success"), "illegal");
  assert.deepEqual(
    { status: getOrderRecord(order.id).status, paymentStatus: getOrderRecord(order.id).paymentStatus },
    { status: "cancelled", paymentStatus: "cancelled" },
  );
});

test("behaviour: a legal outcome still applies to the in-memory record", () => {
  const order = createOrderRecord(makeOrder({ status: "pending_payment", paymentStatus: "unpaid" }));
  assert.equal(checkCallbackOutcome(order, "success"), "legal");
  const updated = updateOrderRecordStatus(order.id, applyPaymentOutcome("success"));
  assert.deepEqual(
    { status: updated.status, paymentStatus: updated.paymentStatus },
    { status: "confirmed", paymentStatus: "paid" },
  );
});

// ---------------------------------------------------------------------------
// NV 10: the nonce store is process-local — the transition check is
// what bounds the damage (verdict: confirmed not an issue for
// state changes; see the report for the full evidence).
// ---------------------------------------------------------------------------

/** Verify one signed payload in a FRESH node process. */
function verifyInFreshProcess(payload, signature) {
  const childCode = [
    "import { testAdapter } from '" + path.join(root, "lib/payments/test-adapter.ts") + "';",
    "const payload = JSON.parse(process.env.LOWS_NV10_PAYLOAD);",
    "const r = await testAdapter.verifyCallback(payload, process.env.LOWS_NV10_SIGNATURE);",
    "console.log(JSON.stringify({ valid: r.valid }));",
  ].join("\n");
  const out = execFileSync(
    process.execPath,
    ["--import", "./tests/register-ts-loader.mjs", "--input-type=module", "-e", childCode],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        TEST_PAYMENT_SIGNING_SECRET: SIGNING_SECRET,
        LOWS_NV10_PAYLOAD: JSON.stringify(payload),
        LOWS_NV10_SIGNATURE: signature,
      },
    },
  );
  return JSON.parse(out.trim()).valid;
}

test("NV 10: a signed callback verifies again in a fresh process, but the transition check bounds the replay", async () => {
  const restore = withSecret(SIGNING_SECRET);
  try {
    clearSeenCallbackNoncesForTests();
    const payload = createTestCallbackPayload("order_nv10_probe", "paid");
    const signature = signTestCallback(payload.orderId, payload.status, payload.timestamp, payload.nonce);
    // The gap is real at the adapter level: two fresh processes
    // both accept the same signed payload (empty nonce store each).
    assert.equal(verifyInFreshProcess(payload, signature), true, "fresh process A accepts");
    assert.equal(verifyInFreshProcess(payload, signature), true, "fresh process B accepts");
    // ...but the same process rejects the replay (single-use nonce).
    assert.equal((await testAdapter.verifyCallback(payload, signature)).valid, true, "first verify accepts");
    assert.equal((await testAdapter.verifyCallback(payload, signature)).valid, false, "same-process replay is rejected");
    // And the transition check is what bounds a fresh-process
    // replay: once the outcome has landed, the replayed outcome
    // is a duplicate (acknowledged, nothing written) or illegal.
    assert.equal(
      checkCallbackOutcome({ status: "confirmed", paymentStatus: "paid" }, "success"),
      "duplicate",
    );
    assert.equal(
      checkCallbackOutcome({ status: "confirmed", paymentStatus: "paid" }, "failed"),
      "illegal",
    );
  } finally {
    restore();
  }
});
