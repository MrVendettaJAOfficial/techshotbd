// TechShot marketplace — TEST payment adapter.
// TEST MODE ONLY. This adapter simulates a payment gateway so checkout
// can be exercised end to end without real money. It never collects or
// stores real card / bank details, and it must never be used in
// production. A real gateway (bKash / Nagad / card / EMI) plugs in behind
// the same PaymentAdapter interface in lib/payments/index.ts — checkout
// code does not change, only the adapter wired in.
//
// How the test flow works:
//   1. createPayment() returns a redirect to /checkout/test-pay, where a
//      test page lets the developer pick paid / failed / cancelled.
//   2. That page posts a callback payload { orderId, status, timestamp,
//      nonce } plus an HMAC-SHA256 signature, computed server-side with
//      signTestCallback() over
//      "<orderId>:<status>:<timestamp>:<nonce>" with
//      TEST_PAYMENT_SIGNING_SECRET.
//   3. verifyCallback() recomputes the HMAC and only trusts the payload
//      when the signatures match (compared in constant time), the
//      timestamp is fresh (within CALLBACK_MAX_AGE_MS), and the nonce
//      has never been seen before. A replayed callback — the same signed
//      payload posted twice, or a payload whose signature was captured
//      and reused — is rejected, so a failed retry or a replayed failed
//      callback can never overwrite a paid record. Nonces are kept in
//      server-process memory (the same scope as the in-memory order
//      store in lib/orders.ts); a server restart clears them, which is
//      safe — it only makes previously seen nonces usable again after a
//      restart, never within a running process. A real gateway must
//      persist nonces / use its own idempotency keys instead.
//
// Breaking change (2026-11-08): payloads without timestamp + nonce
// are rejected. Old two-field signatures ("<orderId>:<status>") no
// longer verify — the HMAC input changed, so there is no legacy path
// that could weaken the check.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentAdapter,
  RefundResult,
  VerifyCallbackResult,
} from "./index";

/** Callbacks older than this are rejected, even with a valid signature. */
export const CALLBACK_MAX_AGE_MS = 5 * 60 * 1000;

const callbackPayloadSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["paid", "failed", "cancelled"]),
  timestamp: z.number().int(),
  nonce: z.string().min(8).max(64),
});

/** Nonces seen by this server process, with the time they were seen. */
const seenNonces = new Map<string, number>();

function pruneSeenNonces(now: number): void {
  for (const [nonce, seenAt] of seenNonces) {
    if (now - seenAt > CALLBACK_MAX_AGE_MS) seenNonces.delete(nonce);
  }
}

/** Test-only helper: clear the in-memory nonce store. */
export function clearSeenCallbackNoncesForTests(): void {
  seenNonces.clear();
}

function signingSecret(): string | undefined {
  return process.env.TEST_PAYMENT_SIGNING_SECRET;
}

/** True when the test-payment signing secret is configured. The
 *  test-pay page and the callback route fail CLOSED without it — no
 *  outcome is ever applied when this returns false. */
export function isTestPaymentSigningConfigured(): boolean {
  return Boolean(signingSecret());
}

/**
 * Compare a guest buyer token the caller presented against the one
 * stored on the order, in constant time when the lengths match.
 * False for a missing token on either side — a guest order with no
 * key, or a request with no key, never proves ownership.
 */
