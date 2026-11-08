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
//   2. That page posts a callback payload { orderId, status } plus an
//      HMAC-SHA256 signature, computed server-side over
//      "<orderId>:<status>" with TEST_PAYMENT_SIGNING_SECRET.
//   3. verifyCallback() recomputes the HMAC and only trusts the payload
//      when the signatures match (compared in constant time).

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentAdapter,
  RefundResult,
  VerifyCallbackResult,
} from "./index";

const callbackPayloadSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["paid", "failed", "cancelled"]),
});

function signingSecret(): string | undefined {
  return process.env.TEST_PAYMENT_SIGNING_SECRET;
}

/** HMAC-SHA256 over "<orderId>:<status>". The ":" separator keeps the
 *  two fields unambiguous (so order "ab" + status "c" cannot collide
 *  with order "a" + status "bc"). */
export function signTestCallback(orderId: string, status: string): string {
  const secret = signingSecret();
  if (!secret) {
    throw new Error("Test payment signing secret is not configured.");
  }
  return createHmac("sha256", secret)
    .update(`${orderId}:${status}`)
    .digest("hex");
}

export class TestAdapter implements PaymentAdapter {
  async createPayment(
    order: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    const providerReference = `test-ref-${order.orderNumber}`;
    return {
      paymentId: `test_${order.id}`,
      redirectUrl:
        `/checkout/test-pay?order=${encodeURIComponent(order.id)}` +
        `&ref=${encodeURIComponent(providerReference)}`,
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
    const { orderId, status } = parsed.data;

    const secret = signingSecret();
    if (!secret) {
      return { valid: false, orderId, status };
    }

    let expected: string;
    try {
      expected = signTestCallback(orderId, status);
    } catch {
      return { valid: false, orderId, status };
    }

    const given = Buffer.from(signature, "utf8");
    const wanted = Buffer.from(expected, "utf8");
    const valid =
      given.length === wanted.length && timingSafeEqual(given, wanted);

    return { valid, orderId, status };
  }

  async refund(
    paymentId: string,
    amount_poisha: number,
  ): Promise<RefundResult> {
    // Test mode: there is no real money to move, so a refund always
    // succeeds. The caller records it against the payments row; the
    // reference below is only for the test log, never a real transaction.
    void paymentId;
    void amount_poisha;
    return { ok: true };
  }
}

/** The single test adapter instance checkout code should use. */
export const testAdapter = new TestAdapter();
