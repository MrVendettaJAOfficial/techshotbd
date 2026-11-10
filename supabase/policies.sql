-- TechShot marketplace — Row Level Security policies.
-- Apply AFTER supabase/migrations/0001_initial_schema.sql. RLS is already
-- enabled on every table there, so with no policy a row is invisible
-- (default deny). This file is idempotent: every policy is dropped first.
--
-- LIVE DATABASES apply the numbered migrations instead
-- (0006_roles, 0007_order_returned, 0008_product_warranty_specs,
-- 0009_announcements, 0010_manager_product_update,
-- 0011_banners, 0012_product_categories, 0013_banner_kind —
-- 0011 and 0012 were applied live 2026-11-10; 0013 is NOT
-- applied live yet, 2026-11-10).
-- This file mirrors those migrations (see "Fresh-install mirror"
-- below) so a fresh install that only runs 0001 + this file reaches
-- exactly the same state. Every mirrored statement is idempotent, so
-- applying both paths is safe. Keep this file and the migrations in
-- sync.
--
-- Rules:
--   * Visitors (anon) may read active products / categories only.
--   * Customers may only touch their own profile, addresses, cart,
--     wishlist, orders and reviews.
--   * Sellers may only touch their own products, images, variants and
--     order_items.
--   * Roles: 'admin' is the Owner; 'co_admin' is a second admin;
--     'manager' is staff. is_admin() still means Owner-only — it is
--     NOT redefined. is_staff() means Owner, co_admin or manager.
--     Roles are granted manually in the database, never from signup:
--     a user creating their own profile row may only ever set
--     role = 'customer'; on update, a BEFORE UPDATE trigger
--     (prevent_non_owner_role_change) raises when anyone except the
--     Owner changes a profiles.role value, so staff can still edit
--     their own display_name / phone without being able to promote
--     themselves (a policy alone cannot compare the old role with
--     the new one).
--   * Staff (Owner / co_admin / manager) may INSERT, UPDATE and
--     DELETE products (UPDATE widened to all staff by 0010,
--     2026-11-10: managers CAN edit products, including pausing
--     them). Staff may SELECT orders; UPDATE of orders is Owner /
--     co_admin only (manager is read-only on orders). Role changes
--     and user deletes are Owner-only.
--   * payments and audit_log have NO policy for non-admins at all, so
--     they are invisible to everyone except admins (and the service
--     role, which bypasses RLS).
--   * Order / payment / stock changes that must be trusted are done
--     server-side with the service-role client, never from the browser.

-- ---------------------------------------------------------------------------
-- Helper: is the current user an admin?
-- SECURITY DEFINER so the check itself is not blocked by profiles RLS,
-- and so it cannot recurse into policies that call it.
-- 'admin' is the Owner. This function is NOT redefined — it still
-- means Owner-only.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Helpers: co_admin, manager, and staff (Owner / co_admin / manager).
-- Same shape as is_admin() (SECURITY DEFINER, STABLE, search_path).
-- Added by migration 0006 — mirrored here for fresh installs.
-- ---------------------------------------------------------------------------
create or replace function public.is_co_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'co_admin'
  );
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'co_admin', 'manager')
  );
$$;

-- ===========================================================================
-- Fresh-install mirror of migrations 0006–0009.
-- Live databases apply the numbered migrations instead; this block
-- exists so a fresh install (0001 + this file) reaches the same
-- state. Every statement is idempotent, so applying both paths is
-- safe. Do not edit one without the other.
--   * 0006: profiles.role check widened to
--     ('customer', 'seller', 'admin', 'co_admin', 'manager').
--   * 0007: orders.status check gains 'returned'.
--   * 0008: products gains warranty (text, nullable) and
--     specifications (jsonb, not null, default '[]'::jsonb).
--   * 0009: announcements table (broadcasts) — mirrored in its own
--     section at the end of this file, not in this DO block, because
--     it creates a table rather than widening a constraint.
--   * 0011: banners table (hero carousel slides) and 0012:
--     product_categories join table (multi-category products) —
--     mirrored in their own sections at the end of this file, for
--     the same reason. Both are NOT APPLIED LIVE YET (2026-11-10).
-- ===========================================================================
do $$
declare
  v_old text;
