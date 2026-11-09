// Server-side cart actions for TechShot.
//
// SERVER ONLY. Cart rows are written with the request-scoped client,
// so Row Level Security applies: a user can only touch their own cart
// (see supabase/policies.sql). Product lookups use the service-role
// client (trusted price reads only — never a browser-supplied price).
//
// The local cart (lib/cart-store, localStorage) stays the fallback:
// these actions return null / { ok: false } when Supabase is not
// configured or nobody is signed in, and the caller keeps the local
// cart exactly as before.
//
// Slug note: the live database uses longer slugs than the local seed
// catalogue for some products (e.g. local `apple-iphone-16-pro` vs DB
// `apple-iphone-16-pro-256gb-natural-titanium`, local `netflix-premium`
// vs DB `netflix-premium-1-month`). Resolution tries the exact slug
// first, then the `<slug>-…` prefix, so a local cart line still finds
// its live product.

"use server";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "./supabase/server";
import { getProductForCartSlug } from "./data/catalog";
import { normalizeVariantLabel, variantMatchesOption } from "./catalog-rules";
import { resolveCartLines } from "./orders";
import type { CartItem } from "./cart-store";
import type { OrderItem } from "./checkout-store";

interface DbProductRow {
  id: string;
  slug: string;
  title: string;
  price_poisha: number;
  compare_at_poisha: number | null;
  stock: number;
}

interface DbVariantRow {
  id: string;
  name: string;
  price_override_poisha: number | null;
  stock: number;
}

interface CartItemRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  products: { slug: string } | null;
  product_variants: { name: string } | null;
}

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/**
 * The Supabase Database generic resolves query results to `never`
 * with the installed supabase-js version (see lib/auth-server.ts),
 * so this file talks to the untyped client and casts rows to the
 * local interfaces below. Runtime behaviour is unchanged.
 */
function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

// Per-request cached (React cache()): see fetchSignedInUserId
// above — the same session is re-read by several order actions
// during one request, and each read was a separate Auth round trip.
const fetchSignedInUserId = cache(async (): Promise<string | null> => {
  try {
    const supabase = untyped(createClient());
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
});

async function getSignedInUserId(): Promise<string | null> {
  return fetchSignedInUserId();
}

/** Live product for a local cart slug: exact match, then `<slug>-…`. */
async function resolveDbProduct(
  admin: SupabaseClient,
  slug: string,
): Promise<DbProductRow | null> {
  const exact = await admin
    .from("products")
    .select("id, slug, title, price_poisha, compare_at_poisha, stock")
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (exact.data) return exact.data as DbProductRow;
  const prefixed = await admin
    .from("products")
    .select("id, slug, title, price_poisha, compare_at_poisha, stock")
    .like("slug", `${slug}-%`)
    .eq("status", "active")
    .order("slug")
    .limit(1)
    .maybeSingle();
  return (prefixed.data as DbProductRow | null) ?? null;
}

async function resolveDbVariant(
  admin: SupabaseClient,
  productId: string,
  variantLabel: string | undefined,
): Promise<DbVariantRow | null> {
  if (!variantLabel) return null;
  const { data } = await admin
    .from("product_variants")
    .select("id, name, price_override_poisha, stock")
    .eq("product_id", productId);
  const rows = (data ?? []) as DbVariantRow[];
  // Variant labels are compared space- and case-insensitively: the
  // live label "256GB Natural Titanium" must match a stored variant
  // named "256 GB", and vice versa.
  const wanted = normalizeVariantLabel(variantLabel);
  return (
    rows.find(
      (v) =>
        wanted.startsWith(normalizeVariantLabel(v.name)) ||
        normalizeVariantLabel(v.name).startsWith(wanted),
    ) ?? null
  );
}

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

/**
 * The signed-in user's server cart, as local CartItems, or null when
 * Supabase is not configured / nobody is signed in. Prices are the
 * stored snapshots; totals are always recomputed from live prices at
 * checkout, never from these.
 */
export async function getServerCart(): Promise<CartItem[] | null> {
  if (!isConfigured()) return null;
  const userId = await getSignedInUserId();
  if (!userId) return null;
  let supabase: SupabaseClient;
  try {
    supabase = untyped(createClient());
  } catch {
    return null;
  }
  const { data: cart } = await supabase
    .from("carts")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!cart) return [];
  const { data: rows, error } = await supabase
    .from("cart_items")
    .select("id, product_id, variant_id, quantity, products(slug), product_variants(name)")
    .eq("cart_id", cart.id)
    .order("created_at", { ascending: true });
  if (error || !rows) return [];
  const items: CartItem[] = [];
  for (const row of rows as unknown as CartItemRow[]) {
    const slug = row.products?.slug;
    if (!slug || row.quantity <= 0) continue;
    items.push({
      slug,
      variant: row.product_variants?.name ?? undefined,
      quantity: row.quantity,
    });
  }
  return items;
}

