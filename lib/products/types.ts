// TechShot marketplace — shared product shapes for the admin
// dashboard. Plain data only, so server components can pass
// these as props to client components.

import type { ProductStatus } from "./validation";

export type { ProductStatus };

export interface ProductVariantItem {
  name: string;
  /** Price in BDT taka, or null to use the product price. */
  priceTaka: number | null;
  stock: number;
  /** Photo for this variant (product_variants.image_path, migration
   *  0005), or null when the variant has no photo of its own. */
  imagePath: string | null;
}

export interface ProductListItem {
  id: string;
  title: string;
  slug: string;
  description: string;
  pricePoisha: number;
  compareAtPoisha: number | null;
  stock: number;
  status: ProductStatus;
  categorySlug: string | null;
  categoryName: string;
  /** Always null: every product is store-owned (single-seller store).
   *  Kept because the products table still has the seller_id column. */
  sellerId: string | null;
  /** First product image path, or null when there is none. */
  imagePath: string | null;
  /**
   * Every product image path, in display order (product_images
   * sort_order) — the first entry is `imagePath`. The admin form
   * edits this list; the storefront gallery shows it.
   */
  imagePaths: string[];
  variants: ProductVariantItem[];
  createdAt: string;
}

export interface CategoryOption {
  slug: string;
  name: string;
}

/** What every product server action returns. Errors are generic on
 *  purpose: never a stack trace, SQL, or table name. */
export type ProductActionResult = { ok: true; slug: string } | { ok: false; error: string };

/**
 * What the photo-upload server action returns. On success, `files`
 * are the Storage filenames that were uploaded (flat at the bucket
 * root) — the admin form fills them into the product's photo list.
 * The files are uploaded immediately; the product_images rows are
 * only written when the product itself is saved, so uploading
 * without saving leaves unreferenced files in the bucket (harmless,
 * and never deleted automatically — a file may be referenced by
 * another product).
 */
export type ProductImageUploadResult =
  | { ok: true; files: string[] }
  | { ok: false; error: string };
