-- Migration 0011 — hero banner carousel (2026-11-10).
-- APPLIED LIVE 2026-11-10 ("Success. No rows returned";
-- banners table + 5 policies + index verified).
--
-- Adds public.banners: the slides for the home-page hero carousel
-- (app/page.tsx renders them through components/HeroCarousel.tsx).
-- The admin manages them in the admin panel's Banners tab
-- (components/admin/banners-section.tsx, server actions in
-- lib/banners-server.ts): add / edit / reorder / toggle active.
-- A banner with no image shows the TechShot logo placeholder,
-- never a blank area (see components/ProductPlaceholder.tsx).
--
--   * id         uuid — the banner id.
--   * image_path text — Storage filename, storage path or https URL
--     (same rule as product photos: lib/storage-images.ts resolves
--     it; lib/banners/process-banner-image.ts crops an upload to
--     1600 x 640 before it reaches Storage). Empty means "no
--     photo" — the carousel shows the logo placeholder.
--   * headline   text — 1–120 characters, the slide headline.
--   * subcopy    text — 0–300 characters, the line under it.
--   * cta_label  text — 0–40 characters, the button text; empty
--     hides the button.
--   * cta_href   text — the button link, an internal path starting
--     with "/" (e.g. /shop or /product/<slug>); default /shop.
--   * sort_order int — display order, lowest first; ties fall back
--     to created_at.
--   * active     bool — only active banners are shown on the home
--     page; an inactive one stays saved in the admin list.
--   * created_at / updated_at timestamptz.
--
-- When NO banner is active, the home page falls back to the
-- current hero content — the top products as carousel slides —
-- so the home page never shows an empty hero. That fallback lives
-- in lib/hero-slides.ts (productToFallbackSlide) and needs no
-- banners at all, which is why the migration seeds no rows: the
-- admin adds banners after it is applied.
--
-- RLS (mirrored in supabase/policies.sql — keep the two in sync):
--   * any visitor (anon or signed-in) may SELECT active banners —
--     the home page is public and reads them with the anon client;
--   * only staff (Owner, co-admin, manager — is_staff()) may
--     INSERT, UPDATE or DELETE; customers can never manage banners.
--     The server actions enforce the same rule (lib/roles.ts
--     canManageBanners) on every call, so the RLS policy is the
--     second layer, not the only one.
--
-- *** APPLIED LIVE 2026-11-10 ("Success. No rows returned").
-- *** Before it was applied, every banners function returned an
-- *** empty list / a generic error and the Banners tab said
-- *** banners were unavailable, instead of failing the page —
-- *** and the home page kept showing the product fallback slides.
-- *** Safe to run once: the table is created only if missing and
-- *** the policies are dropped first. No data is changed.

create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  image_path text not null default '',
  headline text not null check (char_length(headline) >= 1 and char_length(headline) <= 120),
  subcopy text not null default '' check (char_length(subcopy) <= 300),
  cta_label text not null default '' check (char_length(cta_label) <= 40),
  cta_href text not null default '/shop' check (cta_href like '/%'),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.banners is
  'Hero banner slides for the home-page carousel. Managed by staff in the admin Banners tab; only active banners are shown on the home page. When none is active the home page falls back to product slides.';

comment on column public.banners.image_path is
  'Banner photo: a Supabase Storage filename, storage path or https URL. Empty means no photo — the carousel shows the TechShot logo placeholder. Uploads are cropped to 1600 x 640 before Storage.';

comment on column public.banners.cta_href is
  'Button link: an internal path starting with "/" (e.g. /shop, /shop?category=gaming, /product/<slug>).';

alter table public.banners enable row level security;

-- Anyone may read the active banners (the public home page).
drop policy if exists "banners_select_active" on public.banners;
create policy "banners_select_active" on public.banners
  for select to anon, authenticated
  using (active = true);

-- Staff may read all banners (the admin list needs inactive ones
-- too; the admin reads go through the service-role client anyway,
-- so this policy is the honest path for direct reads).
drop policy if exists "banners_select_staff" on public.banners;
create policy "banners_select_staff" on public.banners
  for select to authenticated
  using (public.is_staff());

-- Only staff may add, change or remove banners.
drop policy if exists "banners_staff_insert" on public.banners;
create policy "banners_staff_insert" on public.banners
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists "banners_staff_update" on public.banners;
create policy "banners_staff_update" on public.banners
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "banners_staff_delete" on public.banners;
create policy "banners_staff_delete" on public.banners
  for delete to authenticated
  using (public.is_staff());

create index if not exists banners_active_sort_idx
  on public.banners (active, sort_order, created_at);
