import { NextResponse } from "next/server";
import { z } from "zod";
import {
  adapterStatusToOutcome,
  applyPaymentOutcome,
  getOrderRecord,
  updateOrderRecordStatus,
} from "@/lib/orders";
import { testAdapter } from "@/lib/payments/test-adapter";

// POST /api/payments/callback — test-gateway callback endpoint.
// Body: { orderId, status, signature }. "status" is "paid" (the adapter's
// word) or "success" (the checkout UI's word) for a paid order, or
// "failed" / "cancelled". The signature is verified with the test
// adapter's HMAC check (testAdapter.verifyCallback). Errors are
// deliberately generic — no internals are leaked.
//
// NOTE: verification fails closed when TEST_PAYMENT_SIGNING_SECRET is not
// configured (see .env.example). Set it in .env.local before exercising
// this endpoint, or every callback returns 400 "Invalid callback".
const callbackSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["success", "paid", "failed", "cancelled"]),
  signature: z.string().min(1),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid callback" }, { status: 400 });
  }

  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid callback" }, { status: 400 });
  }

  const { orderId, signature } = parsed.data;
  const adapterStatus = parsed.data.status === "success" ? "paid" : parsed.data.status;

  const order = getOrderRecord(orderId);
  if (!order) {
    // Same generic response whether the order exists or not.
    return NextResponse.json({ ok: false, error: "Invalid callback" }, { status: 400 });
  }

  const verified = await testAdapter.verifyCallback(
    { orderId, status: adapterStatus },
    signature,
  );
  if (!verified.valid) {
    return NextResponse.json({ ok: false, error: "Invalid callback" }, { status: 400 });
  }

  const outcome = adapterStatusToOutcome(adapterStatus);
  updateOrderRecordStatus(orderId, applyPaymentOutcome(outcome));
  return NextResponse.json({ ok: true, status: adapterStatus });
}
