// TechShot marketplace — seed catalogue shapes.
//
// The storefront Product / Category / SubscriptionPlan shapes
// for the local seed catalogue (mirrored by the mapped live
// shapes in lib/catalog/db-types.ts). Plain types only.

export type Category = {
  slug: string;
  name: string;
  tagline: string;
};

export type StorageOption = {
  label: string;
  priceDeltaPoisha: number;
  stock: number;
};

export type Product = {
  slug: string;
  title: string;
  variant: string;
  price_poisha: number;
  compare_at_poisha: number;
  rating: number;
  review_count: number;
  stock: number;
  category: string;
  /**
   * Every category this product belongs to, the primary category
   * first. A product with no extra memberships has exactly one
   * entry — its primary category. The shop filter matches any
   * entry; the flash-deal section reads membership in "flash-deals".
   * The local seed catalogue fills this in the PRODUCTS export
   * (lib/data/catalog/seed-products.ts); the live mapper fills it
   * from the product_categories join table.
   */
  categorySlugs: string[];
  brand: string;
  badge?: string;
  flash?: boolean;
  condition: "New" | "Refurbished";
  image: string;
  /**
   * Every photo for this product, in display order. The first entry
   * is always `image`; the gallery shows the whole list. Only
   * products with more than one photo set this — a single-photo
   * product leaves it unset and the gallery falls back to `image`.
   * (The live catalogue fills it from product_images rows; see
   * lib/catalog-rules.ts mapDbProductToCatalog.)
   */
  gallery?: string[];
  description: string;
  specs: Record<string, string>;
  colours?: string[];
  storageOptions?: StorageOption[];
  /** Photo per variant, keyed by exact variant name (colour or
   *  storage label). Only variants with a photo set are present;
   *  see lib/catalog-rules.ts resolveVariantImage. No seed product
   *  sets this — no real per-colour photos exist yet. */
  variantImages?: Record<string, string>;
};

export type SubscriptionPlan = {
  slug: string;
  name: string;
  price_poisha: number;
  period: string;
  tagline: string;
  productSlug: string;
};