begin
  -- profiles.role check (0006).
  select c.conname into v_old
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = any (c.conkey)
  where c.conrelid = 'public.profiles'::regclass
    and c.contype = 'c'
    and a.attname = 'role'
    and c.conname <> 'profiles_role_check'
  limit 1;

  if v_old is not null then
    execute 'alter table public.profiles drop constraint ' || quote_ident(v_old);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('customer', 'seller', 'admin', 'co_admin', 'manager'));
  end if;

  -- orders.status check (0007).
  v_old := null;
  select c.conname into v_old
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = any (c.conkey)
  where c.conrelid = 'public.orders'::regclass
    and c.contype = 'c'
    and a.attname = 'status'
    and c.conname <> 'orders_status_check'
  limit 1;

  if v_old is not null then
    execute 'alter table public.orders drop constraint ' || quote_ident(v_old);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_status_check'
  ) then
    alter table public.orders
      add constraint orders_status_check
      check (status in (
        'pending_payment', 'confirmed', 'processing', 'shipped',
        'delivered', 'cancelled', 'refunded', 'returned'
      ));
  end if;
end $$;

-- products.warranty / products.specifications (0008).
alter table public.products
  add column if not exists warranty text;

alter table public.products
  add column if not exists specifications jsonb not null default '[]'::jsonb;

comment on column public.products.warranty is
  'Warranty offered with the product, e.g. ''1 year official warranty''. NULL means no warranty is stated.';

comment on column public.products.specifications is
  'Specification list as a JSON array of key/value objects: [{"key": "...", "value": "..."}]. Empty array means no specifications are listed yet.';

-- ===========================================================================
-- profiles
-- ===========================================================================
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  -- A user may create only their own row, and only as a customer —
  -- self-promotion to seller / co_admin / manager / admin is
  -- impossible here.
  with check (id = auth.uid() and role = 'customer');

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  -- Only the row's owner may update it. The role value itself is
  -- NOT constrained here — the trigger below stops a non-owner
  -- changing it, so staff can still edit their own display_name /
  -- phone.
  with check (id = auth.uid());

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all" on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- BEFORE UPDATE trigger: only the Owner may change a profiles.role
-- value (see migration 0006 for the full reasoning). It fires only
-- on a self-change (old.id = auth.uid()): the Owner changing
-- someone else's role passes straight through, and the service-role
-- client (auth.uid() null) is unaffected.
create or replace function public.prevent_non_owner_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role is distinct from new.role
     and old.id = auth.uid()
     and not public.is_admin()
  then
    raise exception 'Only the Owner may change a user role.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_change on public.profiles;
create trigger profiles_prevent_role_change
  before update on public.profiles
  for each row execute function public.prevent_non_owner_role_change();

-- ===========================================================================
-- seller_profiles — verified shops are publicly readable (storefront);
-- only the owner (or an admin) may write.
-- ===========================================================================
drop policy if exists "seller_profiles_select_verified" on public.seller_profiles;
create policy "seller_profiles_select_verified" on public.seller_profiles
  for select to anon, authenticated
  using (is_verified = true);

drop policy if exists "seller_profiles_select_own" on public.seller_profiles;
create policy "seller_profiles_select_own" on public.seller_profiles
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "seller_profiles_insert_own" on public.seller_profiles;
create policy "seller_profiles_insert_own" on public.seller_profiles
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "seller_profiles_update_own" on public.seller_profiles;
create policy "seller_profiles_update_own" on public.seller_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "seller_profiles_admin_all" on public.seller_profiles;
create policy "seller_profiles_admin_all" on public.seller_profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- categories — visitors read active categories only.
-- ===========================================================================
drop policy if exists "categories_select_active" on public.categories;
create policy "categories_select_active" on public.categories
  for select to anon, authenticated
  using (is_active = true);

