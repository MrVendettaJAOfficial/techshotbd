-- Migration 0012 — products in multiple categories (2026-11-10).
-- APPLIED LIVE 2026-11-10 ("Success. No rows returned";
-- join table + 3 policies + index and the Flash deals category
-- row verified; the 1 flagged product got its membership).
--
-- Adds public.product_categories: a join table so one product can
-- belong to SEVERAL categories at once. The product add/edit form
-- in the admin panel (components/product-manager/product-form.tsx)
-- now shows a checkbox list instead of a single Category select:
-- ticking "Flash deals" for a product puts it in the home-page
-- flash-deal section, and it also appears under each of its other
-- selected categories (shop category pages, "all categories").
--
-- This IS the admin control for the flash-deal section — there is
-- no separate flash-deal form. The flash-deal section reads
-- products in the Flash deals category (see
-- lib/catalog/mapping.ts isFlashDealRow), and the shop category
-- filter matches any of a product's categories.
--
--   * product_id  uuid — products.id, ON DELETE CASCADE (deleting
--     a product removes its memberships with it).
--   * category_id uuid — categories.id, ON DELETE CASCADE.
--   * Primary key (product_id, category_id): a product can belong
--     to a category at most once.
--
-- Backwards compatibility — the existing primary category_id on
-- products is UNTOUCHED and keeps working:
--   * a product with no join rows still shows under its primary
--     category (the mapper falls back to category_slug alone);
--   * the legacy is_flash_deal flag still marks a flash deal too,
--     so products flagged before this migration keep showing in
--     the flash section until the admin re-tags them.
--
-- This migration also inserts the "Flash deals" category row
-- idempotently (the seed has none — seed changes do not update
-- the live DB) and, in the same run, gives every product already
-- flagged is_flash_deal = true its Flash deals membership, so the
-- flash section keeps showing the same products the day after
-- this migration runs.
--
-- RLS (mirrored in supabase/policies.sql — keep the two in sync):
--   * any visitor (anon or signed-in) may SELECT memberships —
--     the shop filters by them with the anon client;
--   * only staff (Owner, co-admin, manager — is_staff()) may
--     INSERT, UPDATE or DELETE; customers can never assign
--     categories. The product server actions enforce the same
--     rule (lib/roles.ts canManageProducts / canEditProducts) on
--     every call, so the RLS policy is the second layer, not the
--     only one. The service-role client the actions use bypasses
--     RLS.
--
-- *** APPLIED LIVE 2026-11-10 ("Success. No rows returned").
-- *** Before it was applied, the catalogue loader
-- *** (lib/supabase/catalog.ts) and the admin product queries
-- *** (lib/products/queries.ts) tolerated the missing table and
-- *** fell back to the primary category + the is_flash_deal flag,
-- *** so the shop and the admin panel kept working unchanged.
-- *** Safe to run once: the table is created only if missing, the
-- *** policies are dropped first, and both inserts use
-- *** ON CONFLICT DO NOTHING. No existing row is changed.

create table if not exists public.product_categories (
  product_id uuid not null references public.products (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (product_id, category_id)
);

comment on table public.product_categories is
  'Extra category memberships per product (one row per product per category). The primary category stays on products.category_id; this table only ADDS memberships — e.g. ticking "Flash deals" in the product form puts the product in the flash-deal section as well as under its other categories.';

alter table public.product_categories enable row level security;

-- Anyone may read category memberships (the public shop filters
-- by them).
drop policy if exists "product_categories_select_public" on public.product_categories;
create policy "product_categories_select_public" on public.product_categories
  for select to anon, authenticated
  using (true);

-- Only staff may assign or remove categories.
drop policy if exists "product_categories_staff_insert" on public.product_categories;
create policy "product_categories_staff_insert" on public.product_categories
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists "product_categories_staff_delete" on public.product_categories;
create policy "product_categories_staff_delete" on public.product_categories
  for delete to authenticated
  using (public.is_staff());

create index if not exists product_categories_category_idx
  on public.product_categories (category_id, product_id);

-- The "Flash deals" category itself (idempotent): the seed has no
-- such category, and seed changes do not update the live DB, so the
-- migration creates it here. sort_order 10 puts it after the nine
-- seeded categories, so it does not push any tile off the home
-- page's eight category tiles.
insert into public.categories (name, slug, sort_order, is_active) values
  ('Flash deals', 'flash-deals', 10, true)
on conflict (slug) do nothing;

-- Every product already flagged as a flash deal (is_flash_deal)
-- gets its Flash deals membership, so the flash section shows the
-- same products the day after this migration runs. A product
-- flagged later gets its membership from the admin form instead.
insert into public.product_categories (product_id, category_id)
select p.id, c.id
from public.products p
cross join public.categories c
where p.is_flash_deal = true
  and c.slug = 'flash-deals'
on conflict (product_id, category_id) do nothing;
