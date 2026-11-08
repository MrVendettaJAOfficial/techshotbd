// TechShot marketplace — pure product validation helpers.
//
// No server imports in this file (zod only), so the slug / money /
// variant rules can be unit-tested without a database or Supabase
// credentials. Server actions in lib/products/actions.ts import the
// zod schemas from here; the Node tests in
// tests/products-actions.test.mjs mirror these pure helpers in plain
// JS (Node cannot import .ts directly — same pattern as
// tests/pricing.test.mjs).
//
// Money is integer poisha (100 poisha = 1 BDT) everywhere in the DB.
// The forms work in BDT taka; conversion to poisha happens here and
// in the server actions, never in the browser.

import { z } from "zod";

export type ProductStatus = "draft" | "active" | "paused";

/** Lowercase slug: non-alphanumerics become "-", runs collapse, ends trimmed. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || "product";
}

/** Append -2, -3, ... until the slug is not in `taken`. */
export function dedupeSlug(base: string, taken: Iterable<string>): string {
  const takenSet = new Set(taken);
  if (!takenSet.has(base)) return base;
  let n = 2;
  while (takenSet.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** BDT taka -> integer poisha, rounded to the nearest poisha. */
export function takaToPoisha(taka: number): number {
  return Math.round(taka * 100);
}

/** Integer poisha -> BDT taka. */
export function poishaToTaka(poisha: number): number {
  return poisha / 100;
}

/**
 * An image path is safe when it is a local / Storage path (starts with
 * "/") or an https URL. Figma URLs are never accepted: Figma file /
 * image URLs are temporary and must never be stored as product images.
 * data: / blob: / javascript: URLs are rejected too.
 */
export function isSafeImagePath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("/")) return !trimmed.includes("..");
  if (/^https:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname.toLowerCase().includes("figma")) return false;
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export interface ParsedVariant {
  name: string;
  priceTaka?: number;
  stock: number;
}

/**
 * Parse the form's comma-separated variant list:
 *   "128GB:89900:10, 256GB:99900:5"  or  "Red::20" (no price override)
 * Each entry is "Name:priceTaka:stock"; price may be empty (use the
 * product price) and stock defaults to 0. Throws an Error with a
 * user-facing message on malformed input.
 */
export function parseVariantsText(text: string): ParsedVariant[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  const variants: ParsedVariant[] = [];
  for (const rawEntry of trimmed.split(",")) {
    const entry = rawEntry.trim();
    if (entry === "") continue;
    const parts = entry.split(":").map((part) => part.trim());
    const name = parts[0] ?? "";
    if (name === "") {
      throw new Error("Each variant needs a name, e.g. \"128GB:89900:10\".");
    }
    const priceRaw = parts[1] ?? "";
    const stockRaw = parts[2] ?? "";
    const variant: ParsedVariant = { name, stock: 0 };
    if (priceRaw !== "") {
      const price = Number(priceRaw);
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(`Variant "${name}" has an invalid price. Prices must be ৳0 or more.`);
      }
      variant.priceTaka = price;
    }
    if (stockRaw !== "") {
      const stock = Number(stockRaw);
      if (!Number.isInteger(stock) || stock < 0) {
        throw new Error(`Variant "${name}" has an invalid stock. Stock must be a whole number, 0 or more.`);
      }
      variant.stock = stock;
    }
    variants.push(variant);
  }
  if (variants.length > 20) {
    throw new Error("A product can have at most 20 variants.");
  }
  return variants;
}

export const productVariantInputSchema = z.object({
  name: z.string().trim().min(1, "Each variant needs a name.").max(100, "Variant names must be 100 characters or fewer."),
  priceTaka: z.number().finite().min(0, "Variant prices must be ৳0 or more.").max(100_000_000).optional(),
  stock: z.number().int("Variant stock must be a whole number.").min(0, "Variant stock cannot be negative.").max(1_000_000),
});

/** Server-side validation for create / update product input. */
export const productInputSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(200, "Title must be 200 characters or fewer."),
  categorySlug: z
    .string()
    .trim()
    .min(1, "Please choose a category.")
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Please choose a valid category."),
  description: z.string().trim().max(2000, "Description must be 2,000 characters or fewer.").optional().default(""),
  priceTaka: z.number().finite("Price must be a number.").min(0, "Price must be ৳0 or more.").max(100_000_000, "Price is too large."),
  compareAtTaka: z
    .number()
    .finite("Compare-at price must be a number.")
    .min(0, "Compare-at price must be ৳0 or more.")
    .max(100_000_000, "Compare-at price is too large.")
    .optional()
    .nullable(),
  stock: z.number().int("Stock must be a whole number.").min(0, "Stock cannot be negative.").max(1_000_000),
  status: z.enum(["draft", "active", "paused"]),
  imagePath: z
    .string()
    .trim()
    .max(500, "Image path is too long.")
    .optional()
    .default("")
    .refine(
      (value) => value === "" || isSafeImagePath(value),
      "Image must be a storage path (e.g. /images/products/<slug>.jpg) or an https URL — never a Figma link.",
    ),
  variants: z.array(productVariantInputSchema).max(20, "A product can have at most 20 variants.").optional().default([]),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export const productStatusSchema = z.enum(["active", "paused"]);
