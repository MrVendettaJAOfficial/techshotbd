// Brand wordmark: the owner's real TS monogram mark
// (public/images/techshot-logo.svg, shared by him on 2026-11-09),
// "TechShot" in extra-bold Montserrat, green "BD", and the tagline
// "A Shot of Tech, You Can Trust". The wordmark text is built in
// code; only the mark itself is his image file — navy #00162E,
// green #0F9A70, white #F1F7FE, flat, solid colours only. Used by
// the header and the footer. Tagline visibility: "responsive"
// (desktop/laptop only, hidden where the header is tight on mobile),
// "always" (footer), "never".

import Image from "next/image";
import Link from "next/link";
import { Montserrat } from "next/font/google";

const logoFont = Montserrat({
  subsets: ["latin"],
  weight: ["300", "800"],
  display: "swap",
});

export type LogoTagline = "responsive" | "always" | "never";

// The monogram mark alone (the owner's real TS mark file on the logo
// navy), exported so the branded product placeholder
// (components/ProductPlaceholder.tsx) can reuse the exact same mark
// without duplicating it — and without the link wrapper, which must
// not nest inside a product card's link.
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-lg bg-logoNavy ${className ?? "h-10 w-10"}`}
    >
      <Image
        src="/images/techshot-logo.svg"
        alt=""
        width={500}
        height={548}
        className="h-full w-full object-contain p-[2px]"
      />
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
      <LogoMark className="h-9 w-9 sm:h-10 sm:w-10" />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="flex items-baseline gap-1">
          <span data-testid="logo-wordmark" className="text-lg font-extrabold tracking-tight text-logoWhite sm:text-xl">TechShot</span>
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