export type SyncCartResult = { ok: true } | { ok: false; message: string };

/**
 * Persist one cart line server-side (insert / update / delete when
 * quantity is 0). The price snapshot is re-derived from the live
 * product price plus the server-side catalogue's storage-option delta
 * for the variant — the browser never supplies a price. No-op (ok)
 * when signed out or unconfigured; the local cart is the fallback.
 */
export async function syncCartItem(
  slug: string,
  variant: string | undefined,
  quantity: number,
): Promise<SyncCartResult> {
  if (!isConfigured()) return { ok: true };
  const userId = await getSignedInUserId();
  if (!userId) return { ok: true };
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  try {
    supabase = untyped(createClient());
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, message: "Could not save your cart. Please try again." };
  }
  const product = await resolveDbProduct(admin, slug);
  if (!product) {
    // Unknown to the live catalogue: nothing to sync server-side.
    return { ok: true };
  }
  const dbVariant = await resolveDbVariant(admin, product.id, variant);
  const local = getProductForCartSlug(slug);
  const option = local?.storageOptions?.find(
    (o) => variantMatchesOption(variant, o.label),
  );
  const priceSnapshot =
    (dbVariant?.price_override_poisha ?? product.price_poisha) +
    (option?.priceDeltaPoisha ?? 0);

  // Ensure the user has a cart row (one per user).
  let { data: cart } = await supabase
    .from("carts")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!cart) {
    const inserted = await supabase
      .from("carts")
      .insert({ user_id: userId })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      return { ok: false, message: "Could not save your cart. Please try again." };
    }
    cart = inserted.data;
  }

  const variantFilter = dbVariant
    ? supabase
        .from("cart_items")
        .select("id")
        .eq("cart_id", cart.id)
        .eq("product_id", product.id)
        .eq("variant_id", dbVariant.id)
        .maybeSingle()
    : supabase
        .from("cart_items")
        .select("id")
        .eq("cart_id", cart.id)
        .eq("product_id", product.id)
        .is("variant_id", null)
        .maybeSingle();
  const { data: existing } = await variantFilter;

  if (quantity <= 0) {
    if (existing) {
      await supabase.from("cart_items").delete().eq("id", existing.id);
    }
    return { ok: true };
  }
  if (existing) {
    const { error } = await supabase
      .from("cart_items")
      .update({ quantity, price_snapshot_poisha: priceSnapshot })
      .eq("id", existing.id);
    if (error) {
      return { ok: false, message: "Could not save your cart. Please try again." };
    }
    return { ok: true };
  }
  const { error } = await supabase.from("cart_items").insert({
    cart_id: cart.id,
    product_id: product.id,
    variant_id: dbVariant?.id ?? null,
    quantity,
    price_snapshot_poisha: priceSnapshot,
  });
  if (error) {
    return { ok: false, message: "Could not save your cart. Please try again." };
  }
  return { ok: true };
}

/** Remove every line from the signed-in user's server cart. */
export async function clearServerCart(): Promise<{ ok: true }> {
  if (!isConfigured()) return { ok: true };
  const userId = await getSignedInUserId();
  if (!userId) return { ok: true };
  try {
    const supabase = untyped(createClient());
    const { data: cart } = await supabase
      .from("carts")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (cart) {
      await supabase.from("cart_items").delete().eq("cart_id", cart.id);
    }
  } catch {
    // Local cart is the fallback; a failed server clear is not fatal.
  }
  return { ok: true };
}
