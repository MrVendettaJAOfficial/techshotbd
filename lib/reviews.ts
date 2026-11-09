// TechShot marketplace — product reviews from real review rows.
//
// SERVER ONLY. Ratings on the storefront come ONLY from rows in the
// `reviews` table — never from the seeded products.rating /
// review_count columns, which are fabricated (see
// lib/supabase/catalog.ts). listProductReviews computes the average
// (rounded to 1 decimal, 0 when there are no reviews) and the count
// from those rows, and submitReview enforces the existing rule from
// lib/orders-server.ts submitSupabaseReview: the caller must be
// signed in AND own a delivered order containing the product.
//
// Reviews are publicly readable (reviews_select_all in
// supabase/policies.sql), so the list reads through the anon client;
// author display names come from profiles, which only the owner may
// read under RLS, so names are resolved best-effort with the
// service-role client and fall back to a generic name. Review writes
// go through the anon client too (reviews_insert_own), exactly like
// submitSupabaseReview — the service-role client is never used for
// a write the caller could make as themselves.
//
// When Supabase is not configured, the list is empty and submitting
// returns an error — no fabricated reviews, ever.

"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient, createClient } from "./supabase/server";

/**
 * The Supabase Database generic resolves query results to `never`
 * with the installed supabase-js version (see lib/orders-server.ts),
 * so this file talks to the untyped client and casts rows to the
 * local shapes below. Runtime behaviour is unchanged.
 */
