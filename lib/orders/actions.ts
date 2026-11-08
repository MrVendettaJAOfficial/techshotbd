// TechShot marketplace — admin order server actions (admin only).
//
// Single-seller store: the owner (role "admin", granted manually in
// the database) is the only person who may move an order through its
// fulfilment flow. These run on the server only and are the
// enforcement point for order status writes, following the same
// pattern as lib/products/actions.ts:
//
//   * Unauthenticated -> generic error.
//   * role must be "admin" (customers cannot change order status).
//   * The transition itself is validated by lib/orders/transitions.ts
//     (one step forward, cancel only from pending_payment /
//     confirmed, refund only from a paid order) — never trust the
//     status the browser asked for.
//   * Every change writes an audit_log row (actor, order id, old and
//     new status in the action string — audit_log has no details
//     column) and revalidates /admin, /orders and /orders/[id], so
//     the customer order page moves as soon as the admin advances it.
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
import { checkAdminRole, isLegalOrderTransition, nextOrderStatus } from "./transitions";
import type { OrderStatus, PaymentStatus } from "@/lib/checkout-store";

const GENERIC_ERROR = "Something went wrong. Please try again.";

export type OrderStatusActionResult =
  | {
      ok: true;
      orderNumber: string;
      oldStatus: OrderStatus;
      newStatus: OrderStatus;
    }
  | { ok: false; error: string };

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
}

/** Load an order plus its latest payment status, or null when it does not exist. */
async function loadOrder(admin: AdminClient, orderId: string): Promise<LoadedOrder | null> {
  const { data: order, error } = await admin
    .from("orders")
    .select("id, order_number, status")
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
  };
}

/** Audit row for a status change. Best effort, like lib/products/actions.ts. */
async function writeAudit(
  admin: AdminClient,
  actorId: string,
  orderId: string,
  oldStatus: OrderStatus,
  newStatus: OrderStatus,
): Promise<void> {
  try {
    await admin.from("audit_log").insert({
      actor_id: actorId,
      action: `order.status:${oldStatus}->${newStatus}`,
      entity_type: "order",
      entity_id: orderId,
    });
  } catch {
    // Audit failure must not fail the order write or leak details.
  }
}

function revalidateOrderPages(orderId: string): void {
  revalidatePath("/admin");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
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

  const { error } = await admin
    .from("orders")
    .update({ status: target })
    .eq("id", order.id);
  if (error) return { ok: false, error: GENERIC_ERROR };

  // A refund also closes the payment row, so the customer order page
  // and any later refund check agree the order was refunded.
  if (target === "refunded") {
    try {
      const { data: payment } = await admin
        .from("payments")
        .select("id")
        .eq("order_id", order.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (payment) {
        await admin.from("payments").update({ status: "refunded" }).eq("id", payment.id);
      }
    } catch {
      // Order status already updated; payment row is best effort.
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
