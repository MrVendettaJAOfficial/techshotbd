// TechShot marketplace — admin order server actions (admin only) +
// customer cancel (owner only).
//
// Single-seller store: the owner (role "admin", granted manually in
// the database) is the only person who may move an order through its
// fulfilment flow. These run on the server only and are the
// enforcement point for order status writes, following the same
// pattern as lib/products/actions.ts:
//
//   * Unauthenticated -> generic error.
//   * role must be "admin" (customers cannot change order status,
//     except through cancelMyOrder below, which is owner-only).
//   * The transition itself is validated by lib/orders/transitions.ts
//     (one step forward, cancel only from pending_payment /
//     confirmed, refund only from a paid order) — never trust the
//     status the browser asked for.
//   * Status writes are CONDITIONAL: the update only lands when the
//     order still holds the status we read (.eq("status", oldStatus)),
//     and 0 rows affected means another writer moved first — the
//     caller is told to reload, and no audit row and no stock restore
//     happen. The conditional update stops LOST races, but it
//     cannot stop a double-clicked Advance on its own: the second
//     call runs after the first has landed, so "advance from the
//     new status" is a legal next step and it would move a second
//     step. The double-click guard lives in the client instead —
//     app/admin/AdminDashboard.tsx keeps a synchronous in-flight
//     ref, so the second invocation in the same task never reaches
//     the server. A lost race restores no stock.
//   * Cancel / refund restore stock (lib/orders/stock.ts) AFTER the
//     conditional update succeeds, so a failed or lost-race change
//     restores nothing. A refund calls PaymentAdapter.refund() FIRST
//     and only marks the order refunded when the adapter succeeds;
//     a paid order is never "cancelled" (which would keep the money)
//     — it must be refunded instead.
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

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth-server";
import { testAdapter } from "@/lib/payments/test-adapter";
import { restoreOrderStock } from "./stock";
import { checkAdminRole, isLegalOrderTransition, nextOrderStatus } from "./transitions";
import type { OrderStatus, PaymentStatus } from "@/lib/checkout-store";

const GENERIC_ERROR = "Something went wrong. Please try again.";
const ALREADY_CHANGED_ERROR = "This order was already changed. Please reload and try again.";

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

const orderStatusSchema = z.enum([
  "pending_payment",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
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

function adminClient(): AdminClient | null {
  try {
    return untyped(createAdminClient());
  } catch {
    // Service role not configured: generic error, never say which
    // environment variable is missing.
    return null;
  }
}

interface LoadedOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  userId: string | null;
}

/** Load an order plus its latest payment status, or null when it does not exist. */
async function loadOrder(admin: AdminClient, orderId: string): Promise<LoadedOrder | null> {
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

interface PaidPaymentRow {
  id: string;
  amount_poisha: number;
  provider: string;
}

/** The latest PAID payment attempt for an order, or null. */
async function loadLatestPaidPayment(
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
async function writeAudit(
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

function revalidateOrderPages(orderId: string): void {
  revalidatePath("/admin");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}

/**
 * Restore stock for a cancelled / refunded order. Only ever called
 * AFTER the conditional status update has succeeded, so a failed or
 * lost-race change restores nothing. Lines that cannot be attributed
 * to a stock row are logged server-side (see lib/orders/stock.ts).
 */
async function restoreStockAfterStatusChange(
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

async function changeOrderStatus(
  orderId: string,
  resolveTarget: (order: LoadedOrder) => OrderStatus | { error: string },
): Promise<OrderStatusActionResult> {
  if (typeof orderId !== "string" || orderId.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }

  const user = await getCurrentUser();
  const gate = checkAdminRole(user?.role ?? null);
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
  let paidPayment: PaidPaymentRow | null = null;
  if (target === "refunded") {
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

  // Cancel / refund (including a refund from delivered — the returns
  // flow) restores stock, guarded by the successful update above.
  if (target === "cancelled" || target === "refunded") {
    await restoreStockAfterStatusChange(admin, order.id);
  }

  // A refund INSERTS a new payments row (append-only attempts) — it
  // never overwrites the paid row, so the attempt history survives.
  if (target === "refunded" && paidPayment) {
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

/** Advance one order to the next step in the fulfilment flow. Admin only. */
export async function advanceOrderStatus(orderId: string): Promise<OrderStatusActionResult> {
  return changeOrderStatus(orderId, (order) => {
    const next = nextOrderStatus(order.status);
    if (!next) return { error: "This order cannot be advanced." };
    return next;
  });
}

/** Set an order to a specific valid status (cancel / refund). Admin only. */
export async function setOrderStatus(
  orderId: string,
  rawTarget: unknown,
): Promise<OrderStatusActionResult> {
  const parsed = orderStatusSchema.safeParse(rawTarget);
  if (!parsed.success) {
    return { ok: false, error: "Please choose a valid status." };
  }
  return changeOrderStatus(orderId, () => parsed.data);
}

/**
 * Cancel the signed-in customer's OWN order, live in Supabase.
 * Owner-only, and only from pending_payment / confirmed (the same
 * rule the admin path enforces). The conditional update, stock
 * restore and audit row are the same as the admin path; the customer
 * order page and the admin list both see the cancellation.
 *
 * A paid order cannot be cancelled this way — it must be refunded by
 * the admin, so the money is actually returned.
 *
 * When there is no live order to cancel (guest order, Supabase not
 * configured, or a browser-only order), the result carries
 * localOnly: true and the caller falls back to cancelling the browser
 * copy only — WITHOUT claiming stock was released, because no live
 * stock was touched.
 */
export async function cancelMyOrder(orderId: string): Promise<CustomerCancelResult> {
  if (typeof orderId !== "string" || orderId.trim() === "") {
    return { ok: false, error: GENERIC_ERROR };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: GENERIC_ERROR, localOnly: true };
  const admin = adminClient();
  if (!admin) return { ok: false, error: GENERIC_ERROR, localOnly: true };

  const order = await loadOrder(admin, orderId);
  if (!order) return { ok: false, error: GENERIC_ERROR, localOnly: true };
  if (order.userId !== user.id) {
    return { ok: false, error: GENERIC_ERROR };
  }
  if (order.status !== "pending_payment" && order.status !== "confirmed") {
    return { ok: false, error: "This order can no longer be cancelled." };
  }
  if (order.paymentStatus === "paid") {
    return {
      ok: false,
      error: "This order was already paid. Please contact us for a refund.",
    };
  }

  const { data: updated, error } = await admin
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", order.id)
    .eq("status", order.status)
    .select("id");
  if (error) return { ok: false, error: GENERIC_ERROR };
  if (!Array.isArray(updated) || updated.length !== 1) {
    return { ok: false, error: ALREADY_CHANGED_ERROR };
  }

  await restoreStockAfterStatusChange(admin, order.id);
  await writeAudit(admin, user.id, order.id, order.status, "cancelled", "customer-cancel");
  revalidateOrderPages(order.id);
  return { ok: true, orderNumber: order.orderNumber };
}
