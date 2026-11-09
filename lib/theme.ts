// Design tokens extracted from the TechShot Figma design (file
// isIx9OQrre05slUwhfrfe2, 5 screens at 1440px) and from the PNG exports
// supplied by the user on 2026-11-08, recoloured 2026-11-09 to the
// owner's own logo palette. Solid colours only — no gradients
// anywhere in the site. These tokens are the single source of truth for
// colour; components must use them, never hard-coded one-off values.
//
// Logo palette (read from the owner's SVG): navy #00162E, emerald
// green #0F9A70, off-white #F1F7FE, dark slate #283246. The site's
// backgrounds are the navy/slate family, the primary accent is the
// logo green, and orange #f97316 is kept ONLY where it means a
// deal or a discount (flash deals, discount badges, coupon boxes).
//
// Contrast (WCAG, computed, not guessed — see tests/recolour.test.mjs):
//   * White text on the logo green #0F9A70 is 3.57:1 — it FAILS AA
//     for normal text. Solid buttons therefore use the darker tint
//     brandDark #0B7A55 (white text 5.34:1, passes AA) with the
//     darker brandDarker #096B49 on hover (6.54:1). The full green
//     is used only for text, icons and translucent tints on navy.
//   * Logo green #0F9A70 as text on navy #00162E is 5.09:1 (passes);
//     the lighter tint brandLight #4CC9A4 is 8.84:1 and is the green
//     used for small text accents and success states.
//   * White text on the deal orange #f97316 is 2.80:1 — it FAILS.
//     Solid orange badges/buttons therefore use the darker
//     accentDark #C2410C (white text 5.18:1, passes AA); the full
//     orange is used only for text, borders and fills on navy
//     (orange text on navy is 6.49:1, passes).
//   * Amber is NOT a brand colour: it is the universal rating
//     convention (stars) and the warning tint (pending-payment
//     chips, TEST MODE badges). Red stays the error colour.
export const theme = {
  colors: {
    // Backgrounds: the logo navy, stepped up through the slate
    // family so page, surface, panel, card and border stay
    // distinguishable. Off-white text on the page navy is 16.87:1.
    ink: "#00162E",
    surface: "#0A2438",
    panel: "#122C44",
    card: "#1B3850",
    border: "#283246",
    // Primary accent: the logo green. `brand` is the full green,
    // for text/icons/tints on navy; `brandDark` is the darker tint
    // solid buttons use so white text passes AA (see above).
    brand: "#0F9A70",
    brandDark: "#0B7A55",
    brandDarker: "#096B49",
    brandLight: "#4CC9A4",
    // Deals only: the orange, plus its darker tint for solid
    // orange badges/buttons (white text on the full orange fails).
    accent: "#f97316",
    accentDark: "#C2410C",
    accentDarker: "#9A3412",
    // Success is a light tint of the logo green, not a new colour.
    success: "#4CC9A4",
    // Logo palette, from the owner's own TechShot logo SVG (shared
    // 2026-11-09): navy field, emerald green, white.
    logoGreen: "#0F9A70",
    logoNavy: "#00162E",
    logoWhite: "#F1F7FE",
    // Muted text is lightened from #72839e: the old value was
    // 3.71:1 on panel and 3.16:1 on card (fails AA). #8AA0B8 is
    // 5.31:1 on panel and 4.51:1 on card (passes AA everywhere).
    muted: "#8AA0B8",
    mutedLight: "#9BAAC0",
    text: "#F1F7FE",
    // Soft text: a light tint of the logo green (9.77:1 on navy).
    textSoft: "#7FCDB2",
  },
  radius: { card: "16px", pill: "999px" },
  maxWidth: "1312px",
} as const;

export const CURRENCY = "BDT";
export const FREE_DELIVERY_THRESHOLD_POISHA = 99900; // ৳999
export const EXPRESS_DELIVERY_POISHA = 49900; // ৳499
export const FIRST2000_MIN_POISHA = 5000000; // ৳50,000
export const FIRST2000_VALUE_POISHA = 200000; // ৳2,000

export function formatBDT(poisha: number): string {
  const taka = poisha / 100;
  return "৳" + taka.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
