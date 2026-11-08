// TechShot marketplace — stock helpers shared by order creation,
// admin status changes and customer cancel.
//
// Stock writes must be conditional, never read-check-write: two
// concurrent checkouts for the last item must not both succeed, and a
// cancel / refund that loses a status race must restore nothing.
// Supabase has no row-count return on a bare update, so every guarded
// write appends .select("id") and the caller treats "0 rows returned"
// as "the guard failed" (someone else moved first).
//
// These helpers take the untyped Supabase client (see
// lib/orders-server.ts) so unit tests can drive them with a fake
// client that speaks the same query-builder chain.

import type { SupabaseClient } from "@supabase/supabase-js";

export type StockTable = "products" | "product_variants";

/**
 * Add `delta` (negative to decrement) to one row's stock, guarded by
 * the stock value just read: the update only lands when the row still
 * holds that value. Retries once after re-reading, so a single
 * concurrent writer does not fail the order outright. Returns true
 * only when exactly one row was updated.
 */
export async function adjustStockRow(
  client: SupabaseClient,
  table: StockTable,
  id: string,
  delta: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: row, error: readError } = await client
      .from(table)
      .select("stock")
      .eq("id", id)
      .maybeSingle();
    if (readError || !row || typeof row.stock !== "number") return false;
    const current = row.stock as number;
    const { data: updated, error: writeError } = await client
      .from(table)
      .update({ stock: current + delta })
      .eq("id", id)
      .eq("stock", current)
      .select("id");
    if (writeError) return false;
    if (Array.isArray(updated) && updated.length === 1) return true;
    // 0 rows: another writer moved the stock between our read and our
    // write. Re-read once and retry; a second miss means give up.
  }
  return false;
}

/**
 * Conditional decrement used at checkout: set stock to `newStock`
 * only when the row still holds `expectedStock`. Returns true only
 * when exactly one row was updated — false means another checkout
 * took the stock first and the order must fail (with rollback).
 */
export async function decrementStockGuarded(
  client: SupabaseClient,
  table: StockTable,
  id: string,
  expectedStock: number,
  quantity: number,
): Promise<boolean> {
  const { data, error } = await client
    .from(table)
    .update({ stock: expectedStock - quantity })
    .eq("id", id)
    .eq("stock", expectedStock)
    .select("id");
  if (error) return false;
  return Array.isArray(data) && data.length === 1;
}

interface OrderItemRow {
  product_id: string;
  quantity: number;
  variant_id?: string | null;
}

/**
 * Restore stock for every line of an order (cancel / refund). The
 * caller must only call this after its conditional status update
 * succeeded, so a lost race restores nothing.
 *
 * Variant attribution: order_items records the variant in
 * `variant_id` once migration 0003 is applied (createSupabaseOrder
 * fills it best-effort); rows written before that migration have no
 * variant, so their quantity goes back to the product row. Restoring
 * to the product row when the decrement actually hit a variant row
 * would over-restore, so when variant_id is absent but the product
 * HAS variant rows, the line is restored to the product row only when
 * the product has no variants at all — otherwise the restore is
 * skipped and logged server-side by the caller (see
 * lib/orders/actions.ts restoreOrderStock, which reports per-line
 * outcomes). In practice the seed catalogue has no variant rows, so
 * every live line restores exactly the row checkout decremented.
 */
export async function restoreOrderStock(
  client: SupabaseClient,
  orderId: string,
): Promise<{ restored: number; skipped: number }> {
  let items: OrderItemRow[] = [];
  // variant_id exists only after migration 0003; a live database that
  // has not applied it yet must not fail the whole restore.
  try {
    const { data, error } = await client
      .from("order_items")
      .select("product_id, quantity, variant_id")
      .eq("order_id", orderId);
    if (error) throw error;
    items = (data ?? []) as OrderItemRow[];
  } catch {
    const { data } = await client
      .from("order_items")
      .select("product_id, quantity")
      .eq("order_id", orderId);
    items = (data ?? []) as OrderItemRow[];
  }
  let restored = 0;
  let skipped = 0;
  for (const item of items) {
    const quantity = Math.max(0, item.quantity ?? 0);
    if (quantity === 0 || !item.product_id) {
      skipped += 1;
      continue;
    }
    if (item.variant_id) {
      const ok = await adjustStockRow(client, "product_variants", item.variant_id, quantity);
      if (ok) restored += 1;
      else skipped += 1;
      continue;
    }
    // No variant recorded: only restore to the product row when the
    // product has no variant rows (otherwise we cannot know which row
    // checkout decremented — see the header note).
    let hasVariants = false;
    try {
      const { data: variants } = await client
        .from("product_variants")
        .select("id")
        .eq("product_id", item.product_id)
        .limit(1);
      hasVariants = Array.isArray(variants) && variants.length > 0;
    } catch {
      hasVariants = false;
    }
    if (hasVariants) {
      skipped += 1;
      continue;
    }
    const ok = await adjustStockRow(client, "products", item.product_id, quantity);
    if (ok) restored += 1;
    else skipped += 1;
  }
  return { restored, skipped };
}
