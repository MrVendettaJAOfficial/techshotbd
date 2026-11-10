// Shared server helpers for the Supabase order modules (see
// lib/orders-server.ts barrel). One job: the session, client,
// product-resolution, payment and audit helpers the sibling
// order modules share, so they are defined once, not copied.

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "../../supabase/server";
import { getCurrentUser } from "../../auth-server/session";
import type { StoredOrder } from "../../checkout-store";

export interface DbProductRow {
  id: string;
  seller_id: string | null;
  title: string;
  slug: string;
  price_poisha: number;
  compare_at_poisha: number | null;
  stock: number;
  status: string;
}

export interface DbVariantRow {
  id: string;
  name: string;
  price_override_poisha: number | null;
  stock: number;
}

export interface ResolvedDbLine {
  productId: string;
  variantId: string | null;
  sellerId: string | null;
  title: string;
  price_poisha: number;
  quantity: number;
  stock: number;
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

// The signed-in user's id, or null. Delegates to the same cached
// current-user read the admin page uses (lib/auth-server/session.ts
// getCurrentUser): one request does ONE auth.getUser() no matter how
// many of these helpers run, and the profiles role read is shared
// too. (The separate getSignedInUser below is untouched: it is only
// used by the local-order fallback in status.ts, which needs the
// raw profile role and lower-cased email — not provably the same
// values getCurrentUser returns.)
export async function getSignedInUserId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

/** Signed-in user with email + profile role, or null. Per-request cached — see fetchSignedInUser below. */
const fetchSignedInUser = cache(async (): Promise<{
  id: string;
  email: string;
  role: string | null;
} | null> => {
  let supabase: SupabaseClient;
  try {
    supabase = untyped(createClient());
  } catch {
    return null;
  }
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    let role: string | null = null;
    try {
      const admin = untyped(createAdminClient());
      const { data: profile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      role = (profile?.role as string | null) ?? null;
    } catch {
      role = null;
    }
    return { id: user.id, email: (user.email ?? "").toLowerCase(), role };
  } catch {
    return null;
  }
});

export async function getSignedInUser(): Promise<{
  id: string;
  email: string;
  role: string | null;
} | null> {
  return fetchSignedInUser();
}

/** Latest payments-row status for an order ("unpaid" when there is none). */
export async function latestPaymentStatus(
  admin: SupabaseClient,
  orderId: string,
): Promise<StoredOrder["paymentStatus"]> {
  try {
    const { data: payment } = await admin
      .from("payments")
      .select("status")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (payment?.status === "paid") return "paid";
    if (payment?.status === "failed") return "failed";
    if (payment?.status === "refunded") return "refunded";
    return "unpaid";
  } catch {
    return "unpaid";
  }
}

/**
 * Best-effort audit row for a status change made outside the admin
 * server actions (payment sync / callback). A failure is logged
 * server-side and never fails the order write or reaches the client.
 */
export async function writeOrderAudit(
  admin: SupabaseClient,
  actorId: string | null,
  orderId: string,
  oldStatus: StoredOrder["status"],
  newStatus: StoredOrder["status"],
  source: string,
): Promise<void> {
  try {
    const { error } = await admin.from("audit_log").insert({
      actor_id: actorId,
      action: `order.status:${oldStatus}->${newStatus} (${source})`,
      entity_type: "order",
      entity_id: orderId,
    });
    if (error) {
      console.error("TechShot audit_log insert failed:", error.message);
    }
  } catch (error) {
    console.error(
      "TechShot audit_log insert failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

/** Live product for a local cart slug: exact match, then `<slug>-…`. */
export async function resolveDbProduct(
  admin: SupabaseClient,
  slug: string,
): Promise<DbProductRow | null> {
  const exact = await admin
    .from("products")
    .select("id, seller_id, title, slug, price_poisha, compare_at_poisha, stock, status")
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle();
  if (exact.data) return exact.data as DbProductRow;
  const prefixed = await admin
    .from("products")
    .select("id, seller_id, title, slug, price_poisha, compare_at_poisha, stock, status")
    .like("slug", `${slug}-%`)
    .eq("status", "active")
    .order("slug")
    .limit(1)
    .maybeSingle();
  return (prefixed.data as DbProductRow | null) ?? null;
}
