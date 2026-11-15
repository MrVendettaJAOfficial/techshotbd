// Shared helpers for the admin product manager: the form's
// input styling, the variant text round-trip, the status badge
// tone/label, and the manager's props. Pure functions + types
// only — no React, no imports beyond product types.

import type { CategoryOption, ProductListItem, ProductStatus } from "@/lib/products/types";

export const inputBase =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:border-brand disabled:opacity-50";

export function variantsToText(product: ProductListItem): string {
  return product.variants
    .map((variant) => {
      const base =
        variant.priceTaka === null
          ? `${variant.name}::${variant.stock}`
          : `${variant.name}:${variant.priceTaka}:${variant.stock}`;
      // A variant photo is a fourth segment; it round-trips through
      // parseVariantsText (lib/products/validation.ts).
      return variant.imagePath ? `${base}:${variant.imagePath}` : base;
    })
    .join(", ");
}

/**
 * Price and stock are required fields, but the form holds them as
 * strings — and Number("") is 0, so a price or stock box cleared
 * by mistake would otherwise save as ৳0 / 0 and go live at that
 * price. An empty (or whitespace-only) price or stock string is
 * therefore rejected here, before the form calls the server
 * action: the server schema cannot tell an empty field from a
 * deliberate ৳0, so the check belongs in the form. Returns the
 * form error to show, or null when both fields hold a value. A
 * deliberately typed "0" is a value, not an empty field — it
 * still saves as ৳0 / 0, so a genuinely free or out-of-stock
 * product remains possible through an explicit value.
 */
export function validateRequiredPriceAndStock(priceTaka: string, stock: string): string | null {
  if (priceTaka.trim() === "") return "Enter a price (৳) before saving.";
  if (stock.trim() === "") return "Enter the stock quantity before saving.";
  return null;
}

export function statusTone(status: ProductStatus): "success" | "warning" | "muted" {
  if (status === "active") return "success";
  if (status === "paused") return "warning";
  return "muted";
}

export function statusLabel(status: ProductStatus): string {
  if (status === "active") return "Live";
  if (status === "paused") return "Paused";
  return "Draft";
}

export interface ProductManagerProps {
  products: ProductListItem[];
  categories: CategoryOption[];
  /** Always true for the admin dashboard; kept so the form can be
   *  disabled without changing the component. */
  canPublish: boolean;
  /** False when Supabase is not configured: the form is disabled. */
  configured: boolean;
  /** The signed-in caller's role string (owner "admin", "co_admin", "manager", ...). */
  callerRole: string | null;
}
