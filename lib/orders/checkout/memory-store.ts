// In-memory order store (lib/orders.ts). One job: the preview-only
// order Map — the fallback for guests and for unconfigured
// Supabase. Signed-in users get real Supabase orders instead
// (lib/orders-server.ts); production must use the database.
//
// The Map lives on globalThis, NOT in module scope: in the
// production build, server actions and routes keep SEPARATE module
// instances — a server action imported by a client component (like
// cancelMyOrder, called from the order page) is bundled apart from
// the server components that created the record (checkout) — so a
// module-level Map would be one store per bundle. Proven
// 2026-11-16: a guest COD order placed through checkout had its
// record visible to the confirmation page (same bundle family) but
// INVISIBLE to the cancel action, so the buyerToken proof there
// failed closed even though the record existed. globalThis is one
// store per server process, so every bundle reads the same Map.
// (LateNine needed the same fix for its in-memory user/link maps:
// server actions and routes keep separate in-memory stores.)
// A restart still wipes it, and a request that lands on a
// different instance still misses — the payment callback falls
// back to the database for exactly that reason. This store is
// only ever a fallback, never the source of truth.

import type { StoredOrder } from "@/lib/checkout-store";

type MemoryOrderStore = Map<string, StoredOrder>;

/** The one order Map for this server process, shared by every
 *  bundle through globalThis (see the header note). */
function memoryOrders(): MemoryOrderStore {
  const holder = globalThis as unknown as { __techshotMemoryOrders?: MemoryOrderStore };
  return (holder.__techshotMemoryOrders ??= new Map<string, StoredOrder>());
}

export function createOrderRecord(order: StoredOrder): StoredOrder {
  memoryOrders().set(order.id, order);
  return order;
}

export function getOrderRecord(id: string): StoredOrder | null {
  return memoryOrders().get(id) ?? null;
}

export function listOrderRecords(): StoredOrder[] {
  return [...memoryOrders().values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function updateOrderRecordStatus(
  id: string,
  patch: Partial<Pick<StoredOrder, "status" | "paymentStatus">>,
): StoredOrder | null {
  const orders = memoryOrders();
  const order = orders.get(id);
  if (!order) return null;
  const updated: StoredOrder = { ...order, ...patch, updatedAt: new Date().toISOString() };
  orders.set(id, updated);
  return updated;
}
