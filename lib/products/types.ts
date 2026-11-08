// TechShot marketplace — shared product shapes for the seller /
// admin dashboards. Plain data only, so server components can pass
// these as props to client components.

import type { ProductStatus } from "./validation";

export type { ProductStatus };

export interface ProductVariantItem {
  name: string;
  /** Price in BDT taka, or null to use the product price. */
  priceTaka: number | null;
  stock: number;
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
  /** Null for platform-owned products. */
  sellerId: string | null;
  /** First product image path, or null when there is none. */
  imagePath: string | null;
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
