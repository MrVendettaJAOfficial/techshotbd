// TechShot marketplace — product input zod schemas.
//
// Server-side validation for create / update product input:
// title, category, prices, stock, status, photos, variants,
// warranty and specifications. Pure apart from zod; no
// server imports.

import { z } from "zod";

import { MAX_PRODUCT_IMAGES, isSafeImagePath } from "./image-paths";
import { productVariantInputSchema } from "./variants";

export type ProductStatus = "draft" | "active" | "paused";

/** Longest warranty text, in characters (products.warranty, migration 0008). */
export const MAX_WARRANTY_CHARS = 200;

/** Most specification entries per product (products.specifications, migration 0008). */
export const MAX_SPECIFICATIONS = 30;

/** Longest specification key / value, in characters. */
export const MAX_SPEC_KEY_CHARS = 80;
export const MAX_SPEC_VALUE_CHARS = 200;

/** One product specification: a trimmed key/value pair. */
export const productSpecificationSchema = z.object({
  key: z.string().trim().min(1, "Each specification needs a key.").max(MAX_SPEC_KEY_CHARS, "Specification keys must be 80 characters or fewer."),
  value: z.string().trim().max(MAX_SPEC_VALUE_CHARS, "Specification values must be 200 characters or fewer."),
});

export type ProductSpecification = z.infer<typeof productSpecificationSchema>;

/**
 * A product's specifications: at most 30 entries, with no duplicate
 * keys (compared trimmed and case-insensitively — "Display" and
 * "display" are the same key). Stored as jsonb in
 * products.specifications (migration 0008, default '[]').
 */
export const productSpecificationsSchema = z
  .array(productSpecificationSchema)
  .max(MAX_SPECIFICATIONS, "A product can have at most 30 specifications.")
  .superRefine((specs, ctx) => {
    const seen = new Set<string>();
    for (const spec of specs) {
      const key = spec.key.trim().toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Specification "${spec.key}" is listed more than once.`,
        });
        return;
      }
      seen.add(key);
    }
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
  /**
   * Legacy single photo, kept so an older caller that still sends
   * one photo keeps working. The form sends `imagePaths` instead;
   * mergeImagePaths (above) combines the two, array first.
   */
  imagePath: z
    .string()
    .trim()
    .max(500, "Image path is too long.")
    .optional()
    .default("")
    .refine(
      (value) => value === "" || isSafeImagePath(value),
      "Image must be a Supabase Storage filename (e.g. <slug>.jpg), a storage path (e.g. /images/products/<slug>.jpg) or an https URL — never a Figma link.",
    ),
  /**
   * Every photo for the product, in display order — the first is the
   * main photo. Each entry follows the same isSafeImagePath rule as
   * the single path above; at most 10 photos per product.
   */
  imagePaths: z
    .array(
      z
        .string()
        .trim()
        .max(500, "Image path is too long.")
        .refine(
          (value) => value === "" || isSafeImagePath(value),
          "Image must be a Supabase Storage filename (e.g. <slug>.jpg), a storage path (e.g. /images/products/<slug>.jpg) or an https URL — never a Figma link.",
        ),
    )
    .max(MAX_PRODUCT_IMAGES, "A product can have at most 10 photos.")
    .optional()
    .default([]),
  variants: z.array(productVariantInputSchema).max(20, "A product can have at most 20 variants.").optional().default([]),
  /**
   * Warranty text (products.warranty, migration 0008), e.g. "1 year
   * official warranty". Free text, at most 200 characters. Empty
   * means no warranty text — the admin action stores null.
   */
  warranty: z.string().trim().max(MAX_WARRANTY_CHARS, "Warranty must be 200 characters or fewer.").optional().default(""),
  /**
   * Specifications (products.specifications, migration 0008):
   * key/value pairs, at most 30, no duplicate keys. Stored as
   * jsonb; an empty list stores as [] (the column default).
   */
  specifications: productSpecificationsSchema.optional().default([]),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export const productStatusSchema = z.enum(["active", "paused"]);
