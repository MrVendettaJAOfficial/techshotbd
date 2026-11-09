// TechShot marketplace — product variant parsing and schema.
//
// Parses the admin form's comma-separated variant list and
// validates one variant (name, price, stock, photo) with
// zod. Pure apart from zod; no server imports.

import { z } from "zod";

import { isSafeImagePath } from "./image-paths";

export interface ParsedVariant {
  name: string;
  priceTaka?: number;
  stock: number;
  /** Photo for this variant (migration 0005): a Storage filename, a
   *  legacy /images/products/<file>.jpg path, or an https URL.
   *  Absent when the variant has no photo of its own. */
  imagePath?: string;
}

/**
 * Parse the form's comma-separated variant list:
 *   "128GB:89900:10, 256GB:99900:5"  or  "Red::20" (no price override)
 * Each entry is "Name:priceTaka:stock"; price may be empty (use the
 * product price) and stock defaults to 0. An optional fourth segment
 * is the variant's photo: "Black Titanium::10:iphone-black.jpg"
 * (price empty, stock 10, photo set). The photo is validated with
 * the same isSafeImagePath rule as product images. A URL holds its
 * colons: segments after the third are rejoined, so an https photo
 * URL survives the split. Throws an Error with a user-facing
 * message on malformed input.
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
    const imageRaw = parts.slice(3).join(":").trim();
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
    if (imageRaw !== "") {
      if (!isSafeImagePath(imageRaw)) {
        throw new Error(
          `Variant "${name}" has an invalid photo. Use a Supabase Storage filename (e.g. <slug>.jpg), a storage path (e.g. /images/products/<slug>.jpg) or an https URL — never a Figma link.`,
        );
      }
      variant.imagePath = imageRaw;
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
  imagePath: z
    .string()
    .trim()
    .max(500, "Variant photo path is too long.")
    .optional()
    .refine(
      (value) => value === undefined || value === "" || isSafeImagePath(value),
      "Variant photo must be a Supabase Storage filename (e.g. <slug>.jpg), a storage path (e.g. /images/products/<slug>.jpg) or an https URL — never a Figma link.",
    ),
});
