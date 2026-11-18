// Refund-before-conditional-update race — TechShot (audit run-1, low 11).
//
// changeOrderStatus() used to refund FIRST and claim the order
// second: two concurrent refund attempts both called the adapter
// before either conditional update landed, so one won the update
// and recorded a refund payments row while the loser's refund had
// already executed — with no payments row, no audit row and no
// stock restore for it. The fix (2026-11-18) claims BEFORE
// refunding: the conditional update to the final status IS the
// claim (there is no intermediate "refunding" status in the
// orders.status CHECK constraint, and adding one would need a
// database migration, so the claim uses the final status itself),
// only the claim winner reaches the adapter, and a failed refund
// rolls the claim back to the original status with a second
// conditional update. The loser's refund never executes.
//
// changeOrderStatus() needs a signed-in session and a database,
// so it cannot run under plain node: the ordering is pinned by
// source assertions (the same pattern as
// tests/review-fixes.test.mjs), and the claim-winner property is
// proven behaviourally with the real testAdapter.refund() against
// a fake conditional-update store that implements the same
// "update only when the status still matches" rule. The
// end-to-end race (two admin browsers refunding the same paid
// order at once) is covered by the Playwright suite in
// tests/e2e/lows-payment-trust.mjs.
//
// Run: npm test (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  clearRefundedPaymentsForTests,
  testAdapter,
} from "../lib/payments/test-adapter.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readSource(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

function readActions() {
  return readSource("lib/orders/actions/shared.ts");
}

// ---------------------------------------------------------------------------
// Source ordering: claim first, adapter second, rollback on failure
// ---------------------------------------------------------------------------

test("refund race: the claim update precedes the adapter refund", () => {
  const src = readActions();
  const claimAt = src.indexOf(".update({ status: target })");
  const refundAt = src.indexOf("testAdapter.refund(paidPayment.id, paidPayment.amount_poisha)");
  assert.ok(claimAt > 0, "the claim update exists");
  assert.ok(refundAt > 0, "the adapter refund exists");
  assert.ok(claimAt < refundAt, "the claim lands before the adapter is called");
  assert.ok(
    src.includes('.eq("status", order.status)'),
    "the claim is conditional on the status read at load time",
  );
  assert.ok(
    !src.includes("Refund: call the payment adapter FIRST"),
    "the old refund-first comment is gone",
  );
});

test("refund race: the loser of the claim is told already-changed and refunds nothing", () => {
  const src = readActions();
  const claimAt = src.indexOf("const { data: claimed, error: claimError }");
  const alreadyAt = src.indexOf("ALREADY_CHANGED_ERROR", claimAt);
  const refundAt = src.indexOf("testAdapter.refund(");
  assert.ok(claimAt > 0, "the claim block exists");
  assert.ok(alreadyAt > claimAt && alreadyAt < refundAt, "a lost claim returns already-changed before any refund call");
});

test("refund race: a failed refund rolls the claim back to the original status", () => {
  const src = readActions();
  assert.ok(
    src.includes(".update({ status: order.status })"),
    "the rollback update to the original status exists",
  );
  const rollbackAt = src.indexOf(".update({ status: order.status })");
  const rollbackGuardAt = src.indexOf('.eq("status", target)', rollbackAt);
  assert.ok(rollbackGuardAt > rollbackAt, "the rollback is conditional on still holding the claimed status");
  assert.ok(
    src.includes("refund rollback for order"),
    "a rollback that cannot land is logged server-side",
  );
});

test("refund race: stock restore and the refund payments row still run only after the won claim", () => {
  const src = readActions();
  const claimAt = src.indexOf(".update({ status: target })");
  const restoreAt = src.indexOf("await restoreStockAfterStatusChange(admin, order.id)");
  const rowAt = src.indexOf('status: "refunded"');
  const auditAt = src.indexOf("await writeAudit(admin, user.id, order.id, order.status, target)");
  assert.ok(claimAt > 0 && restoreAt > claimAt, "stock restores only after the claim");
  assert.ok(rowAt > claimAt, "the refund payments row is inserted only after the claim");
  assert.ok(auditAt > claimAt, "the audit row is written only after the claim");
});

