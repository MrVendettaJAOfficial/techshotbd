// TechShot marketplace — admin dashboard stats.
//
// SERVER ONLY. Reads live counts with the service-role client (the
// admin dashboard needs draft / paused products and every order,
// which the anon client cannot see). Never throws: when Supabase is
// not configured, or any query fails, it returns all zeros — the
// same pattern as lib/products/queries.ts fetchAllProducts(), which
// returns empty lists with configured: false instead of leaking
// configuration details. The caller shows the dashboard with zeros
// in that case, exactly like the product list does.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/server";

export interface AdminStats {
  totalProducts: number;
  totalOrders: number;
  delivered: number;
  notDelivered: number;
  paid: number;
  unpaid: number;
  returned: number;
}

export const EMPTY_ADMIN_STATS: AdminStats = {
  totalProducts: 0,
  totalOrders: 0,
  delivered: 0,
  notDelivered: 0,
  paid: 0,
  unpaid: 0,
  returned: 0,
};

/**
 * The Supabase Database generic resolves query results to `never`
 * with the installed supabase-js version (see lib/orders-server.ts),
 * so this file talks to the untyped client. Runtime behaviour is
 * unchanged.
 */
function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

/**
 * Dashboard counts for /admin:
 *   - delivered    = orders with status "delivered"
 *   - notDelivered = orders not delivered and not cancelled (includes
 *     returned / refunded / pending and in-flight orders)
 *   - paid         = orders with at least one payments row with
 *     status "paid" (deduplicated by order — an order with two paid
 *     attempts still counts once)
 *   - unpaid       = orders with no paid payments row
 *     (totalOrders - paid)
 *   - returned     = orders with status "returned"
 * Returns all zeros when Supabase is not configured or a query
 * fails. Never throws.
 */
export async function getAdminStats(): Promise<AdminStats> {
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    return { ...EMPTY_ADMIN_STATS };
  }
  try {
    const [productCount, orderRows, paidRows] = await Promise.all([
      admin.from("products").select("id", { count: "exact", head: true }),
      admin.from("orders").select("id, status"),
      admin.from("payments").select("order_id").eq("status", "paid"),
    ]);
    if (productCount.error || orderRows.error || paidRows.error) {
      return { ...EMPTY_ADMIN_STATS };
    }
    const orders = (orderRows.data ?? []) as Array<{ id: string; status: string }>;
    const totalOrders = orders.length;
    let delivered = 0;
    let cancelled = 0;
    let returned = 0;
    for (const order of orders) {
      if (order.status === "delivered") delivered += 1;
      else if (order.status === "cancelled") cancelled += 1;
      else if (order.status === "returned") returned += 1;
    }
    const paidOrderIds = new Set(
      ((paidRows.data ?? []) as Array<{ order_id: string }>).map((row) => row.order_id),
    );
    const paid = paidOrderIds.size;
    return {
      totalProducts: productCount.count ?? 0,
      totalOrders,
      delivered,
      notDelivered: totalOrders - delivered - cancelled,
      paid,
      unpaid: Math.max(0, totalOrders - paid),
      returned,
    };
  } catch {
    return { ...EMPTY_ADMIN_STATS };
  }
}
