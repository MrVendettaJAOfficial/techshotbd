"use client";

// Site header: announcement bar, TechShot logo, search (GET to /shop),
// wishlist/account icons, cart button with live count, and category nav.
// Cart count comes from the cart store (CartProvider in app/layout.tsx);
// an optional cartCount prop overrides it. No server fetching here.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, Search, ShoppingCart, User, Zap } from "lucide-react";
import { useState } from "react";
import { useCart } from "../lib/cart-store";

const NAV_LINKS = [
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

export default function Header({ cartCount }: { cartCount?: number }) {
  const { count } = useCart();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const displayCount = cartCount ?? count;

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/shop?q=${encodeURIComponent(q)}` : "/shop");
  }

  return (
    <header className="sticky top-0 z-40">
      <div className="bg-brand px-4 py-2 text-center text-xs font-medium text-white sm:text-sm">
        Your next upgrade, delivered free. On every order above ৳999.
        <span className="mx-2 hidden text-blue-200 sm:inline">|</span>
        <span className="hidden sm:inline">
          100% genuine · Official warranty · Bangladesh-wide delivery
        </span>
      </div>

      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-shell items-center gap-3 px-4 py-3 sm:gap-6">
          <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="TechShot home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white">
              <Zap size={22} className="fill-white" />
            </span>
            <span className="text-xl font-bold tracking-tight text-text">
              TechShot<span className="text-brand">.</span>
            </span>
          </Link>

          <form
            onSubmit={handleSearch}
            role="search"
            className="hidden min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-panel px-3 py-2 sm:flex"
          >
            <Search size={18} className="shrink-0 text-muted" />
            <input
              type="search"
              name="q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search phones, laptops, audio and more"
              aria-label="Search products"
              className="w-full bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
            >
              Search
            </button>
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0 sm:gap-2">
            <Link
              href="/account"
              aria-label="Wishlist"
              className="flex h-10 w-10 items-center justify-center rounded-full text-text transition hover:bg-panel"
            >
              <Heart size={20} />
            </Link>
            <Link
              href="/account"
              aria-label="My account"
              className="flex h-10 w-10 items-center justify-center rounded-full text-text transition hover:bg-panel"
            >
              <User size={20} />
            </Link>
            <Link
              href="/cart"
              aria-label={`Cart, ${displayCount} items`}
              className="relative flex items-center gap-2 rounded-xl bg-brand px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 sm:px-4"
            >
              <ShoppingCart size={18} />
              <span className="hidden sm:inline">Cart</span>
              {displayCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-white">
                  {displayCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        <form
          onSubmit={handleSearch}
          role="search"
          className="flex items-center gap-2 px-4 pb-3 sm:hidden"
        >
          <Search size={18} className="shrink-0 text-muted" />
          <input
            type="search"
            name="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products"
            aria-label="Search products"
            className="w-full rounded-xl border border-border bg-panel px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none"
          />
        </form>

        <nav
          aria-label="Categories"
          className="overflow-x-auto border-t border-border"
        >
          <ul className="mx-auto flex max-w-shell items-center gap-1 px-4 py-2 text-sm font-medium whitespace-nowrap">
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  className={
                    link.accent
                      ? "rounded-full bg-accent/15 px-3 py-1.5 text-accent hover:bg-accent/25"
                      : "rounded-full px-3 py-1.5 text-text hover:bg-panel hover:text-brand"
                  }
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