drop policy if exists "categories_admin_all" on public.categories;
create policy "categories_admin_all" on public.categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- products — visitors read active products only; sellers manage their own.
-- Staff may INSERT, UPDATE and DELETE products (UPDATE widened to
-- all staff by 0010, 2026-11-10).
-- ===========================================================================
drop policy if exists "products_select_active" on public.products;
create policy "products_select_active" on public.products
  for select to anon, authenticated
  using (status = 'active');

drop policy if exists "products_select_own" on public.products;
create policy "products_select_own" on public.products
  for select to authenticated
  using (seller_id = auth.uid());

drop policy if exists "products_insert_own" on public.products;
create policy "products_insert_own" on public.products
  for insert to authenticated
  with check (seller_id = auth.uid());

drop policy if exists "products_update_own" on public.products;
create policy "products_update_own" on public.products
  for update to authenticated
  using (seller_id = auth.uid())
  with check (seller_id = auth.uid());

drop policy if exists "products_delete_own" on public.products;
create policy "products_delete_own" on public.products
  for delete to authenticated
  using (seller_id = auth.uid());

drop policy if exists "products_admin_all" on public.products;
create policy "products_admin_all" on public.products
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Staff (Owner / co_admin / manager) may INSERT, UPDATE and DELETE
-- products (UPDATE widened from co-admin-only to all staff by
-- migration 0010, 2026-11-10). The Owner is already covered by
-- products_admin_all above.
drop policy if exists "products_staff_insert" on public.products;
create policy "products_staff_insert" on public.products
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists "products_staff_delete" on public.products;
create policy "products_staff_delete" on public.products
  for delete to authenticated
  using (public.is_staff());

drop policy if exists "products_co_admin_update" on public.products;
drop policy if exists "products_staff_update" on public.products;
create policy "products_staff_update" on public.products
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ===========================================================================
-- product_images — readable when the product is active; writable only by
-- the product's seller (or an admin).
-- ===========================================================================
drop policy if exists "product_images_select_active_product" on public.product_images;
create policy "product_images_select_active_product" on public.product_images
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.products
      where products.id = product_images.product_id
        and products.status = 'active'
    )
  );

drop policy if exists "product_images_seller_all" on public.product_images;
create policy "product_images_seller_all" on public.product_images
  for all to authenticated
  using (
    exists (
      select 1 from public.products
      where products.id = product_images.product_id
        and products.seller_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.products
      where products.id = product_images.product_id
        and products.seller_id = auth.uid()
    )
  );

drop policy if exists "product_images_admin_all" on public.product_images;
create policy "product_images_admin_all" on public.product_images
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- product_variants — same shape as product_images.
-- ===========================================================================
drop policy if exists "product_variants_select_active_product" on public.product_variants;
create policy "product_variants_select_active_product" on public.product_variants
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.products
      where products.id = product_variants.product_id
        and products.status = 'active'
    )
  );

drop policy if exists "product_variants_seller_all" on public.product_variants;
create policy "product_variants_seller_all" on public.product_variants
  for all to authenticated
  using (
    exists (
      select 1 from public.products
      where products.id = product_variants.product_id
        and products.seller_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.products
      where products.id = product_variants.product_id
        and products.seller_id = auth.uid()
    )
  );

drop policy if exists "product_variants_admin_all" on public.product_variants;
create policy "product_variants_admin_all" on public.product_variants
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- addresses — the owner only.
-- ===========================================================================
drop policy if exists "addresses_owner_all" on public.addresses;
create policy "addresses_owner_all" on public.addresses
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "addresses_admin_all" on public.addresses;
create policy "addresses_admin_all" on public.addresses
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- carts — the owner only.
-- ===========================================================================
drop policy if exists "carts_owner_all" on public.carts;
create policy "carts_owner_all" on public.carts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "carts_admin_all" on public.carts;
create policy "carts_admin_all" on public.carts
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- cart_items — the owner of the parent cart only.
-- ===========================================================================
drop policy if exists "cart_items_owner_all" on public.cart_items;
create policy "cart_items_owner_all" on public.cart_items
  for all to authenticated
  using (
    exists (
      select 1 from public.carts
      where carts.id = cart_items.cart_id
        and carts.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.carts
      where carts.id = cart_items.cart_id
        and carts.user_id = auth.uid()
    )
  );

