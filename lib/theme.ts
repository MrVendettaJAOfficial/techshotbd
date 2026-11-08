// Design tokens extracted from the TechShot Figma design (file
// isIx9OQrre05slUwhfrfe2, 5 screens at 1440px) and from the PNG exports
// supplied by the user on 2026-11-08. Solid colours only — no gradients
// anywhere in the site. These tokens are the single source of truth for
// colour; components must use them, never hard-coded one-off values.
export const theme = {
  colors: {
    ink: "#080d18",
    surface: "#0b1120",
    panel: "#0f172a",
    card: "#151f33",
    border: "#2a364c",
    brand: "#3b82f6",
    brandDark: "#172f55",
    accent: "#f97316",
    success: "#5bd4a0",
    muted: "#72839e",
    mutedLight: "#9baac0",
    text: "#f8fafc",
    textSoft: "#b7d4ff",
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
