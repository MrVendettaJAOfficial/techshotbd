// Design tokens extracted from the TechShot Figma design (file
// isIx9OQrre05slUwhfrfe2, 5 screens at 1440px) and from the PNG exports
// supplied by the user on 2026-11-08, recoloured 2026-11-09 to the
// owner's own logo palette, then flipped 2026-11-09 to the LIGHT
// theme: white page backgrounds, dark navy text, navy header/footer
// and navy primary buttons — navy blue and white, like the logo.
// Solid colours only — no gradients anywhere in the site. These
// tokens are the single source of truth for colour; components must
// use them, never hard-coded one-off values.
//
// Logo palette (read from the owner's SVG): navy #00162E, emerald
// green #0F9A70, off-white #F1F7FE, dark slate #283246. The page is
// white, panels are the off-white, navy is the header, the footer
// and the primary buttons, and the logo green is now a SECONDARY
// accent only — the logo, success states and small highlights —
// never the primary button or link colour. Orange #f97316 is kept
// ONLY where it means a deal or a discount (flash deals, discount
// badges, coupon boxes).
//
// Contrast (WCAG, computed, not guessed — see tests/recolour.test.mjs):
//   * Navy text #00162E on white is 18.19:1; white text on navy is
//     18.19:1. Primary buttons are bg-ink with white text, hover
//     bg-inkLight #0A2438 (white text 15.88:1).
//   * The full green #0F9A70 as text on white is 3.57:1 — it FAILS
//     AA for normal text. Green text on light backgrounds is
//     therefore always the darker tint brandDark #0B7A55 (5.34:1 on
//     white, 4.96:1 on panel) or brandDarker #096B49 (6.54:1). The
//     full green is used only for text/icons on navy (5.09:1),
//     borders, tints and fills on light (3.57:1 passes the 3:1
//     non-text bar), and the logo itself.
//   * brandLight #4CC9A4 on white is 2.06:1 — it FAILS. It is a
//     navy-only token (8.84:1 on navy): header/nav and footer link
//     hovers, the countdown labels' mutedNavy sibling. Never use
//     it on a light background.
//   * Muted text on light is #475569 (7.58:1 on white, 7.03:1 on
//     panel); mutedLight #5B6B7F is 5.45:1 on white, 5.05:1 on
//     panel. The old muted #8AA0B8 on white is 2.69:1 — it FAILS —
//     so it survives only as mutedNavy #8AA0B8 (6.76:1 on navy),
//     for muted text on the navy header/footer/viewer only.
//   * Success text is brandDark #0B7A55 (5.34:1 on white, 4.96:1
//     on panel); the old success #4CC9A4 failed on white.
//   * White text on the deal orange #f97316 is 2.80:1 — it FAILS.
//     Solid orange badges/buttons therefore use the darker
//     accentDark #C2410C (white text 5.18:1, passes AA); the full
//     orange is used only for text on navy (orange text on navy is
//     6.49:1, passes) and for borders/fills. On a light background
//     orange text must be accentDark (5.18:1 on white).
//   * Amber is NOT a brand colour: it is the universal rating
//     convention (stars) and the warning tint (pending-payment
//     chips, TEST MODE badges). Stars are amber-600 #D97706
//     (3.19:1 on white, passes the 3:1 non-text bar); warning text
//     is amber-700 #B45309 (5.02:1 on white, 4.66:1 on panel).
//     Error text is red-700 #B91C1C (6.47:1 on white, 6.00:1 on
//     panel). Red stays the error colour.
export const theme = {
  colors: {
    // Backgrounds: the page is white, panels are the logo
    // off-white, cards are white, borders are a light slate so
    // sections stay distinguishable. Navy text on white is 18.19:1.
    ink: "#00162E",
    inkLight: "#0A2438",
    surface: "#FFFFFF",
    panel: "#F1F7FE",
    card: "#FFFFFF",
    border: "#D9E2EC",
    // Secondary accent: the logo green. `brand` is the full green,
    // for text/icons on navy, borders, tints and fills on light;
    // `brandDark` is the darker tint green text on light uses so
    // it passes AA (see above). Green is never a primary button
    // or link colour any more — those are navy.
    brand: "#0F9A70",
    brandDark: "#0B7A55",
    brandDarker: "#096B49",
    brandLight: "#4CC9A4",
    // Deals only: the orange, plus its darker tint for solid
    // orange badges/buttons and for orange text on light (white
    // text on the full orange fails).
    accent: "#f97316",
    accentDark: "#C2410C",
    accentDarker: "#9A3412",
    // Success is the darker logo green, not a new colour — the
    // old light tint failed AA on white.
    success: "#0B7A55",
    // Logo palette, from the owner's own TechShot logo SVG (shared
    // 2026-11-09): navy field, emerald green, white.
    logoGreen: "#0F9A70",
    logoNavy: "#00162E",
    logoWhite: "#F1F7FE",
    // Muted text on light backgrounds: dark slate, AA-passing on
    // white and on panel. `mutedNavy` is the old muted value, kept
    // ONLY for muted text on navy surfaces (header/footer/viewer).
    muted: "#475569",
    mutedLight: "#5B6B7F",
    mutedNavy: "#8AA0B8",
    text: "#00162E",
    // Soft text: the darker logo green, for green-tinted text on
    // light backgrounds (same value as brandDark, its own token so
    // call sites read as "soft" rather than "brand").
    textSoft: "#0B7A55",
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
