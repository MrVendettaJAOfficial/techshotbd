// Forged ?payment= query — TechShot (audit run-1, low 4).
//
// GET /orders/<id>?payment=success used to rewrite the
// browser-stored order to confirmed/paid with no check that any
// payment happened — no test-pay action, no HMAC callback, no
// server read — and the forgery survived reloads. The fix
// (2026-11-18) deletes the ?payment= effect entirely: the
// test-pay redirect lands on the plain order page with no query
// parameter, and the page only ever adopts a payment the server
// itself reports. The "payment successful" notice is shown only
// after getOrderStatusFromServer() returns paymentStatus "paid"
// for this order — never from searchParams.
//
// The order page is a client component, so the removal is pinned
// by source assertions (the same pattern as
// tests/callback-guest-cancel.test.mjs); the browser behaviour
// (a forged ?payment=success changes nothing, a real test-pay
// success still shows as paid for a signed-in buyer) is covered
// by the Playwright suite in tests/e2e/lows-payment-trust.mjs.
//
// Run: npm test (node --test --import ./tests/register-ts-loader.mjs tests/*.test.mjs)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readSource(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

test("order detail page never reads a payment outcome from the query string", () => {
  const page = readSource("app/orders/[id]/page.tsx");
  assert.ok(!page.includes('searchParams.get("payment")'), "no ?payment= read");
  assert.ok(!page.includes("paymentQueryToOutcome"), "the query-to-outcome helper is gone from the page");
  assert.ok(!page.includes("applyPaymentOutcome"), "no outcome is applied from the page");
  assert.ok(!page.includes("Test payment cancelled. Your order has been cancelled."), "no query-driven cancelled notice");
});

test("order detail page still shows the refund direction for a paid order refused a cancel", () => {
  // ?notice=refund is the one query value the page still honours:
  // it carries no status change, only a fixed message, and only
  // the test-pay action (after passing ownership) ever sends it.
  const page = readSource("app/orders/[id]/page.tsx");
  assert.ok(page.includes('searchParams.get("notice") === "refund"'), "the refund direction is still read");
  assert.ok(
    page.includes("This order was already paid, so it can't be cancelled here. Please contact us for a refund."),
    "the refund direction message is unchanged",
  );
});

test("order detail page shows the success notice only after the server reports paid", () => {
  const page = readSource("app/orders/[id]/page.tsx");
  assert.ok(
    page.includes('setNotice("Test payment successful. Your order is confirmed.")'),
    "the success notice still exists",
  );
  // The notice is set inside the server-reconciliation handler
  // (after getOrderStatusFromServer resolves), never in a
  // query-string effect — the setNotice call comes after the
  // server fetch in the file.
  const fetchAt = page.indexOf("let server = await getOrderStatusFromServer(id);");
  const noticeAt = page.indexOf('setNotice("Test payment successful. Your order is confirmed.")');
  assert.ok(fetchAt > 0 && noticeAt > fetchAt, "the notice is set after the server check, not from the URL");
  assert.ok(
    page.includes('server.paymentStatus === "paid"'),
    "the notice is gated on the server returning paid",
  );
});

test("order detail page derives the failed-payment notice from the order's own state", () => {
  // The "still pending payment" guidance the smoke suite expects
  // is back — but NOT from a query string: it is the shownNotice
  // fallback for an order that is itself pending_payment with a
  // failed paymentStatus (written by the test-pay action, or
  // adopted from the server). A forged "failed" claim grants
  // nothing, so no corroboration is needed for this notice; the
  // success notice above it still requires the server.
  const page = readSource("app/orders/[id]/page.tsx");
  assert.ok(
    page.includes('order.status === "pending_payment" && order.paymentStatus === "failed"'),
    "the failed notice is keyed on the order's own failed state",
  );
  assert.ok(
    page.includes("Test payment failed. Your order is still pending payment."),
    "the failed notice text is present",
  );
  // The notice text sits in the shownNotice derivation, after the
  // transient notice and the cancel outcome — it is not set from
  // any query-string effect.
  const shownAt = page.indexOf("const shownNotice =");
  const failedAt = page.indexOf("Test payment failed. Your order is still pending payment.");
  assert.ok(shownAt > 0 && failedAt > shownAt, "the failed notice lives in the shownNotice derivation");
  assert.ok(!page.includes('searchParams.get("payment")'), "still no ?payment= read anywhere");
});

test("order detail page falls back to the buyerToken proof for guests", () => {
  // getOrderStatusFromServer() requires a signed-in session, so it
  // always returns null for guests — without a fallback a guest who
  // paid saw "Pending payment" forever after the ?payment= removal.
  // The reconciliation falls back to getGuestOrderStatusFromServer
  // with the token the guest's own copy carries, and only when the
  // signed-in read returned null.
  const page = readSource("app/orders/[id]/page.tsx");
  assert.ok(
    page.includes('import { getGuestOrderStatusFromServer } from "@/lib/orders/server/guest-status"'),
    "the page imports the guest-keyed read",
  );
  assert.ok(
    page.includes("getGuestOrderStatusFromServer(id, browserOrder.buyerToken)"),
    "the fallback passes the copy's buyerToken",
  );
  const signedAt = page.indexOf("let server = await getOrderStatusFromServer(id);");
  const guestAt = page.indexOf("getGuestOrderStatusFromServer(id, browserOrder.buyerToken)");
  assert.ok(signedAt > 0 && guestAt > signedAt, "the guest read runs after the signed-in read");
  assert.ok(
    page.includes("if (!server && browserOrder.buyerToken)"),
    "the fallback runs only when the signed-in read returned nothing",
  );
});

test("guest-keyed status read proves ownership with the buyerToken and returns server state only", () => {
  const mod = readSource("lib/orders/server/guest-status.ts");
  assert.ok(mod.includes('"use server"'), "the read is a server action");
  assert.ok(mod.includes("buyerTokenMatches(memoryOrder.buyerToken, buyerToken)"), "ownership is proved against the in-memory record's key");
  assert.ok(mod.includes("getOrderRecord(orderId)"), "the proof reads the in-memory record");
  assert.ok(mod.includes("loadOrder(admin, orderId)"), "the status comes from the database row");
  assert.ok(mod.includes("if (loaded.userId !== null) return null;"), "a signed-in user's row is never served as a guest order");
  assert.ok(!/\.update\(|\.insert\(|\.delete\(/.test(mod), "the read writes nothing");
  assert.ok(mod.includes("No database row (yet)"), "a missing DB row falls back to the in-memory record");
});

test("order detail page adopts a server payment only as a corroborated update", () => {
  const page = readSource("app/orders/[id]/page.tsx");
  assert.ok(
    page.includes("{ corroborated: true }"),
    "the reconciliation passes the corroboration flag to updateOrderStatus",
  );
});

test("test-pay page redirects to the plain order page, with no ?payment=", () => {
  const testPay = readSource("app/checkout/test-pay/page.tsx");
  // No redirect target carries a payment outcome any more (the
  // history comments may still name the old parameter).
  assert.ok(!/redirect\(`[^`]*\?payment=/.test(testPay), "no redirect target carries ?payment=");
  assert.ok(!testPay.includes("?payment=${"), "no interpolated ?payment= redirect");
  assert.ok(
    testPay.includes("redirect(`/orders/${orderId}`);"),
    "success and failure redirects land on the plain order page",
  );
  assert.ok(
    testPay.includes("?notice=refund"),
    "the owner-only refund direction redirect is kept",
  );
});
