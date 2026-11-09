// Inbox entries — TechShot.
//
// One job: turn the signed-in customer's own orders, their status
// history, and the store's broadcast announcements into the inbox
// list. Pure module, no imports beyond types, so tests can import
// the real rules directly (same pattern as lib/profile-rules.ts).
//
// Two real sources, merged newest-first:
//   (1) Admin broadcasts — rows from the `announcements` table
//       (migration 0009), read through listAnnouncementsForInbox
//       (lib/announcements-server.ts, request client, authenticated
//       SELECT policy). Title, body, kind, time. No targeting, no
//       scheduling, no fake entries.
//   (2) The customer's own order updates, from two places:
//       (a) the orders rows themselves (owner RLS, via
//           listSupabaseOrders): one "placed" entry per order (from
//           created_at) plus, when the row changed after placement,
//           one entry for its latest status (from updated_at);
//       (b) the audit_log status history for the customer's OWN
//           orders only (lib/inbox-server.ts
//           listOwnOrderStatusHistory): audit_log is admin-only
//           under RLS, so the browser can never read it — the
//           server action reads it with the service-role client,
//           scoped to the caller's own order ids, and returns only
//           parsed { oldStatus, newStatus, at } rows (never
//           actor_id, never the raw action). The audit action
//           strings are structured —
//           `order.status:<old>-><new> (source)` — so they parse
//           reliably; anything else is ignored. Audit writes are
//           best-effort, so a missing audit row never loses an
//           update: the orders-row entry (a) covers the latest
//           status whenever no audit row records it.
//
// Per order the inbox therefore shows: placed, then each recorded
// status step in order, newest first — but never a step the data
// does not support, and never more than the orders-row fallback
// when the audit trail is silent. There is no notifications table
// beyond announcements, and no read/unread storage: the inbox
// lists messages with their time and shows no unread count.
//
// Entries are newest first. Nothing here is sample, demo or
// show-only: an order with no later update yields exactly one
// entry, and no orders and no announcements yields no entries.

import type { OrderStatus, StoredOrder } from "./checkout/types";
import type { Announcement, AnnouncementKind } from "./announcements";

export type InboxEntryKind = "placed" | "status";

export interface InboxEntry {
  /** Stable id: "<order id>:placed" or "<order id>:status". */
  id: string;
  orderId: string;
  orderNumber: string;
  kind: InboxEntryKind;
  title: string;
  detail: string;
  status: OrderStatus;
  total_poisha: number;
  itemCount: number;
  /** ISO timestamp the entry is dated by (created_at / updated_at). */
  at: string;
}

export const INBOX_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Pending payment",
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
  returned: "Returned",
};

export function inboxStatusLabel(status: string): string {
  return (
    (INBOX_STATUS_LABELS as Record<string, string>)[status] ?? status
  );
}

function itemSummary(order: StoredOrder): string {
  const titles = order.items.map((item) => item.title).filter(Boolean);
  const shown = titles.slice(0, 2).join(", ");
  const extra = titles.length > 2 ? ` and ${titles.length - 2} more` : "";
  const count = `${order.items.length} item${order.items.length === 1 ? "" : "s"}`;
  return shown ? `${count} — ${shown}${extra}` : count;
}

/**
 * One parsed audit_log status step for a customer's own order.
 * Produced server-side (lib/inbox-server.ts) from the structured
 * audit action string; the raw row never reaches the browser.
 */
export interface OrderStatusAudit {
  orderId: string;
  oldStatus: string;
  newStatus: string;
  /** ISO timestamp of the audit row (created_at). */
  at: string;
}

/**
 * Parse one audit_log row into an OrderStatusAudit, or null when
 * the row is not a status change in the shape the order actions
 * write: action `order.status:<old>-><new>` with an optional
 * ` (source)` suffix, entity_id the order id, created_at the time.
 * Anything else (other entity types, other actions, missing or
 * unparseable fields) is ignored — never rendered, never guessed.
 */
export function parseOrderStatusAudit(row: {
  entity_id: unknown;
  action: unknown;
  created_at: unknown;
}): OrderStatusAudit | null {
  if (
    typeof row.entity_id !== "string" ||
    row.entity_id === "" ||
    typeof row.action !== "string" ||
    typeof row.created_at !== "string" ||
    Number.isNaN(Date.parse(row.created_at))
  ) {
    return null;
  }
  const match = /^order\.status:([a-z_]+)->([a-z_]+)(?: \(.*\))?$/.exec(
    row.action,
  );
  if (!match) return null;
  return {
    orderId: row.entity_id,
    oldStatus: match[1] as string,
    newStatus: match[2] as string,
    at: row.created_at,
  };
}

