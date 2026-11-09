-- Migration 0005 — per-variant photo (2026-11-09).
--
-- A variant (a colour, or a storage option) can now carry its own
-- photo, so the product gallery shows the selected colour's photo
-- instead of always showing the product's single main photo.
--
-- Design choice: one nullable `image_path` column on
-- product_variants, rather than a `variant_id` column on
-- product_images. A variant has at most one photo, the value sits
-- next to the variant it belongs to (the admin form already edits
-- variants as rows), and no extra join is needed. product_images
-- stays the general per-product gallery. The value is a Storage
-- filename / legacy local path / https URL, exactly like
-- product_images.storage_path, and resolves through the same helper
-- (lib/storage-images.ts) into the public `product-images` bucket;
-- no new bucket.
--
-- No seed values: no real per-colour photos exist yet (the 14 photos
-- in Storage are per-product shots, and the 3 extra iPhone files are
-- angles, not colours), so every variant starts with image_path
-- NULL and the gallery falls back to the product photo until a real
-- per-colour photo is uploaded and set in /admin. The mock Supabase
-- (tests/e2e/mock-supabase.mjs) seeds one stand-in variant image
-- only to prove the switching works in Playwright — it is not a
-- real colour photo and is not seeded here.
--
-- RLS: unchanged. product_variants is already readable by the
-- storefront (the catalogue select fetches variant rows for shoppers)
-- and writable by admins only; this adds a column, not a new table,
-- so no policy change is needed. Apply in the Supabase SQL Editor
-- like migrations 0002–0004.

alter table public.product_variants
  add column if not exists image_path text;

comment on column public.product_variants.image_path is
  'Photo for this variant (colour / storage option): a Supabase Storage filename, a legacy /images/products/<file>.jpg path, or an https URL. NULL means the gallery shows the product photo.';
