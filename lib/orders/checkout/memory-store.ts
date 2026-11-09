// In-memory order store (lib/orders.ts). One job: the preview-only
// module-level order Map — the fallback for guests and for
// unconfigured Supabase. Signed-in users get real Supabase orders
// instead (lib/orders-server.ts); production must use the database.

import type { StoredOrder } from "@/lib/checkout-store";

// ---------------------------------------------------------------------------
// In-memory order store (preview only — see header note). Production must
// use Supabase orders / cart_items in a database transaction.
// ---------------------------------------------------------------------------

const memoryOrders = new Map<string, StoredOrder>();

export function createOrderRecord(order: StoredOrder): StoredOrder {
  memoryOrders.set(order.id, order);
  return order;
}

export function getOrderRecord(id: string): StoredOrder | null {
  return memoryOrders.get(id) ?? null;
}

export function listOrderRecords(): StoredOrder[] {
  return [...memoryOrders.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function updateOrderRecordStatus(
  id: string,
  patch: Partial<Pick<StoredOrder, "status" | "paymentStatus">>,
): StoredOrder | null {
  const order = memoryOrders.get(id);
  if (!order) return null;
  const updated: StoredOrder = { ...order, ...patch, updatedAt: new Date().toISOString() };
  memoryOrders.set(id, updated);
  return updated;
}
