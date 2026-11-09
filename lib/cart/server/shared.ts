// Shared server helpers for the cart modules (see lib/cart-server.ts
// barrel). One job: the per-request session read and the live
// product / variant resolution (exact slug, then `<slug>-…`).

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "../../supabase/server";
import { normalizeVariantLabel } from "../../catalog-rules";

export interface DbProductRow {
  id: string;
  slug: string;
  title: string;
  price_poisha: number;
  compare_at_poisha: number | null;
  stock: number;
}

export interface DbVariantRow {
  id: string;
  name: string;
  price_override_poisha: number | null;
  stock: number;
}

export interface CartItemRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  products: { slug: string } | null;
  product_variants: { name: string } | null;
}

export function isConfigured(): boolean {
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
export function untyped(client: unknown): SupabaseClient {
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

export async function getSignedInUserId(): Promise<string | null> {
  return fetchSignedInUserId();
}

/** Live product for a local cart slug: exact match, then `<slug>-…`. */
export async function resolveDbProduct(
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

export async function resolveDbVariant(
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
