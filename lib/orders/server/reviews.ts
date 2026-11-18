"use server";

// Supabase review submission (lib/orders-server.ts). One job:
// submitSupabaseReview — only for a delivered order the caller owns.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "../../supabase/server";
import {
  getSignedInUserId,
  isConfigured,
  resolveDbProduct,
  untyped,
} from "./shared";

export async function submitSupabaseReview(input: {
  productSlug: string;
  orderId: string;
  rating: number;
  text?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isConfigured()) return { ok: false, message: "Reviews are not available right now." };
  const userId = await getSignedInUserId();
  if (!userId) return { ok: false, message: "Sign in to write a review." };
  const rating = Math.floor(input.rating);
  if (rating < 1 || rating > 5) {
    return { ok: false, message: "Rating must be between 1 and 5." };
  }
  const text = (input.text ?? "").trim().slice(0, 1000);
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  try {
    supabase = untyped(createClient());
    admin = untyped(createAdminClient());
  } catch {
    return { ok: false, message: "Reviews are not available right now." };
  }
  const product = await resolveDbProduct(admin, input.productSlug);
  if (!product) return { ok: false, message: "Product not found." };
  // The order must be the caller's, delivered, and contain the product.
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_items(product_id)")
    .eq("id", input.orderId)
    .eq("user_id", userId)
    .eq("status", "delivered")
    .maybeSingle();
  const items = (order as unknown as { order_items?: Array<{ product_id: string }> } | null)
    ?.order_items;
  if (!order || !(items ?? []).some((it) => it.product_id === product.id)) {
    return {
      ok: false,
      message: "You can only review products from a delivered order.",
    };
  }
  // This path reviews ONE caller-chosen order, so there is no
  // order to pick — unlike submitReview in lib/reviews.ts, which
  // finds the order itself and must skip already-reviewed ones
  // (audit run-1, LOW 13). The same unique constraint still
  // applies here: a second submit for the same order collides
  // (23505), and the caller deserves the accurate message, not a
  // generic failure.
  const { error } = await supabase.from("reviews").insert({
    user_id: userId,
    product_id: product.id,
    order_id: input.orderId,
    rating,
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
