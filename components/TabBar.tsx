// Horizontally scrollable tab row, shared by the admin tabs and the
// status tabs (admin orders, admin products, customer orders, admin
// users). Solid colours only, no gradients, no emoji. On mobile the
// row scrolls instead of overflowing the page.
//
// Two modes: link tabs (href per tab — the admin page tabs, driven by
// the ?tab= search param so they are shareable and survive refresh)
// and button tabs (onSelect — client-side status filters).

"use client";

import Link from "next/link";

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
  return (
    <div
      className="flex gap-1 overflow-x-auto border-b border-border"
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        const className = `shrink-0 whitespace-nowrap rounded-t-xl px-4 py-3 text-sm font-semibold transition ${
          selected
            ? "border-b-2 border-brand bg-panel text-text"
            : "text-muted hover:text-text"
        }`;
        const content = (
          <>
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