function untyped(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export interface ProductReviewItem {
  id: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface ProductReviews {
  rating: number;
  count: number;
  reviews: ProductReviewItem[];
}

const EMPTY_PRODUCT_REVIEWS: ProductReviews = { rating: 0, count: 0, reviews: [] };

const MAX_COMMENT_CHARS = 1000;

/** Average rating rounded to 1 decimal, 0 when there are no reviews. Pure helper, kept private: this file is a "use server" module (ProductGallery calls submitReview from the browser), and Next.js only allows async function exports from one — a sync export breaks the production build. */
function averageRating(ratings: number[]): number {
  if (ratings.length === 0) return 0;
  const sum = ratings.reduce((total, rating) => total + rating, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}

async function getSignedInUserId(): Promise<string | null> {
  try {
    const supabase = untyped(createClient());
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/** Resolve a product id or slug to its database id, or null. */
async function resolveProductId(
  admin: SupabaseClient,
  productIdOrSlug: string,
): Promise<string | null> {
  const byId = await admin
    .from("products")
    .select("id")
    .eq("id", productIdOrSlug)
    .maybeSingle();
  if (byId.data) return (byId.data as { id: string }).id;
  const bySlug = await admin
    .from("products")
    .select("id")
    .eq("slug", productIdOrSlug)
    .maybeSingle();
  if (bySlug.data) return (bySlug.data as { id: string }).id;
  return null;
}

/**
 * Real reviews for a product, newest first, with the average rating
 * and count computed ONLY from the reviews table. `productId` is a
 * product id (a slug is accepted too, for callers that only have
 * one). Returns an empty result when Supabase is not configured or
 * the product does not exist — never fabricated numbers.
 */
export async function listProductReviews(productId: string): Promise<ProductReviews> {
  if (typeof productId !== "string" || productId.trim() === "" || !isConfigured()) {
    return { ...EMPTY_PRODUCT_REVIEWS, reviews: [] };
  }
  let supabase: SupabaseClient;
  let admin: SupabaseClient | null = null;
  try {
    supabase = untyped(createClient());
  } catch {
    return { ...EMPTY_PRODUCT_REVIEWS, reviews: [] };
  }
  try {
    admin = untyped(createAdminClient());
  } catch {
    admin = null;
  }
  const dbProductId = admin ? await resolveProductId(admin, productId.trim()) : null;
  if (!dbProductId) return { ...EMPTY_PRODUCT_REVIEWS, reviews: [] };

  const { data, error } = await supabase
    .from("reviews")
    .select("id, user_id, rating, text, created_at")
    .eq("product_id", dbProductId)
    .order("created_at", { ascending: false });
  if (error || !data) return { ...EMPTY_PRODUCT_REVIEWS, reviews: [] };
  const rows = data as Array<{
    id: string;
    user_id: string;
    rating: number;
    text: string | null;
    created_at: string;
  }>;

  let nameByUserId = new Map<string, string>();
  if (admin && rows.length > 0) {
    try {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, display_name")
        .in(
          "id",
          [...new Set(rows.map((row) => row.user_id))],
        );
      nameByUserId = new Map(
        ((profiles ?? []) as Array<{ id: string; display_name: string | null }>).map((p) => [
          p.id,
          p.display_name ?? "TechShot customer",
        ]),
      );
    } catch {
      // Names stay generic below; the reviews themselves still list.
    }
  }

  return {
    rating: averageRating(rows.map((row) => row.rating)),
    count: rows.length,
    reviews: rows.map((row) => ({
      id: row.id,
      authorName: nameByUserId.get(row.user_id) ?? "TechShot customer",
      rating: row.rating,
      comment: row.text ?? "",
      createdAt: row.created_at,
    })),
  };
}

export type SubmitReviewResult = { ok: true } | { ok: false; message: string };

/**
 * Submit a review for a product. Requires a signed-in user AND a
 * delivered order of theirs containing the product (the existing
 * rule from submitSupabaseReview in lib/orders-server.ts — an
 * orderId is not taken from the caller, so the delivered order is
 * found from the caller's own orders instead). Rating must be 1–5;
 * the comment is trimmed and at most 1000 characters (an empty
 * comment is allowed — a rating on its own is a review). One review
 * per user / product / order (the database unique constraint):
 * submitting again for the same delivered order reports that
 * plainly instead of a generic failure.
 */
export async function submitReview(
  productId: string,
  rating: number,
  comment: string,
): Promise<SubmitReviewResult> {
  if (!isConfigured()) return { ok: false, message: "Reviews are not available right now." };
  const userId = await getSignedInUserId();
  if (!userId) return { ok: false, message: "Sign in to write a review." };
  const cleanRating = Math.floor(rating);
  if (!Number.isFinite(cleanRating) || cleanRating < 1 || cleanRating > 5) {
    return { ok: false, message: "Rating must be between 1 and 5." };
  }
  const text = (comment ?? "").trim().slice(0, MAX_COMMENT_CHARS);
  if (typeof productId !== "string" || productId.trim() === "") {
    return { ok: false, message: "Product not found." };
  }
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  try {
    supabase = untyped(createClient());
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, message: "Reviews are not available right now." };
  }
  const dbProductId = await resolveProductId(admin, productId.trim());
  if (!dbProductId) return { ok: false, message: "Product not found." };

  // The caller must own a DELIVERED order containing the product.
  // Read through the anon client, so RLS limits the rows to the
  // caller's own orders — an order id from the browser is never
  // trusted, and one is not even accepted here.
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_items(product_id)")
    .eq("user_id", userId)
    .eq("status", "delivered");
  const deliveredOrder = ((orders ?? []) as Array<{
    id: string;
    order_items?: Array<{ product_id: string }>;
  }>).find((order) => (order.order_items ?? []).some((item) => item.product_id === dbProductId));
  if (!deliveredOrder) {
    return {
      ok: false,
      message: "You can only review products from a delivered order.",
    };
  }

  const { error } = await supabase.from("reviews").insert({
    user_id: userId,
    product_id: dbProductId,
    order_id: deliveredOrder.id,
    rating: cleanRating,
    text: text || null,
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, message: "You have already reviewed this product for this order." };
    }
    return { ok: false, message: "Could not save your review. Please try again." };
  }
  return { ok: true };
}