drop policy if exists "cart_items_admin_all" on public.cart_items;
create policy "cart_items_admin_all" on public.cart_items
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- orders — customers see / place only their own orders. Customers may
-- NOT update an order (status changes are admin / server-side only).
-- Staff may SELECT orders; UPDATE is Owner / co_admin only (manager
-- is read-only on orders).
-- ===========================================================================
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select to authenticated
  using (user_id = auth.uid());

-- orders_select_seller was removed in migration 0004 (2026-11-08):
-- it read public.order_items while order_items_select_buyer reads
-- public.orders, which made any authenticated SELECT on orders fail
-- with "infinite recursion detected in policy for relation orders".
-- Sellers were removed when the store went single-seller, so the
-- policy was legacy. Do NOT re-add a policy on orders that reads
-- order_items (or any policy on order_items that reads orders while
-- an orders policy reads order_items) — the cycle comes straight back.

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own" on public.orders
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "orders_admin_all" on public.orders;
create policy "orders_admin_all" on public.orders
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Staff (Owner / co_admin / manager) may SELECT orders; UPDATE is
-- Owner / co_admin only (manager is read-only on orders). The Owner
-- is already covered by orders_admin_all above. No policy here reads
-- order_items, so the orders/order_items recursion fixed in
-- migration 0004 cannot come back.
drop policy if exists "orders_staff_select" on public.orders;
create policy "orders_staff_select" on public.orders
  for select to authenticated
  using (public.is_staff());

drop policy if exists "orders_co_admin_update" on public.orders;
create policy "orders_co_admin_update" on public.orders
  for update to authenticated
  using (public.is_co_admin())
  with check (public.is_co_admin());

-- ===========================================================================
-- order_items — the buyer (via their order), the seller of the item,
-- or an admin. Insert is allowed for the buyer placing the order;
-- status / price changes are server-side only.
-- ===========================================================================
drop policy if exists "order_items_select_buyer" on public.order_items;
create policy "order_items_select_buyer" on public.order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.user_id = auth.uid()
    )
  );

drop policy if exists "order_items_select_seller" on public.order_items;
create policy "order_items_select_seller" on public.order_items
  for select to authenticated
  using (seller_id = auth.uid());

drop policy if exists "order_items_insert_buyer" on public.order_items;
create policy "order_items_insert_buyer" on public.order_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.user_id = auth.uid()
    )
  );

drop policy if exists "order_items_admin_all" on public.order_items;
create policy "order_items_admin_all" on public.order_items
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- payments — ADMIN ONLY. No policy exists for anon / customers / sellers,
-- so these rows are invisible to every non-admin. Payment rows are
-- created and updated server-side with the service-role client.
-- ===========================================================================
drop policy if exists "payments_admin_all" on public.payments;
create policy "payments_admin_all" on public.payments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- reviews — anyone may read; only the author may write their own.
-- ===========================================================================
drop policy if exists "reviews_select_all" on public.reviews;
create policy "reviews_select_all" on public.reviews
  for select to anon, authenticated
  using (true);

drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own" on public.reviews
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "reviews_update_own" on public.reviews;
create policy "reviews_update_own" on public.reviews
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own" on public.reviews
  for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "reviews_admin_all" on public.reviews;
create policy "reviews_admin_all" on public.reviews
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- wishlists — the owner only.
-- ===========================================================================
drop policy if exists "wishlists_owner_all" on public.wishlists;
create policy "wishlists_owner_all" on public.wishlists
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "wishlists_admin_all" on public.wishlists;
create policy "wishlists_admin_all" on public.wishlists
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- coupons — signed-in users may read active coupons (to validate a code
-- at checkout); only admins may create / change them.
-- ===========================================================================
drop policy if exists "coupons_select_active" on public.coupons;
create policy "coupons_select_active" on public.coupons
  for select to authenticated
  using (is_active = true);

