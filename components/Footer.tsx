// Site footer (server component): brand, link groups using real routes,
// contact email, payment methods as text chips, and copyright.

import Link from "next/link";
import { Mail } from "lucide-react";
import Logo from "./Logo";

const DISCOVER_LINKS = [
  { label: "Shop all", href: "/shop" },
  { label: "Smartphones", href: "/shop?category=smartphones" },
  { label: "Laptops", href: "/shop?category=laptops" },
  { label: "Audio", href: "/shop?category=audio" },
  { label: "Gaming", href: "/shop?category=gaming" },
  { label: "Flash deals", href: "/shop?flash=1" },
];

const HELP_LINKS = [
  { label: "My account", href: "/account" },
  { label: "My orders", href: "/orders" },
  { label: "My cart", href: "/cart" },
  { label: "Checkout", href: "/checkout" },
];

const TECHSHOT_LINKS = [
  { label: "Admin", href: "/admin" },
  { label: "Subscriptions", href: "/shop?category=subscriptions" },
];

const PAYMENTS = ["VISA", "Mastercard", "bKash", "Nagad", "COD"];

export default function Footer() {
  return (
    <footer className="border-t border-border bg-panel">
      <div className="mx-auto grid max-w-shell gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo tagline="always" />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
            Great tech. Zero second guesses.
          </p>
          <p className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Mail size={16} />
            <a href="mailto:hello@techshotbd" className="hover:text-brand">
              hello@techshotbd
            </a>
          </p>
        </div>

        <nav aria-label="Discover">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-text">
            Discover
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-muted">
            {DISCOVER_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="hover:text-brand">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Here to help">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-text">
            Here to help
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-muted">
            {HELP_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="hover:text-brand">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="The TechShot way">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-text">
            The TechShot way
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-muted">
            {TECHSHOT_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="hover:text-brand">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-shell flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row">
          <p className="text-xs text-muted">
            &copy; 2026 TechShot. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-2" aria-label="We accept">
            {PAYMENTS.map((method) => (
              <span
                key={method}
                className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text"
              >
                {method}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