export function buyerTokenMatches(
  stored: string | null | undefined,
  submitted: string | null | undefined,
): boolean {
  if (!stored || !submitted) return false;
  const a = Buffer.from(submitted, "utf8");
  const b = Buffer.from(stored, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Pure signature + freshness check for a signed callback payload.
 * Recomputes the HMAC and compares it in constant time, and rejects
 * stale timestamps — exactly the verifyCallback checks, but WITHOUT
 * touching the nonce store: the nonce replay check stays at the
 * public callback route (verifyCallback consumes the nonce), while
 * test-pay mints a fresh nonce per click and needs only the
 * signature + freshness proof. Returns false (never throws) when
 * the secret is unset, the payload is malformed, the signature is
 * wrong or the timestamp is stale. Callers of
 * updateSupabaseOrderFromCallback pass this proof through; the
 * function verifies it itself before writing anything.
 */
export function verifyCallbackSignature(
  payload: { orderId: string; status: string; timestamp: number; nonce: string },
  signature: string,
): boolean {
  const parsed = callbackPayloadSchema.safeParse(payload);
  if (!parsed.success) return false;
  const secret = signingSecret();
  if (!secret) return false;
  if (Math.abs(Date.now() - parsed.data.timestamp) > CALLBACK_MAX_AGE_MS) return false;
  let expected: string;
  try {
    expected = signTestCallback(
      parsed.data.orderId,
      parsed.data.status,
      parsed.data.timestamp,
      parsed.data.nonce,
    );
  } catch {
    return false;
  }
  const given = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** Build a fresh signed-callback payload for an order + outcome. The
 *  caller signs it with signTestCallback() and posts the whole object;
 *  verifyCallback() checks the signature, the freshness and the nonce. */
export function createTestCallbackPayload(
  orderId: string,
  status: string,
): { orderId: string; status: string; timestamp: number; nonce: string } {
  return {
    orderId,
    status,
    timestamp: Date.now(),
    nonce: randomBytes(16).toString("hex"),
  };
}

/** HMAC-SHA256 over "<orderId>:<status>:<timestamp>:<nonce>". The ":"
 *  separators keep the fields unambiguous (so order "ab" + status "c"
 *  cannot collide with order "a" + status "bc"). Timestamp and nonce
 *  are required: a signature without them cannot be verified. */
export function signTestCallback(
  orderId: string,
  status: string,
  timestamp: number,
  nonce: string,
): string {
  const secret = signingSecret();
  if (!secret) {
    throw new Error("Test payment signing secret is not configured.");
  }
  if (!Number.isInteger(timestamp) || typeof nonce !== "string" || nonce.length < 8) {
    throw new Error("Test callback signing needs a timestamp and a nonce.");
  }
  return createHmac("sha256", secret)
    .update(`${orderId}:${status}:${timestamp}:${nonce}`)
    .digest("hex");
}

export class TestAdapter implements PaymentAdapter {
  async createPayment(
    order: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    const providerReference = `test-ref-${order.orderNumber}`;
    const key = order.buyerToken
      ? `&key=${encodeURIComponent(order.buyerToken)}`
      : "";
    return {
      paymentId: `test_${order.id}`,
      redirectUrl:
        `/checkout/test-pay?order=${encodeURIComponent(order.id)}` +
        `&ref=${encodeURIComponent(providerReference)}${key}`,
      providerReference,
    };
  }

  async verifyCallback(
    payload: unknown,
    signature: string,
  ): Promise<VerifyCallbackResult> {
    const parsed = callbackPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return { valid: false, orderId: "", status: "failed" };
    }
    const { orderId, status, timestamp, nonce } = parsed.data;

    const secret = signingSecret();
    if (!secret) {
      return { valid: false, orderId, status };
    }

    // Freshness: reject stale callbacks even with a valid signature.
    const now = Date.now();
    if (Math.abs(now - timestamp) > CALLBACK_MAX_AGE_MS) {
      return { valid: false, orderId, status };
    }
    // Replay: a nonce is accepted exactly once per server process.
    pruneSeenNonces(now);
    if (seenNonces.has(nonce)) {
      return { valid: false, orderId, status };
    }

    let expected: string;
    try {
      expected = signTestCallback(orderId, status, timestamp, nonce);
    } catch {
      return { valid: false, orderId, status };
    }

    const given = Buffer.from(signature, "utf8");
    const wanted = Buffer.from(expected, "utf8");
    const valid =
      given.length === wanted.length && timingSafeEqual(given, wanted);
    if (valid) seenNonces.set(nonce, now);
    return { valid, orderId, status };
  }

  async refund(
    paymentId: string,
    amount_poisha: number,
  ): Promise<RefundResult> {
    // Test mode: there is no real money to move, so a refund always
    // succeeds. The caller records it against the payments row; the
    // reference below is only for the test log, never a real transaction.
    // A real gateway adapter must call the provider's refund API here
    // and return ok: false when the provider refuses.
    if (typeof paymentId !== "string" || paymentId === "" || !(amount_poisha >= 0)) {
      return { ok: false };
    }
    return { ok: true };
  }
}

/** The single test adapter instance checkout code should use. */
export const testAdapter = new TestAdapter();