/**
 * Build the inbox entries for a list of the customer's own orders,
 * enriched with their audit_log status history when available.
 * Per order: one "placed" entry (created_at), one entry per audit
 * step (each records the real from -> to transition and its time),
 * and an orders-row "latest status" entry (updated_at) ONLY when
 * no audit row records the order's current status — the fallback
 * for audit gaps (best-effort writes) and for browser-local orders
 * with no audit trail at all. Newest first. Pure: no fetching, no
 * storage, no invented events.
 */
export function buildInboxEntries(
  orders: StoredOrder[],
  audits: OrderStatusAudit[] = [],
): InboxEntry[] {
  const entries: InboxEntry[] = [];
  const auditsByOrder = new Map<string, OrderStatusAudit[]>();
  for (const audit of audits) {
    const list = auditsByOrder.get(audit.orderId) ?? [];
    list.push(audit);
    auditsByOrder.set(audit.orderId, list);
  }
  for (const order of orders) {
    const created = Date.parse(order.createdAt);
    const updated = Date.parse(order.updatedAt);
    entries.push({
      id: `${order.id}:placed`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      kind: "placed",
      title: `Order ${order.orderNumber} placed`,
      detail: itemSummary(order),
      status: order.status,
      total_poisha: order.total_poisha,
      itemCount: order.items.length,
      at: order.createdAt,
    });
    const orderAudits = (auditsByOrder.get(order.id) ?? []).filter(
      (audit) => !Number.isNaN(Date.parse(audit.at)),
    );
    for (const audit of orderAudits) {
      const newLabel = inboxStatusLabel(audit.newStatus);
      const oldLabel = inboxStatusLabel(audit.oldStatus);
      entries.push({
        id: `${order.id}:status:${audit.at}:${audit.newStatus}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        kind: "status",
        title: `Order ${order.orderNumber} — ${newLabel}`,
        detail: `Your order moved from ${oldLabel.toLowerCase()} to ${newLabel.toLowerCase()}.`,
        status: audit.newStatus as OrderStatus,
        total_poisha: order.total_poisha,
        itemCount: order.items.length,
        at: audit.at,
      });
    }
    // Orders-row fallback: a later updated_at means the order row
    // changed after placement (the updated_at trigger fires on
    // UPDATE, not on INSERT). It is only needed when the audit
    // trail does NOT already record the order's current status —
    // otherwise the audit entry above says the same thing with
    // the true transition time, and a second entry would be a
    // duplicate. NaN timestamps never produce a status entry:
    // without a valid later timestamp there is no evidence of a
    // change.
    const auditCoversLatest = orderAudits.some(
      (audit) => audit.newStatus === order.status,
    );
    if (
      !auditCoversLatest &&
      !Number.isNaN(created) &&
      !Number.isNaN(updated) &&
      updated > created
    ) {
      const label = inboxStatusLabel(order.status);
      entries.push({
        id: `${order.id}:status`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        kind: "status",
        title: `Order ${order.orderNumber} — ${label}`,
        detail: `Your order is now ${label.toLowerCase()}.`,
        status: order.status,
        total_poisha: order.total_poisha,
        itemCount: order.items.length,
        at: order.updatedAt,
      });
    }
  }
  // Newest first; on a tie the status entry sorts before the placed
  // entry for the same order (a tie cannot happen for one order —
  // the status entry needs updated > created — but the rule keeps
  // the order deterministic across orders too).
  return entries.sort((a, b) => {
    const ta = Date.parse(a.at);
    const tb = Date.parse(b.at);
    const byTime =
      (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
    if (byTime !== 0) return byTime;
    if (a.kind === b.kind) return 0;
    return a.kind === "status" ? -1 : 1;
  });
}

/** One broadcast announcement as an inbox item. */
export interface AnnouncementInboxItem {
  id: string;
  source: "announcement";
  title: string;
  /** The announcement body, shown in full. */
  detail: string;
  kind: AnnouncementKind;
  at: string;
}

/** One row of the merged inbox: an order entry or an announcement. */
export type InboxItem =
  | ({ source: "order" } & InboxEntry)
  | AnnouncementInboxItem;

/**
 * Merge the order entries with the store's broadcast announcements
 * into one list, newest first. Announcements carry no order, so
 * they render without an order link. On a timestamp tie an
 * announcement sorts first (deterministic, not meaningful).
 */
export function mergeInboxItems(
  entries: InboxEntry[],
  announcements: Announcement[],
): InboxItem[] {
  const items: InboxItem[] = [
    ...entries.map((entry) => ({ ...entry, source: "order" as const })),
    ...announcements.map((announcement) => ({
      id: `announcement:${announcement.id}`,
      source: "announcement" as const,
      title: announcement.title,
      detail: announcement.body,
      kind: announcement.kind,
      at: announcement.createdAt,
    })),
  ];
  return items.sort((a, b) => {
    const ta = Date.parse(a.at);
    const tb = Date.parse(b.at);
    const byTime =
      (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
    if (byTime !== 0) return byTime;
    if (a.source === b.source) return 0;
    return a.source === "announcement" ? -1 : 1;
  });
}
