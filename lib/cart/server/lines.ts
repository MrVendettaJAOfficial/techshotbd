"use server";

// Priced cart lines from the live database (lib/cart-server.ts).
// One job: getPricedCartLines — live prices with a seed-catalogue
// fallback per line; the browser never supplies a price.

import { createAdminClient } from "../../supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProductForCartSlug } from "../../data/catalog";
import { normalizeVariantLabel, variantMatchesOption } from "../../catalog-rules";
import { resolveCartLines } from "../../orders";
import type { CartItem } from "../../cart-store";
import type { OrderItem } from "../../checkout-store";
import {
  isConfigured,
  resolveDbProduct,
  resolveDbVariant,
  untyped,
  type DbProductRow,
} from "./shared";

export interface PricedCartLines {
  lines: OrderItem[];
  unknownSlugs: string[];
  /** Lines whose quantity exceeds live stock, as user-facing messages. */
  stockErrors: string[];
}

/**
 * Price cart lines from the LIVE database when Supabase is configured,
 * falling back to the seed catalogue per line (and entirely when
 * unconfigured). This is what the cart page, the checkout form and the
 * checkout action display and charge from, so a product added in the
 * admin — which has a live slug and a live price but no seed counterpart
 * — still shows a price, a total and a working checkout instead of
 * "no longer available". Prices come from the `products` /
 * `product_variants` tables plus the seed catalogue's storage-option
 * delta for the variant; the browser never supplies a price. Stock is
 * checked against the live row, so an over-quantity line is reported in
 * stockErrors instead of being silently priced.
 *
 * Safe to call from the browser: it only reads public product prices
 * for the caller's own cart slugs, and returns the same OrderItem shape
 * as the local resolver.
 */
export async function getPricedCartLines(
  items: CartItem[],
): Promise<PricedCartLines> {
  if (!items || items.length === 0) {
    return { lines: [], unknownSlugs: [], stockErrors: [] };
  }
  if (!isConfigured()) {
    const { lines, unknownSlugs } = resolveCartLines(items);
    return { lines, unknownSlugs, stockErrors: [] };
  }
  let admin: SupabaseClient;
  try {
    admin = untyped(createAdminClient());
  } catch {
    const { lines, unknownSlugs } = resolveCartLines(items);
    return { lines, unknownSlugs, stockErrors: [] };
  }
  const lines: OrderItem[] = [];
  const unknownSlugs: string[] = [];
  const stockErrors: string[] = [];
  for (const item of items) {
    let dbProduct: DbProductRow | null = null;
    try {
      dbProduct = await resolveDbProduct(admin, item.slug);
    } catch {
      // Live lookup failed (network / transient): fall back to the
      // seed catalogue for this line instead of breaking the cart.
      dbProduct = null;
    }
    if (!dbProduct) {
      // No live product (e.g. a seed-only slug, or the live row was
      // removed): fall back to the seed catalogue for this line.
      const local = resolveCartLines([item]);
      if (local.lines.length > 0) lines.push(...local.lines);
      else unknownSlugs.push(...local.unknownSlugs);
      continue;
    }
    const dbVariant = await resolveDbVariant(admin, dbProduct.id, item.variant);
    const local = getProductForCartSlug(item.slug);
    const option = local?.storageOptions?.find(
      (o) => variantMatchesOption(item.variant, o.label),
    );
    const delta = option?.priceDeltaPoisha ?? 0;
    const unitPrice =
      (dbVariant?.price_override_poisha ?? dbProduct.price_poisha) + delta;
    const quantity = Math.max(1, item.quantity);
    const stock = dbVariant?.stock ?? dbProduct.stock;
    if (quantity > stock) {
      stockErrors.push(
        `${dbProduct.title}: only ${stock} in stock, you asked for ${quantity}.`,
      );
      continue;
    }
    lines.push({
      productId: item.slug,
      title: dbProduct.title,
      variant: item.variant ?? dbVariant?.name ?? local?.variant,
      price_poisha: unitPrice,
      mrp_poisha: (dbProduct.compare_at_poisha ?? unitPrice) + delta,
      image: local?.image,
      quantity,
    });
  }
  return { lines, unknownSlugs, stockErrors };
}
