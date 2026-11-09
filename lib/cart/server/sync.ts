"use server";

// Server-cart persistence (lib/cart-server.ts). One job: read,
// sync (insert / update / delete one line) and clear the signed-in
// user's server cart. No-op when signed out or unconfigured.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "../../supabase/server";
import { getProductForCartSlug } from "../../data/catalog";
import { variantMatchesOption } from "../../catalog-rules";
import type { CartItem } from "../../cart-store";
import {
  getSignedInUserId,
  isConfigured,
  resolveDbProduct,
  resolveDbVariant,
  untyped,
  type CartItemRow,
} from "./shared";

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
