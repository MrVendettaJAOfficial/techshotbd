"use client";

// Mobile nav drawer (slide-in sidebar) for TechShot.
//
// On mobile the header's horizontal category nav row is hidden, and
// this drawer is the way to reach the categories: the hamburger in
// the header opens it from the left. Desktop is unchanged — the nav
// row still shows from sm up and the hamburger never renders there.
//
// Closing: X button, tapping the dimmed overlay, the Escape key, or
// tapping any nav link. Focus moves to the close button when the
// drawer opens and back to the hamburger when it closes, and body
// scrolling locks while it is open — the same pattern as the
// mini-cart drawer (components/MiniCartDrawer.tsx). The slide-in is
// a 250ms CSS animation (app/globals.css); prefers-reduced-motion
// turns it off.

import Link from "next/link";
import { useEffect, useRef, type RefObject } from "react";
import { X } from "lucide-react";
import { LogoMark } from "./Logo";

export const NAV_LINKS = [
  { label: "All categories", href: "/shop" },
  { label: "Home", href: "/" },
  { label: "Shop all", href: "/shop" },
  { label: "Smartphones", href: "/shop?category=smartphones" },
  { label: "Laptops", href: "/shop?category=laptops" },
  { label: "Audio", href: "/shop?category=audio" },
  { label: "Gaming", href: "/shop?category=gaming" },
  { label: "Subscriptions", href: "/shop?category=subscriptions" },
  { label: "Flash deals", href: "/shop?flash=1", accent: true },
];

export default function MobileNavDrawer({
  open,
  onClose,
  triggerRef,
}: {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  function closeAndRefocus() {
    onClose();
    // The trigger stays mounted, so focusing it right away puts focus
    // back on the hamburger button.
    triggerRef.current?.focus();
  }

  // Escape closes, body scroll locks, and focus moves into the panel
  // — all only while the drawer is open. Escape uses the same close
  // path as the X button and the overlay, so focus returns to the
  // hamburger whichever way the drawer is closed.
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
    // needs to re-run when the drawer opens or its close handler
    // changes identity, so it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 sm:hidden">
      <div
        aria-hidden="true"
        onClick={closeAndRefocus}
        className="animate-fade-in absolute inset-0 bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Categories"
        data-testid="mobile-nav-drawer"
        className="animate-drawer-left absolute left-0 top-0 flex h-full w-[85vw] max-w-xs flex-col bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <span className="flex items-center gap-2.5">
            <LogoMark className="h-9 w-9" />
            <span className="text-lg font-extrabold tracking-tight text-logoWhite">
              TechShot
            </span>
          </span>
          <button
            type="button"
            ref={closeButtonRef}
            aria-label="Close menu"
            onClick={closeAndRefocus}
            className="flex h-10 w-10 items-center justify-center rounded-full text-text transition hover:bg-panel"
          >
            <X size={20} />
          </button>
        </div>

        <nav aria-label="Categories">
          <ul className="px-3 py-3 text-[15px] font-medium">
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  onClick={onClose}
                  className={
                    link.accent
                      ? "mt-1 flex items-center gap-2 rounded-xl bg-accent/15 px-3 py-2.5 text-accent transition hover:bg-accent/25"
                      : "flex items-center gap-2 rounded-xl px-3 py-2.5 text-text transition hover:bg-panel hover:text-brandLight"
                  }
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </div>
  );
}
