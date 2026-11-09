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
