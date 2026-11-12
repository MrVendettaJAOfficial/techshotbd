// TechShot marketplace — admin order server actions (admin only) +
// customer cancel (owner only).
//
// Single-seller store: the owner (role "admin", granted manually in
// the database) and co-admins (role "co_admin") are the only people
// who may move an order through its fulfilment flow; managers (role
// "manager") may NOT change orders — a manager calling any of these
// actions gets an error, never a silent success (see
// lib/roles.ts canChangeOrders, enforced in changeOrderStatus
// below). These run on the server only and are the enforcement
// point for order status writes, following the same pattern as
// lib/products/actions.ts:
//
//   * Unauthenticated -> generic error.
//   * role must allow order changes (owner / co_admin —
//     lib/roles.ts canChangeOrders). Customers cannot change order
//     status, except through cancelMyOrder below, which is
//     owner-only; managers cannot change orders at all.
//   * The transition itself is validated by lib/orders/transitions.ts
//     (one step forward, cancel only from pending_payment /
//     confirmed, refund only from a paid order, returned only from
//     confirmed / processing / shipped) — never trust the status
//     the browser asked for.
//   * Status writes are CONDITIONAL: the update only lands when the
//     order still holds the status we read (.eq("status", oldStatus)),
//     and 0 rows affected means another writer moved first — the
//     caller is told to reload, and no audit row and no stock restore
//     happen. A conditional update alone cannot stop a double-clicked
//     Advance: the second call runs after the first has landed, so
//     "advance from the new status" is a legal next step and it would
//     move a second step. That is why advanceOrderStatus also takes
//     the status the caller RENDERED (expectedStatus): a replayed or
//     second-tab advance fails that check instead of moving a second
//     step. The per-component in-flight ref in the admin orders list
//     is only the first, same-tab line of defence.
//     A lost race restores no stock.
//   * Cancel / refund / returned restore stock (lib/orders/stock.ts)
//     AFTER the conditional update succeeds, so a failed or
//     lost-race change restores nothing. A refund calls
//     PaymentAdapter.refund() FIRST and only marks the order refunded
//     when the adapter succeeds; a paid order is never "cancelled"
//     (which would keep the money) — it must be refunded instead.
//     A paid order marked "returned" refunds the same way first:
//     the adapter is called before the status change and the money
//     goes back through the same append-only payments row, while
//     the order itself lands on "returned" (not "refunded"). An
//     unpaid returned order skips the adapter — there is nothing
//     to refund — and just restores stock.
//   * Every change writes an audit_log row (actor, order id, old and
//     new status in the action string — audit_log has no details
//     column) and revalidates /admin, /orders and /orders/[id], so
//     the customer order page moves as soon as the admin advances it.
//   * Payment attempts are append-only: a refund INSERTS a new
//     payments row with status "refunded" and never overwrites the
//     paid row, so the attempt history survives.
//
// Errors returned to the client are generic on purpose: never a stack
// trace, SQL, or table name, and never which environment variable is
// missing when Supabase is not configured.
//
// Shared engine for the order server actions below: role-gated,
// conditional status changes with adapter-first refunds, stock
// restore and audit (see lib/orders/actions.ts barrel).

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/server";
import { revalidateCatalogCache } from "@/lib/storefront-cache";
import { getCallerRole, getCurrentUser } from "@/lib/auth-server";
import { testAdapter } from "@/lib/payments/test-adapter";
import { restoreOrderStock } from "../stock";
import { checkOrderRole, isLegalOrderTransition } from "../transitions";
import type { OrderStatus, PaymentStatus } from "@/lib/checkout-store";

export const GENERIC_ERROR = "Something went wrong. Please try again.";
export const ALREADY_CHANGED_ERROR = "This order was already changed. Please reload and try again.";

export type OrderStatusActionResult =
  | {
      ok: true;
      orderNumber: string;
      oldStatus: OrderStatus;
      newStatus: OrderStatus;
    }
  | { ok: false; error: string };

export type CustomerCancelResult =
  | { ok: true; orderNumber: string }
  | { ok: false; error: string; localOnly?: boolean };

export const orderStatusSchema = z.enum([
  "pending_payment",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
  "returned",
]);

type AdminClient = SupabaseClient;