// ---------------------------------------------------------------------------
// Behaviour: exactly one refund executes per transition
// ---------------------------------------------------------------------------

/**
 * A fake orders table with the same conditional-update rule the
 * real changeOrderStatus claim uses: the update only lands when
 * the row still holds the expected status. Returns the number of
 * rows affected (0 or 1).
 */
function makeFakeOrdersTable() {
  const rows = new Map();
  return {
    seed(id, status) {
      rows.set(id, status);
    },
    status(id) {
      return rows.get(id);
    },
    conditionalUpdate(id, nextStatus, expectedStatus) {
      if (rows.get(id) !== expectedStatus) return 0;
      rows.set(id, nextStatus);
      return 1;
    },
  };
}

/**
 * The fixed sequence, factored out of changeOrderStatus: load the
 * paid payment, claim the transition, refund only as the winner.
 * `expectedStatus` is the status read when the order was loaded
 * (before the race) — the claim only lands when the row still
 * holds it, exactly like the real `.eq("status", order.status)`.
 * Both attempts run "concurrently" (interleaved with awaits, the
 * way two staff members in two browsers would overlap).
 */
async function attemptRefund(table, orderId, expectedStatus, paidPayment, calls) {
  // Load the paid payment (a read — both attempts see it).
  if (!paidPayment) return { ok: false, error: "That status change is not allowed." };
  // Claim: conditional update to the final status.
  const claimed = table.conditionalUpdate(orderId, "refunded", expectedStatus);
  if (claimed !== 1) return { ok: false, error: "This order was already changed. Please reload and try again." };
  // Only the winner reaches the adapter.
  calls.push(paidPayment.id);
  const refund = await testAdapter.refund(paidPayment.id, paidPayment.amount_poisha);
  if (!refund.ok) {
    table.conditionalUpdate(orderId, "confirmed", "refunded");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  return { ok: true };
}

test("refund race: two concurrent refunds execute exactly one adapter refund", async () => {
  clearRefundedPaymentsForTests();
  const table = makeFakeOrdersTable();
  table.seed("order_race_1", "confirmed");
  const paidPayment = { id: "pay-race-1", amount_poisha: 1500000 };
  const calls = [];
  // Interleave the two attempts the way concurrent staff would:
  // both load the order as confirmed, then both claim — the second
  // claim loses because the row no longer holds "confirmed".
  const [first, second] = await Promise.all([
    attemptRefund(table, "order_race_1", "confirmed", paidPayment, calls),
    attemptRefund(table, "order_race_1", "confirmed", paidPayment, calls),
  ]);
  const winners = [first, second].filter((r) => r.ok);
  const losers = [first, second].filter((r) => !r.ok);
  assert.equal(winners.length, 1, "exactly one attempt wins the claim");
  assert.equal(losers.length, 1, "exactly one attempt loses");
  assert.match(losers[0].error, /already changed/, "the loser is told the order already changed");
  assert.equal(calls.length, 1, "the adapter refund ran exactly once — the loser refunded nothing");
  assert.equal(table.status("order_race_1"), "refunded", "the order lands refunded");
  // The winner's refund is recorded once; a repeat is refused by
  // the adapter's own idempotency too (defence in depth).
  assert.deepEqual(await testAdapter.refund("pay-race-1", 1500000), { ok: false });
  clearRefundedPaymentsForTests();
});

test("refund race: a failed refund rolls the order back to its original status", async () => {
  clearRefundedPaymentsForTests();
  // Pre-refund the payment id, so the winner's adapter call fails
  // (the idempotency record says it was already refunded).
  assert.deepEqual(await testAdapter.refund("pay-race-2", 1500000), { ok: true });
  const table = makeFakeOrdersTable();
  table.seed("order_race_2", "confirmed");
  const calls = [];
  const result = await attemptRefund(
    table,
    "order_race_2",
    "confirmed",
    { id: "pay-race-2", amount_poisha: 1500000 },
    calls,
  );
  assert.equal(result.ok, false, "the refund failure is reported");
  assert.equal(table.status("order_race_2"), "confirmed", "the claim was rolled back");
  assert.equal(calls.length, 1, "the winner reached the adapter once");
  clearRefundedPaymentsForTests();
});
