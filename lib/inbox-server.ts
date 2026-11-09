// TechShot marketplace — inbox server reads: the customer's own
// order-status history from audit_log.
//
// SERVER ACTIONS ("use server"). One job: serve the audit_log half
// of the inbox's order updates.
//
// audit_log is admin-only under RLS (migration 0001 /
// policies.sql: the only policy is audit_log_admin_all, Owner
// only), so the browser can never read it — and no customer policy
// is added here, on purpose. Instead this server action reads it
// with the service-role client, scoped tightly:
//   1. the signed-in caller's own order ids are read first with
//      the request-scoped client (owner RLS on orders);
//   2. audit_log is then queried only for entity_type 'order' and
//      entity_id in that id list — the caller's own orders, nothing
//      else;
//   3. only the parsed { oldStatus, newStatus, at } of each row is
//      returned (lib/inbox.ts parseOrderStatusAudit). actor_id is
//      never selected, the raw action string never leaves the
//      server, and rows that are not structured status changes are
//      dropped.
//
// Audit writes are best-effort (see lib/orders/actions/shared.ts),
// so this can return fewer steps than the order went through —
// the inbox keeps its orders-row fallback (buildInboxEntries)
// for exactly that case. Empty when Supabase is not configured,
// nobody is signed in, or the caller has no orders. Never throws.

"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient, createClient } from "./supabase/server";
import { parseOrderStatusAudit, type OrderStatusAudit } from "./inbox";

/**
 * The Supabase Database generic resolves query results to `never`
 * with the installed supabase-js version (see lib/orders-server.ts),
 * so this file talks to the untyped client. Runtime behaviour is
 * unchanged.
 */
function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * The signed-in user's own order-status history, oldest first:
 * one parsed audit step per status change the audit trail
 * recorded for their orders. Only their orders are ever queried.
 */
export async function listOwnOrderStatusHistory(): Promise<OrderStatusAudit[]> {
  if (!isConfigured()) return [];
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  try {
    supabase = untyped(createClient());
    admin = untyped(createAdminClient());
  } catch {
    return [];
  }
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return [];
    const { data: orderRows, error: orderError } = await supabase
      .from("orders")
      .select("id")
      .eq("user_id", userId);
    if (orderError || !orderRows) return [];
    const orderIds = (orderRows as Array<{ id: unknown }>)
      .map((row) => String(row.id))
      .filter(Boolean);
    if (orderIds.length === 0) return [];
    const { data: auditRows, error: auditError } = await admin
      .from("audit_log")
      .select("entity_id, action, created_at")
      .eq("entity_type", "order")
      .in("entity_id", orderIds)
      .order("created_at", { ascending: true });
    if (auditError || !auditRows) return [];
    return (auditRows as Array<Record<string, unknown>>)
      .map((row) =>
        parseOrderStatusAudit({
          entity_id: row.entity_id,
          action: row.action,
          created_at: row.created_at,
        }),
      )
      .filter((audit): audit is OrderStatusAudit => audit !== null);
  } catch {
    return [];
  }
}
