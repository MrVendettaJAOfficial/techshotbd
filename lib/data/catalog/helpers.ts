// TechShot marketplace — seed catalogue lookups.
//
// Pure helpers over the seed data: find a product by slug,
// resolve a cart slug to a seed product, related products,
// search and category names. No imports except the seed
// data itself.

import { CATEGORIES, PRODUCTS } from "./seed-products";

import type { Product } from "./types";

export function getProduct(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

/**
 * Resolve a cart slug to a seed-catalogue product.
 *
 * The live storefront sells products under their Supabase slugs, which
 * are longer than the local seed slugs for some products (the live
 * database has `apple-iphone-16-pro-256gb-natural-titanium` where the
 * seed catalogue has `apple-iphone-16-pro`, and `netflix-premium-1-month`
 * where the seed has `netflix-premium`). The local product is the one
 * whose slug is a `<slug>-…` prefix of the cart slug — the same rule the
 * server-side cart / order code uses in reverse (see lib/cart-server.ts
 * and lib/orders-server.ts). Exact match wins; otherwise the longest
 * matching prefix wins, so a cart slug can never resolve to the wrong
 * product when two local slugs share a prefix. Returns undefined only
 * when the slug matches no seed product at all (a product added in the
 * admin that has no seed counterpart) — those lines are priced from
 * the live database instead (see getPricedCartLines in
 * lib/cart-server.ts), never from here.
 */
export function getProductForCartSlug(slug: string): Product | undefined {
  const exact = getProduct(slug);
  if (exact) return exact;
  let best: Product | undefined;
  for (const product of PRODUCTS) {
    if (
      slug.startsWith(`${product.slug}-`) &&
      (!best || product.slug.length > best.slug.length)
    ) {
      best = product;
    }
  }
  return best;
}

export function getRelated(product: Product, n: number): Product[] {
  const sameCategory = PRODUCTS.filter(
    (p) => p.slug !== product.slug && p.category === product.category,
  );
  const others = PRODUCTS.filter(
    (p) => p.slug !== product.slug && p.category !== product.category,
  );
  return [...sameCategory, ...others].slice(0, n);
}

export function searchProducts(query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return PRODUCTS;
  return PRODUCTS.filter((p) =>
    [p.title, p.brand, p.variant, p.description, p.category]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}

export function categoryName(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;
}
