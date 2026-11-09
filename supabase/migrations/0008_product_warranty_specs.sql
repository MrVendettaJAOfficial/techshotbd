-- Migration 0008 — product warranty and specifications (2026-11-09).
--
-- Adds two columns to public.products:
--   * warranty       text   — nullable; the warranty offered with the
--     product, e.g. '1 year official warranty'. NULL means no
--     warranty is stated.
--   * specifications jsonb — not null, default '[]'::jsonb; a list of
--     key/value pairs, e.g.
--       [{"key": "Display", "value": "6.1-inch OLED"},
--        {"key": "Battery", "value": "3,274 mAh"}]
--     An empty list means no specifications are listed yet.
--
-- The same change is mirrored in supabase/policies.sql (the
-- canonical file for a fresh setup) — keep the two in sync. Apply in
-- the Supabase SQL Editor AFTER 0007. Safe to run once: both columns
-- are added only if missing, and existing rows keep warranty NULL
-- and specifications '[]'. No data is changed. RLS is unchanged —
-- products policies already cover the whole row, so staff access to
-- these columns follows the same rules as the rest of the product
-- (see migration 0006).

alter table public.products
  add column if not exists warranty text;

alter table public.products
  add column if not exists specifications jsonb not null default '[]'::jsonb;

comment on column public.products.warranty is
  'Warranty offered with the product, e.g. ''1 year official warranty''. NULL means no warranty is stated.';

comment on column public.products.specifications is
  'Specification list as a JSON array of key/value objects: [{"key": "...", "value": "..."}]. Empty array means no specifications are listed yet.';
