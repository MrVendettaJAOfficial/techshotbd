// Brand wordmark (code-built logo, no image files): the TS monogram
// mark, "TechShot" in extra-bold Montserrat, green "BD", and the
// tagline "A Shot of Tech, You Can Trust". It recreates the owner's
// own logo (shared as an SVG on 2026-11-09) in code — navy #00162E,
// green #0F9A70, white #F1F7FE, flat, solid colours only. The monogram
// is a simple approximation (bold T over bold S with a circuit trace),
// not a trace of the original vector paths. Used by the header and
// the footer. Tagline visibility: "responsive" (desktop/laptop only,
// hidden where the header is tight on mobile), "always" (footer),
// "never".

import Link from "next/link";
import { Montserrat } from "next/font/google";

const logoFont = Montserrat({
  subsets: ["latin"],
  weight: ["300", "800"],
  display: "swap",
});

export type LogoTagline = "responsive" | "always" | "never";

// The monogram mark alone (green T over white S with a circuit trace
// on the logo navy), exported so the branded product placeholder
// (components/ProductPlaceholder.tsx) can reuse the exact same mark
// without duplicating the SVG — and without the link wrapper, which
// must not nest inside a product card's link.
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-lg bg-logoNavy ${className ?? "h-10 w-10"}`}
    >
      <svg viewBox="0 0 48 48" className="h-full w-full">
        <polyline
          points="24,13 18,21 22,27 16,35"
          fill="none"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-logoGreen"
        />
        <circle cx="24" cy="13" r="2.4" strokeWidth="1.5" className="fill-logoWhite stroke-logoGreen" />
        <circle cx="16" cy="35" r="2.4" strokeWidth="1.5" className="fill-logoWhite stroke-logoGreen" />
        <text x="24" y="37" textAnchor="middle" fontSize="30" fontWeight="800" className="fill-logoWhite">
          S
        </text>
        <text x="24" y="22" textAnchor="middle" fontSize="20" fontWeight="800" className="fill-logoGreen">
          T
        </text>
      </svg>
    </span>
  );
}

export default function Logo({ tagline = "responsive" }: { tagline?: LogoTagline }) {
  const taglineClass =
    tagline === "always" ? "block" : tagline === "never" ? "hidden" : "hidden sm:block";
  return (
    <Link
      href="/"
      aria-label="TechShot home"
      data-testid="site-logo"
      className={`${logoFont.className} flex shrink-0 items-center gap-2.5`}
    >
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="flex items-baseline gap-1">
          <span data-testid="logo-wordmark" className="text-xl font-extrabold tracking-tight text-logoWhite">TechShot</span>
          <span data-testid="logo-bd" className="text-[11px] font-extrabold leading-none text-logoGreen">BD</span>
        </span>
        <span
          data-testid="logo-tagline"
          className={`${taglineClass} mt-1 text-[9px] font-light tracking-[0.22em] text-logoWhite/70`}
        >
          A Shot of Tech, You Can Trust
        </span>
      </span>
    </Link>
  );
}
