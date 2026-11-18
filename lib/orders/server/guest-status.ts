"use server";

// Guest-keyed order status read (audit low 4 follow-on, 2026-11-18).
//
// Why this exists: getOrderStatusFromServer() requires a signed-in
// session, so for a guest it always returns null — a guest's browser
// copy could never adopt a server payment. That was tolerable while
// the ?payment= query parameter updated the guest copy on landing
// from test-pay, but low 4 deleted that effect (the parameter was
// forgeable), and from then on a guest who paid saw "Pending
// payment / Unpaid" with a Retry button forever, even though the
// database row was confirmed + paid. The order detail page falls
// back to this read when the signed-in read returns null and the
// browser copy carries a buyerToken.
//
// The proof is the buyerToken the guest's own copy carries, checked
// against the in-memory order record — the same proof the
// customer-cancel flow and /checkout/confirmation already rely on.
// The database keeps no guest key (there is no buyer_token column
// on orders), so this is the only proof available without a
// migration. The token is used ONLY to prove ownership: the status
// returned is always the server's (database row first, in-memory
// record when there is no row), never the browser copy's claims —
// so a forged copy cannot corroborate itself, and a forged
// "delivered" is overwritten by the server's real status.
//
// Limits, stated plainly: the proof needs the in-memory record,
// which lives in the serving server process. On a single server
// (preview, mock) it is always there; on multi-instance serverless
// the instance answering this read may not hold it, and the read
// returns null — the guest then sees the stale copy, exactly as
// before this file existed. The durable fix is a buyer_token column
// on orders (a migration, not built here).
//
// One job: read-only status for one guest order. No writes, no
// audit rows, no stock moves.

import { getOrderRecord } from "../../orders";
import { buyerTokenMatches } from "../../payments/test-adapter";
import { adminClient, loadOrder } from "../actions/shared";
import type { StoredOrder } from "../../checkout-store";

export async function getGuestOrderStatusFromServer(
  orderId: string,
  buyerToken: string | null,
): Promise<{
  status: StoredOrder["status"];
  paymentStatus: StoredOrder["paymentStatus"];
} | null> {
  if (typeof orderId !== "string" || orderId.trim() === "") return null;
  if (typeof buyerToken !== "string" || buyerToken === "") return null;

  // Prove ownership against the in-memory record's key. False for
  // a missing key on either side, and for a token that does not
  // match — a stranger's order id plus a guessed token answers
  // with null, never with the order's status.
  const memoryOrder = getOrderRecord(orderId);
  if (!memoryOrder || !buyerTokenMatches(memoryOrder.buyerToken, buyerToken)) {
    return null;
  }

  const admin = adminClient();
  if (!admin) {
    // Supabase is not configured: the in-memory record IS the
    // order, so its status is the only server state there is.
    return { status: memoryOrder.status, paymentStatus: memoryOrder.paymentStatus };
  }

  const loaded = await loadOrder(admin, orderId);
  if (!loaded) {
    // No database row (yet): the in-memory record is the order.
    return { status: memoryOrder.status, paymentStatus: memoryOrder.paymentStatus };
  }

  // A database row owned by a signed-in user is never a guest
  // order — the token proof above was against the memory record,
  // so re-check ownership against the row itself.
  if (loaded.userId !== null) return null;

  return { status: loaded.status, paymentStatus: loaded.paymentStatus };
}