/**
 * The Supabase Database generic resolves query results to `never`
 * with the installed supabase-js version (see lib/orders-server.ts),
 * so this file talks to the untyped client. Runtime behaviour is
 * unchanged.
 */
function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

export function adminClient(): AdminClient | null {
  try {
    return untyped(createAdminClient());
  } catch {
    // Service role not configured: generic error, never say which
    // environment variable is missing.
    return null;
  }
}

export interface LoadedOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  userId: string | null;
}

/** Load an order plus its latest payment status, or null when it does not exist. */
export async function loadOrder(admin: AdminClient, orderId: string): Promise<LoadedOrder | null> {
  const { data: order, error } = await admin
    .from("orders")
    .select("id, order_number, status, user_id")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return null;
  let paymentStatus: PaymentStatus = "unpaid";
  try {
    const { data: payment } = await admin
      .from("payments")
      .select("status")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (payment?.status === "paid") paymentStatus = "paid";
    else if (payment?.status === "failed") paymentStatus = "failed";
    else if (payment?.status === "refunded") paymentStatus = "refunded";
  } catch {
    // No payment row (e.g. COD, not yet paid) means unpaid.
  }
  return {
    id: order.id as string,
    orderNumber: (order.order_number as string) ?? "",
    status: order.status as OrderStatus,
    paymentStatus,
    userId: (order.user_id as string | null) ?? null,
  };
}

export interface PaidPaymentRow {
  id: string;
  amount_poisha: number;
  provider: string;
}

/** The latest PAID payment attempt for an order, or null. */
export async function loadLatestPaidPayment(
  admin: AdminClient,
  orderId: string,
): Promise<PaidPaymentRow | null> {
  try {
    const { data: payment } = await admin
      .from("payments")
      .select("id, amount_poisha, provider")
      .eq("order_id", orderId)
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!payment) return null;
    return {
      id: payment.id as string,
      amount_poisha: typeof payment.amount_poisha === "number" ? payment.amount_poisha : 0,
      provider: (payment.provider as string) ?? "test",
    };
  } catch {
    return null;
  }
}

/**
 * Audit row for a status change. Best effort — an audit failure must
 * not fail the order write — but unlike before it is VISIBLE
 * server-side: a failed insert is logged with console.error (server
 * log only, never to the client), so a silent audit gap is noticed.
 * The insert stays immediately after the status update it records,
 * so the two cannot drift apart across a long function.
 */