drop policy if exists "coupons_admin_all" on public.coupons;
create policy "coupons_admin_all" on public.coupons
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ===========================================================================
-- announcements (migration 0009) — fresh-install mirror.
-- Live databases apply 0009 instead; this block exists so a fresh
-- install (0001 + this file) reaches the same state. Every statement
-- is idempotent, so applying both paths is safe. Do not edit one
-- without the other.
-- ===========================================================================
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) >= 1 and char_length(title) <= 200),
  body text not null check (char_length(body) >= 1 and char_length(body) <= 2000),
  kind text not null default 'notification' check (kind in ('notification', 'offer')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.announcements enable row level security;

drop policy if exists "announcements_select_authenticated" on public.announcements;
create policy "announcements_select_authenticated" on public.announcements
  for select to authenticated
  using (true);

drop policy if exists "announcements_staff_insert" on public.announcements;
create policy "announcements_staff_insert" on public.announcements
  for insert to authenticated
  with check (public.is_admin() or public.is_co_admin());

drop policy if exists "announcements_staff_delete" on public.announcements;
create policy "announcements_staff_delete" on public.announcements
  for delete to authenticated
  using (public.is_admin() or public.is_co_admin());

create index if not exists announcements_created_at_idx
  on public.announcements (created_at desc);

-- ===========================================================================
-- banners (migration 0011) — fresh-install mirror.
-- Live databases apply 0011 instead; this block exists so a fresh
-- install (0001 + this file) reaches the same state. Every statement
-- is idempotent, so applying both paths is safe. Do not edit one
-- without the other. NOT APPLIED LIVE YET (2026-11-10).
-- ===========================================================================
create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  image_path text not null default '',
  -- Kind (migration 0013): "promotion" or "offer" — the admin
  -- badge and the derived headline (the slide's alt text only).
  kind text not null default 'promotion' check (kind in ('promotion', 'offer')),
  headline text not null check (char_length(headline) >= 1 and char_length(headline) <= 120),
  subcopy text not null default '' check (char_length(subcopy) <= 300),
  cta_label text not null default '' check (char_length(cta_label) <= 40),
  cta_href text not null default '/shop' check (cta_href like '/%'),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.banners enable row level security;

drop policy if exists "banners_select_active" on public.banners;
create policy "banners_select_active" on public.banners
  for select to anon, authenticated
  using (active = true);

drop policy if exists "banners_select_staff" on public.banners;
create policy "banners_select_staff" on public.banners
  for select to authenticated
  using (public.is_staff());

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

-- ===========================================================================
-- product_categories (migration 0012) — fresh-install mirror.
-- Live databases apply 0012 instead; this block exists so a fresh
-- install (0001 + this file) reaches the same state. Every statement
-- is idempotent, so applying both paths is safe. Do not edit one
-- without the other. NOT APPLIED LIVE YET (2026-11-10).
-- ===========================================================================
create table if not exists public.product_categories (
  product_id uuid not null references public.products (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (product_id, category_id)
);

alter table public.product_categories enable row level security;

drop policy if exists "product_categories_select_public" on public.product_categories;
create policy "product_categories_select_public" on public.product_categories
  for select to anon, authenticated
  using (true);

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

-- The "Flash deals" category itself (idempotent) and the membership
-- for every product already flagged is_flash_deal = true — the same
-- two inserts migration 0012 runs, so a fresh install and a migrated
-- live database reach the same state.
insert into public.categories (name, slug, sort_order, is_active) values
  ('Flash deals', 'flash-deals', 10, true)
on conflict (slug) do nothing;

insert into public.product_categories (product_id, category_id)
select p.id, c.id
from public.products p
cross join public.categories c
where p.is_flash_deal = true
  and c.slug = 'flash-deals'
on conflict (product_id, category_id) do nothing;

-- ===========================================================================
-- audit_log — ADMIN ONLY. No policy exists for anyone else, so audit
-- rows are invisible to every non-admin.
-- ===========================================================================
drop policy if exists "audit_log_admin_all" on public.audit_log;
create policy "audit_log_admin_all" on public.audit_log
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
