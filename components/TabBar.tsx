// Horizontally scrollable tab row, shared by the admin tabs and the
// status tabs (admin orders, admin products, customer orders, admin
// users). Solid colours only, no gradients, no emoji. On mobile the
// row scrolls instead of overflowing the page.
//
// Two modes: link tabs (href per tab — the admin page tabs, driven by
// the ?tab= search param so they are shareable and survive refresh)
// and button tabs (onSelect — client-side status filters).
//
// INSTANT FEEDBACK on link tabs: a link tab navigates through the
// server, so the ?tab= URL and the highlight only change when the
// new page payload arrives — on a slow connection a tap showed
// nothing at all for seconds. The tapped tab therefore becomes the
// displayed active tab immediately (its highlight flips on tap) and
// shows a small spinner until the server-delivered activeId catches
// up with the tap. Button tabs are parent-controlled and already
// update instantly, so they never set a pending tab.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

export interface TabBarTab {
  id: string;
  label: string;
  /** Shown in brackets after the label, e.g. "All (12)". */
  count?: number;
  /** When set the tab is a link; otherwise it is a button. */
  href?: string;
}

interface TabBarProps {
  tabs: TabBarTab[];
  activeId: string;
  /** Accessible name for the tab list, e.g. "Admin sections". */
  ariaLabel: string;
  onSelect?: (id: string) => void;
}

export default function TabBar({ tabs, activeId, ariaLabel, onSelect }: TabBarProps) {
  // The link tab most recently tapped, while its server navigation
  // is still in flight. Null once the server-delivered activeId has
  // caught up with the tap (see the effect below).
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    // The server's active tab has caught up with the tap, so the
    // pending highlight hands over to the real one. A payload for a
    // different tab (an earlier tap overtaken by a later one) must
    // not clear a newer pending tap, so only an exact match clears.
    if (pendingId !== null && pendingId === activeId) {
      setPendingId(null);
    }
  }, [activeId, pendingId]);

  // While a link navigation is in flight the tapped tab reads as
  // active, so its highlight flips on tap instead of on arrival.
  const displayActiveId = pendingId ?? activeId;

  return (
    <div
      className="flex gap-1 overflow-x-auto border-b border-border"
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => {
        const selected = tab.id === displayActiveId;
        // A pending link tab is still loading its page: subtle
        // spinner + dim, so the tap visibly did something.
        const pending =
          pendingId !== null && tab.id === pendingId && tab.id !== activeId;
        const className = `shrink-0 whitespace-nowrap rounded-t-xl px-4 py-3 text-sm font-semibold transition ${
          selected
            ? "border-b-2 border-brand bg-panel text-text"
            : "text-muted hover:text-text"
        }${pending ? " opacity-70" : ""}`;
        const content = (
          <>
            {pending ? (
              <Loader2 className="mr-1 inline-block h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className="ml-1 font-normal text-muted">({tab.count})</span>
            ) : null}
          </>
        );
        if (tab.href) {
          return (
            <Link
              key={tab.id}
              href={tab.href}
              role="tab"
              aria-selected={selected}
              aria-busy={pending || undefined}
              data-pending={pending ? "true" : undefined}
              onClick={() => setPendingId(tab.id)}
              className={className}
            >
              {content}
            </Link>
          );
        }
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect?.(tab.id)}
            className={className}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
