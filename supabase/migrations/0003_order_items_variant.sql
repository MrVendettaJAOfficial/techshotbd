-- TechShot marketplace — order_items variant attribution (migration 0003).
--
-- Background (review fix, 2026-11-08): checkout decrements stock on
-- the product row OR on a product_variants row when the line has a
-- matching variant (see lib/orders-server.ts createSupabaseOrder), but
-- order_items recorded neither — so a later cancel / refund could not
-- know which row to restore, and restoring to the product row would
-- over-restore a variant-decremented line. This column records the
-- variant row each order line decremented; the app fills it
-- best-effort right after creating the order, and the cancel / refund
-- stock restore (lib/orders/stock.ts restoreOrderStock) uses it when
-- present and falls back to the product row only when the product has
-- no variant rows at all.
--
-- Apply in the Supabase SQL Editor AFTER 0002_profile_trigger.sql.
-- It is safe to run on the live TechshotBD project: the column is
-- added only if missing, existing rows keep variant_id NULL (their
-- restores fall back exactly as before), and no data is changed.
-- The app works with or without this migration — without it, variant
-- attribution is simply unavailable and the restore falls back — but
-- apply it before relying on cancel / refund stock restores for
-- variant products.

alter table public.order_items
  add column if not exists variant_id uuid references public.product_variants (id) on delete set null;

create index if not exists order_items_variant_id_idx
  on public.order_items (variant_id);
