// Inbox page.
//
// Lists the signed-in user's REAL messages, newest first, from
// two sources and nothing else:
//   (1) Admin broadcasts — announcements sent by the store to all
//       users (lib/announcements-server.ts
//       listAnnouncementsForInbox; the `announcements` table,
//       migration 0009). Title, body, kind, time. No targeting,
//       no scheduling, no fake entries.
//   (2) The user's own order updates — via buildInboxEntries
//       (lib/inbox.ts): one "placed" entry per order (from
//       created_at), one entry per recorded status step from the
//       audit_log history of the user's OWN orders (server action
//       listOwnOrderStatusHistory — audit_log is admin-only under
//       RLS, so the server reads it scoped to the caller's order
//       ids), plus the orders-row latest-status fallback when the
//       audit trail is silent.
//
// The inbox requires sign-in: a signed-out visitor gets the same
// sign-in prompt as /account — and nothing else, not an empty
// inbox and no local-order entries. There is no read/unread
// storage (no reads table was added): messages are listed with
// their time and no unread count is shown.
//
// Data follows the /orders page pattern: browser-local orders
// first (the preview fallback), then the live Supabase orders for
// the signed-in user merged over them (listSupabaseOrders —
// request-scoped client, owner RLS). Announcements and audit
// history are fetched in parallel with the live orders.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CheckCircle2,
  Inbox as InboxIcon,
  Megaphone,
  Package,
  RotateCcw,
  Tag,
  Truck,
  XCircle,
} from "lucide-react";
import { formatBDT } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { listSupabaseOrders } from "@/lib/orders-server";
import { listAnnouncementsForInbox } from "@/lib/announcements-server";
import { listOwnOrderStatusHistory } from "@/lib/inbox-server";
import type { Announcement } from "@/lib/announcements";
import { announcementKindLabel } from "@/lib/announcements";
import { mergeOrders } from "@/lib/account-rules";
import { listOrders, type StoredOrder } from "@/lib/checkout-store";
import {
  buildInboxEntries,
  inboxStatusLabel,
  mergeInboxItems,
  type InboxItem,
  type OrderStatusAudit,
} from "@/lib/inbox";

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Status icon per order entry: placed is a parcel, delivered is
 *  a tick, shipped is a truck, cancelled / refunded / returned are
 *  their own marks, everything else is a bell. */
function OrderEntryIcon({ entry }: { entry: Extract<InboxItem, { source: "order" }> }) {
  const size = 20;
  if (entry.kind === "placed") return <Package size={size} />;
  if (entry.status === "delivered") return <CheckCircle2 size={size} />;
  if (entry.status === "shipped") return <Truck size={size} />;
  if (entry.status === "cancelled") return <XCircle size={size} />;
  if (entry.status === "refunded" || entry.status === "returned")
    return <RotateCcw size={size} />;
  return <Bell size={size} />;
}

/** Icon per announcement kind: a megaphone for a notification,
 *  a tag for an offer. */
function AnnouncementIcon({ item }: { item: Extract<InboxItem, { source: "announcement" }> }) {
  return item.kind === "offer" ? <Tag size={20} /> : <Megaphone size={20} />;
}

export default function InboxPage() {
  const { user, loading: authLoading } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);

  useEffect(() => {
    if (authLoading) return;
    // The inbox requires sign-in: a signed-out visitor gets the
    // prompt below and nothing else — no entries, no empty state.
    if (!user) {
      setItems([]);
      setLoaded(true);
      return;
    }
    // Scoped to the signed-in viewer (the effect returns early
    // above when there is no user): another account's local orders
    // never reach the inbox entries (audit #9).
    const browserOrders = listOrders(user.id);
    let cancelled = false;
    void (async () => {
      // Live orders for the signed-in user, merged over the browser
      // list: the same order id in both places is one order and the
      // Supabase copy wins (it is the source of truth once
      // configured). Announcements and the order-status history
      // are fetched in parallel; each returns [] on its own
      // failure, so one missing source never empties the inbox.
      const [liveOrders, announcements, audits] = await Promise.all([
        listSupabaseOrders().catch((): StoredOrder[] => []),
        listAnnouncementsForInbox().catch((): Announcement[] => []),
        listOwnOrderStatusHistory().catch((): OrderStatusAudit[] => []),
      ]);
      if (cancelled) return;
      const orders =
        liveOrders.length > 0
          ? mergeOrders(browserOrders, liveOrders)
          : browserOrders;
      setItems(
        mergeInboxItems(buildInboxEntries(orders, audits), announcements),
      );
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  if (!loaded) {
    return (
      <main className="mx-auto max-w-[900px] px-4 py-10">
        <p className="text-muted">Loading your inbox…</p>
      </main>
    );
  }

  // Signed-out visitors get the account page's sign-in prompt —
  // and nothing else.
  if (!authLoading && !user) {
    return (
      <main className="mx-auto max-w-[900px] px-4 py-10">
        <h1 className="text-3xl font-bold text-text">Inbox</h1>
        <p className="mt-1 text-muted">
          Messages from TechShot and updates from your orders.
        </p>
        <div className="mt-4 rounded-2xl border border-border bg-panel p-5">
          <h2 className="text-lg font-bold text-text">You are not signed in</h2>
          <p className="mt-1 text-sm text-muted">
            Sign in to see messages from TechShot and updates on your orders.
          </p>
          <Link
            href="/auth/sign-in"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-brandDark px-5 py-3 font-semibold text-white hover:bg-brandDarker"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[900px] px-4 py-10">
      <h1 className="text-3xl font-bold text-text">Inbox</h1>
      <p className="mt-1 text-muted">
        Messages from TechShot and updates from your orders.
      </p>

      {items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-border bg-panel p-10 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-panel text-muted">
            <InboxIcon size={28} />
          </span>
          <h2 className="mt-4 text-xl font-bold text-text">No messages yet</h2>
          <p className="mt-2 text-muted">
            Messages from TechShot and updates on your orders will show up here.
          </p>
          <Link
            href="/shop"
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-brandDark px-5 py-3 font-semibold text-white hover:bg-brandDarker"
          >
            Shop now
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {items.map((item) =>
            item.source === "announcement" ? (
              <li key={item.id}>
                <div className="flex gap-4 rounded-2xl border border-border bg-panel p-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel text-muted">
                    <AnnouncementIcon item={item} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-bold text-text">{item.title}</span>
                      <span className="text-sm text-muted">
                        {formatDateTime(item.at)}
                      </span>
                    </span>
                    <span className="mt-1 block whitespace-pre-wrap text-sm text-muted">
                      {item.detail}
                    </span>
                    <span className="mt-2 block text-sm text-muted">
                      {announcementKindLabel(item.kind)} from TechShot
                    </span>
                  </span>
                </div>
              </li>
            ) : (
              <li key={item.id}>
                <Link
                  href={`/orders/${item.orderId}`}
                  className="flex gap-4 rounded-2xl border border-border bg-panel p-5 hover:border-brand"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel text-muted">
                    <OrderEntryIcon entry={item} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-bold text-text">{item.title}</span>
                      <span className="text-sm text-muted">
                        {formatDateTime(item.at)}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm text-muted">
                      {item.detail}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold text-text">
                        {formatBDT(item.total_poisha)}
                      </span>
                      <span className="text-muted">
                        · {item.orderNumber} · {inboxStatusLabel(item.status)}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ),
          )}
        </ul>
      )}

      <p className="mt-6 text-sm text-muted">
        Order updates come from your orders and their status history;
        messages are sent by the store to all users. Messages are
        listed with their time — there is no unread count.
      </p>
    </main>
  );
}
