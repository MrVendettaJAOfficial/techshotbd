// Site footer (server component): brand, link groups using real routes,
// contact email, payment methods as text chips, and copyright.
//
// The footer links only what the navbar does NOT carry: "Here to
// help" (account / orders / cart / checkout) and "The TechShot way"
// (Admin). The old Discover group (Shop all, Smartphones, Laptops,
// Audio, Gaming, Flash deals, Subscriptions) was removed 2026-11-10:
// every one of those destinations is already a navbar link, so
// keeping them in the footer meant the same page twice in the
// header/footer chrome. The navbar is the primary place for
// category links; the footer keeps only the account/help/admin ones.

import Link from "next/link";
import { Mail } from "lucide-react";
import Logo from "./Logo";

const HELP_LINKS = [
  { label: "My account", href: "/account" },
  { label: "My orders", href: "/orders" },
  { label: "My cart", href: "/cart" },
  { label: "Checkout", href: "/checkout" },
];

const TECHSHOT_LINKS = [
  { label: "Admin", href: "/admin" },
];

const PAYMENTS = ["VISA", "Mastercard", "bKash", "Nagad", "COD"];

export default function Footer() {
  return (
    <footer className="border-t border-border bg-ink">
      <div className="mx-auto grid max-w-shell gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Logo tagline="always" />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-mutedNavy">
            Great tech. Zero second guesses.
          </p>
          <p className="mt-4 flex items-center gap-2 text-sm text-mutedNavy">
            <Mail size={16} />
            <a href="mailto:hello@techshotbd" className="hover:text-brandLight">
              hello@techshotbd
            </a>
          </p>
        </div>

        <nav aria-label="Here to help">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-white">
            Here to help
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-mutedNavy">
            {HELP_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="hover:text-brandLight">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="The TechShot way">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-white">
            The TechShot way
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-mutedNavy">
            {TECHSHOT_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="hover:text-brandLight">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-shell flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row">
          <p className="text-xs text-mutedNavy">
            &copy; 2026 TechShot. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-2" aria-label="We accept">
            {PAYMENTS.map((method) => (
              <span
                key={method}
                className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-white"
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
