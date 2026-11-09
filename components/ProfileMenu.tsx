// Profile menu (header dropdown) for TechShot.
//
// One job: the mini profile menu that opens from the header profile
// icon — a dropdown panel, NOT a navigation. Signed in it shows
// Profile, Orders, Inbox, Wishlist and Settings, each with its own
// lucide icon, plus Sign out; signed out it shows Sign in and
// Create account. Auth state comes from useAuth (lib/auth.ts);
// the AuthProvider wraps the header in app/layout.tsx, so this
// component needs no provider of its own.
//
// Closing: a link tap, the Sign out button, clicking anywhere
// outside the panel (transparent overlay), or the Escape key.
// Focus moves to the first menu item when the menu opens and back
// to the profile button when it closes; Arrow Down / Up move
// between items, Home / End jump to the ends. The trigger carries
// aria-haspopup="menu" / aria-expanded and the panel is role="menu".
// The panel is anchored to the header row, so at 390px it stays
// inside the viewport (max width caps it to the viewport minus
// a margin).

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Heart,
  Inbox,
  LogIn,
  LogOut,
  Package,
  Settings,
  User,
  UserPlus,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";

interface MenuEntry {
  href: string;
  label: string;
  Icon: typeof User;
}

/** The five signed-in entries, in menu order. Wishlist and
 *  Settings are anchors on /account (the wishlist section and the
 *  security section); the other three are their own pages. */
export const PROFILE_MENU_ENTRIES: MenuEntry[] = [
  { href: "/account", label: "Profile", Icon: User },
  { href: "/orders", label: "Orders", Icon: Package },
  { href: "/inbox", label: "Inbox", Icon: Inbox },
  { href: "/account#wishlist", label: "Wishlist", Icon: Heart },
  { href: "/account#security", label: "Settings", Icon: Settings },
];

export default function ProfileMenu() {
  const { user, loading, signOutUser } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | HTMLButtonElement | null>>([]);

  function closeAndRefocus() {
    setOpen(false);
    // The trigger stays mounted, so focusing it right away puts
    // focus back on the header profile button.
    triggerRef.current?.focus();
  }

  function handleSignOut() {
    signOutUser();
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  // Escape closes, and focus moves into the menu when it opens —
  // only while the menu is open.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAndRefocus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
    // closeAndRefocus is re-created each render; the effect only
    // needs to re-run when the menu opens, so it is intentionally
    // not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  function onItemKeyDown(
    e: React.KeyboardEvent,
    index: number,
    count: number,
  ) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      itemRefs.current[(index + 1) % count]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      itemRefs.current[(index - 1 + count) % count]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      itemRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      itemRefs.current[count - 1]?.focus();
    }
  }

  const itemClassName =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text transition hover:bg-panel text-left";

  // Signed-in items: the five links plus Sign out. Signed-out
  // items: Sign in and Create account. While auth is still loading
  // the menu shows a single inert line instead of flashing the
  // signed-out entries at a signed-in user.
  const signedInItems = [...PROFILE_MENU_ENTRIES];
  const itemCount = loading ? 0 : user ? signedInItems.length + 1 : 2;

  return (
    <div className="relative">
      <button
        type="button"
        ref={triggerRef}
        aria-label="My account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="profile-menu"
        onClick={() => setOpen((prev) => !prev)}
        data-testid="profile-menu-button"
        className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/10 sm:h-10 sm:w-10"
      >
        <User size={20} />
      </button>

      {open && (
        <>
          {/* Transparent overlay: any tap outside the panel closes
              the menu. It sits below the panel (z-40 vs z-50) and
              above the page, like the drawers' dimmed overlay. */}
          <div
            aria-hidden="true"
            onClick={closeAndRefocus}
            className="fixed inset-0 z-40"
            data-testid="profile-menu-overlay"
          />
          <div
            id="profile-menu"
            role="menu"
            aria-label="My account"
            className="absolute right-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-2 shadow-2xl"
          >
            {loading ? (
              <p className="px-3 py-2.5 text-sm text-muted">
                Loading your account…
              </p>
            ) : user ? (
              <>
                <div className="border-b border-border px-3 pb-3 pt-2">
                  <p className="truncate font-bold text-text">
                    {user.displayName}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {user.email}
                  </p>
                </div>
                <div className="pt-2">
                  {signedInItems.map((entry, index) => (
                    <Link
                      key={entry.href}
                      href={entry.href}
                      role="menuitem"
                      ref={(el) => {
                        itemRefs.current[index] = el;
                      }}
                      onClick={() => setOpen(false)}
                      onKeyDown={(e) =>
                        onItemKeyDown(e, index, itemCount)
                      }
                      className={itemClassName}
                    >
                      <entry.Icon size={18} className="shrink-0 text-muted" />
                      {entry.label}
                    </Link>
                  ))}
                  <button
                    type="button"
                    role="menuitem"
                    ref={(el) => {
                      itemRefs.current[signedInItems.length] = el;
                    }}
                    onClick={handleSignOut}
                    onKeyDown={(e) =>
                      onItemKeyDown(e, signedInItems.length, itemCount)
                    }
                    className={itemClassName}
                  >
                    <LogOut size={18} className="shrink-0 text-muted" />
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <>
                <Link
                  href="/auth/sign-in"
                  role="menuitem"
                  ref={(el) => {
                    itemRefs.current[0] = el;
                  }}
                  onClick={() => setOpen(false)}
                  onKeyDown={(e) => onItemKeyDown(e, 0, itemCount)}
                  className={itemClassName}
                >
                  <LogIn size={18} className="shrink-0 text-muted" />
                  Sign in
                </Link>
                <Link
                  href="/auth/sign-up"
                  role="menuitem"
                  ref={(el) => {
                    itemRefs.current[1] = el;
                  }}
                  onClick={() => setOpen(false)}
                  onKeyDown={(e) => onItemKeyDown(e, 1, itemCount)}
                  className={itemClassName}
                >
                  <UserPlus size={18} className="shrink-0 text-muted" />
                  Create account
                </Link>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