export async function writeAudit(
  admin: AdminClient,
  actorId: string | null,
  orderId: string,
  oldStatus: OrderStatus,
  newStatus: OrderStatus,
  source?: string,
): Promise<void> {
  try {
    const { error } = await admin.from("audit_log").insert({
      actor_id: actorId,
      action: `order.status:${oldStatus}->${newStatus}${source ? ` (${source})` : ""}`,
      entity_type: "order",
      entity_id: orderId,
    });
    if (error) {
      console.error("TechShot audit_log insert failed:", error.message);
    }
  } catch (error) {
    console.error(
      "TechShot audit_log insert failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

export function revalidateOrderPages(orderId: string): void {
  revalidatePath("/admin");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  // A cancel / refund / returned restores stock (see
  // restoreStockAfterStatusChange above), and stock is
  // catalogue-visible data — purge the "catalog" tag too, or the
  // storefront would keep showing the pre-restore stock. Every
  // status change purges, even those that do not touch stock: the
  // volume is tiny, and missing a restore would be worse than a
  // one-time re-fetch on the next storefront visit.
  revalidateCatalogCache();
}

/**
 * Restore stock for a cancelled / refunded / returned order. Only ever called
 * AFTER the conditional status update has succeeded, so a failed or
 * lost-race change restores nothing. Lines that cannot be attributed
 * to a stock row are logged server-side (see lib/orders/stock.ts).
 */
export async function restoreStockAfterStatusChange(
  admin: AdminClient,
  orderId: string,
): Promise<void> {
  try {
    const { restored, skipped } = await restoreOrderStock(admin, orderId);
    if (skipped > 0) {
      console.error(
        `TechShot stock restore for order ${orderId}: ${restored} line(s) restored, ${skipped} line(s) could not be attributed to a stock row.`,
      );
    }
  } catch (error) {
    console.error(
      `TechShot stock restore for order ${orderId} failed:`,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

export async function changeOrderStatus(
  orderId: string,
  resolveTarget: (order: LoadedOrder) => OrderStatus | { error: string },
): Promise<OrderStatusActionResult> {
  if (typeof orderId !== "string" || orderId.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }

  const user = await getCurrentUser();
  // The role is re-read from the caller's profiles row (never from
  // the browser): owner and co-admin may change orders, a manager
  // may not. getCallerRole falls back to the session user's role
  // when the profiles row cannot be read, so a missing row is
  // treated as a customer, never as staff.
  const gate = checkOrderRole((await getCallerRole()) ?? user?.role ?? null);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!user) return { ok: false, error: GENERIC_ERROR };

  const admin = adminClient();
  if (!admin) return { ok: false, error: GENERIC_ERROR };

  const order = await loadOrder(admin, orderId);
  if (!order) return { ok: false, error: "Order not found." };

  const resolved = resolveTarget(order);
  if (typeof resolved === "object") return { ok: false, error: resolved.error };
  const target = resolved;

  if (!isLegalOrderTransition(order.status, target, order.paymentStatus)) {
    return { ok: false, error: "That status change is not allowed." };
  }
  // A paid order must be refunded, never cancelled: cancelling would
  // leave the customer charged with no money returned.
  if (target === "cancelled" && order.paymentStatus === "paid") {
    return { ok: false, error: "A paid order cannot be cancelled. Refund it instead." };
  }

  // Refund: call the payment adapter FIRST. Only when it succeeds is
  // the order marked refunded. A failed gateway refund changes no rows.
  // (The test adapter moves no real money; a real gateway adapter must
  // call the provider's refund API here.)
  //
  // A paid order marked "returned" refunds through this exact same
  // path — the adapter call, the paid-payment lookup and the
  // append-only payments row below are shared, not duplicated — the
  // only difference is the status the order lands on ("returned"
  // instead of "refunded"). An unpaid returned order needs no refund
  // and skips this block entirely.
  const needsRefund = target === "refunded" || (target === "returned" && order.paymentStatus === "paid");
  let paidPayment: PaidPaymentRow | null = null;
  if (needsRefund) {
    paidPayment = await loadLatestPaidPayment(admin, order.id);
    if (!paidPayment) {
      return { ok: false, error: "That status change is not allowed." };
    }
    let refund: { ok: boolean };
    try {
      refund = await testAdapter.refund(paidPayment.id, paidPayment.amount_poisha);
    } catch {
      refund = { ok: false };
    }
    if (!refund.ok) {
      return { ok: false, error: GENERIC_ERROR };
    }
  }

  // Conditional update: only lands when the order still holds the
  // status we validated against. 0 rows affected means another writer
  // already moved it — report that generically and change nothing else.
  const { data: updated, error } = await admin
    .from("orders")
    .update({ status: target })
    .eq("id", order.id)
    .eq("status", order.status)
    .select("id");
  if (error) return { ok: false, error: GENERIC_ERROR };
  if (!Array.isArray(updated) || updated.length !== 1) {
    return { ok: false, error: ALREADY_CHANGED_ERROR };
  }

  // Cancel / refund / returned (including a refund from delivered —
  // the returns flow, and a paid return, which refunded first above)
  // restores stock, guarded by the successful update above.
  if (target === "cancelled" || target === "refunded" || target === "returned") {
    await restoreStockAfterStatusChange(admin, order.id);
  }

  // A refund INSERTS a new payments row (append-only attempts) — it
  // never overwrites the paid row, so the attempt history survives.
  // A paid return inserts the same row: the money went back, so the
  // payments history records a refund even though the order status
  // is "returned".
  if (needsRefund && paidPayment) {
    try {
      const { error: paymentError } = await admin.from("payments").insert({
        order_id: order.id,
        provider: paidPayment.provider,
        provider_reference: `refund-${paidPayment.id}`,
        amount_poisha: paidPayment.amount_poisha,
        status: "refunded",
      });
      if (paymentError) {
        console.error("TechShot refund payment row insert failed:", paymentError.message);
      }
    } catch (error) {
      console.error(
        "TechShot refund payment row insert failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  await writeAudit(admin, user.id, order.id, order.status, target);
  revalidateOrderPages(order.id);
  return { ok: true, orderNumber: order.orderNumber, oldStatus: order.status, newStatus: target };
}
