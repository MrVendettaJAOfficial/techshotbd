"use client";

// Shop filters drawer for mobile.
//
// On mobile the filter sidebar used to show always and take the whole
// screen. Now it is hidden by default: a "Filters" button (with a
// chevron and a badge counting the active filters) opens the filters
// in a slide-in drawer from the left — the same left-drawer pattern
// as the mobile nav drawer, for consistency. Desktop is unchanged:
// the sidebar sits beside the results from lg up.
//
// There is exactly ONE filter form in the DOM. The form itself is
// passed in as children (it lives in the server component
// app/shop/page.tsx, where its defaultValue/defaultChecked values
// come from the search params) and rendered inside a single <aside>
// that is off-canvas on mobile and a normal sidebar on desktop —
// never duplicated. Apply submits the existing GET form (the drawer
// closes on submit); Clear links to /shop (the drawer closes on
// link click). Closing: X button, overlay tap, or Escape, with focus
// returning to the Filters button — the same pattern as the
// mini-cart drawer (components/MiniCartDrawer.tsx). The slide-in is
// a 250ms CSS animation (app/globals.css); prefers-reduced-motion
// turns it off.

import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export default function FilterDrawer({
  children,
  activeCount,
}: {
  children: ReactNode;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  function closeAndRefocus() {
    setOpen(false);
    // The trigger stays mounted, so focusing it right away puts focus
    // back on the Filters button.
    triggerRef.current?.focus();
  }

  // Escape closes, body scroll locks, and focus moves into the panel
  // — all only while the drawer is open. Escape uses the same close
  // path as the X button and the overlay, so focus returns to the
  // Filters button whichever way the drawer is closed.
  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAndRefocus();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
    // closeAndRefocus is re-created each render; the effect only
    // needs to re-run when the drawer opens, so it is intentionally
    // not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A link click inside the drawer (Clear -> /shop) closes it.
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("a")) setOpen(false);
  }

  return (
    <div className="contents">
      {/* Mobile only: the Filters button. Hidden from lg up, where
          the sidebar is always visible. */}
      <div className="lg:hidden">
        <button
          type="button"
          ref={triggerRef}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          data-testid="filters-button"
          className="flex w-full items-center justify-between rounded-xl border border-border bg-panel px-4 py-3 text-sm font-semibold text-text transition hover:border-brand"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal size={18} />
            Filters
            {activeCount > 0 && (
              <span
                data-testid="filters-count"
                className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brandDark px-1.5 text-[11px] font-bold text-white"
              >
                {activeCount}
              </span>
            )}
          </span>
          <ChevronDown
            size={18}
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {open && (
        <div
          aria-hidden="true"
          onClick={closeAndRefocus}
          className="animate-fade-in fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      )}

      {/* One aside, two layouts: off-canvas drawer on mobile
          (translated away and invisible when closed, so it leaves
          the tab order), plain sidebar from lg up. */}
      <aside
        aria-label="Filters"
        data-testid="filters-drawer"
        className={`fixed inset-y-0 left-0 z-50 w-[86vw] max-w-sm overflow-y-auto bg-panel p-5 shadow-2xl lg:static lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0 lg:overflow-visible lg:bg-transparent lg:p-0 lg:shadow-none ${
          open ? "max-lg:animate-drawer-left" : "-translate-x-full invisible lg:visible"
        }`}
      >
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <h2 className="text-lg font-bold text-text">Filters</h2>
          <button
            type="button"
            ref={closeButtonRef}
            aria-label="Close filters"
            onClick={closeAndRefocus}
            className="flex h-10 w-10 items-center justify-center rounded-full text-text transition hover:bg-surface"
          >
            <X size={20} />
          </button>
        </div>

        {/* Apply submits the GET form (submit bubbles up here, so
            the drawer closes); Clear is a link (click bubbles up,
            so the drawer closes that way too). */}
        <div onSubmit={() => setOpen(false)} onClick={handleClick}>
          {children}
        </div>
      </aside>
    </div>
  );
}
