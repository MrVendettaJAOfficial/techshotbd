-- TechShot marketplace — initial schema.
-- Supabase / Postgres. Money is integer poisha (100 poisha = 1 BDT).
-- Addresses are Bangladesh Division / District / City. No PIN / GST / UPI.
-- Apply with: supabase db push (or psql against the project database).
-- RLS is enabled on every table here; the policies themselves live in
-- supabase/policies.sql, which must be applied after this migration.
-- No secrets, URLs or keys are stored in this file.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Helper: keep updated_at current on UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user. role is 'customer' by default.
-- 'admin' is granted manually in the database, never from signup.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  phone text,
  role text not null default 'customer'
    check (role in ('customer', 'seller', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- seller_profiles — shop details for users with role = 'seller'.
-- ---------------------------------------------------------------------------
create table public.seller_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  shop_name text not null,
  shop_slug text unique,
  description text,
  logo_path text,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- categories — self-referencing tree (parent_id null = top level).
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_id uuid references public.categories (id) on delete set null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- products — seller_id is null for platform-owned (seed) products.
-- price/compare/stock are integers; rating is 0.00–5.00.
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.profiles (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  title text not null,
  slug text not null unique,
  description text,
  price_poisha integer not null check (price_poisha >= 0),
  compare_at_poisha integer check (compare_at_poisha is null or compare_at_poisha >= 0),
  stock integer not null default 0 check (stock >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused')),
  search_text text,
  rating numeric(3, 2) not null default 0
    check (rating >= 0 and rating <= 5),
  review_count integer not null default 0 check (review_count >= 0),
  is_flash_deal boolean not null default false,
  flash_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- product_images — storage_path is a path in Supabase Storage
-- (seed data uses the public path /images/products/<slug>.jpg).
-- ---------------------------------------------------------------------------
create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, storage_path)
);

-- ---------------------------------------------------------------------------
-- product_variants — e.g. storage / colour options. A null
-- price_override_poisha means "use the product price".
-- ---------------------------------------------------------------------------
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  price_override_poisha integer
    check (price_override_poisha is null or price_override_poisha >= 0),
  stock integer not null default 0 check (stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- addresses — Bangladesh Division / District / City.
-- ---------------------------------------------------------------------------
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  phone text not null,
  division text not null,
  district text not null,
  city text not null,
  full_address text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- carts / cart_items — one cart per user; price_snapshot_poisha is the
-- price at the time the item was added (server totals never trust the
-- browser, see lib/pricing.ts).
-- ---------------------------------------------------------------------------
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete set null,
  quantity integer not null default 1 check (quantity > 0),
  price_snapshot_poisha integer not null check (price_snapshot_poisha >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One line per (cart, product, variant). variant_id is nullable, so the
-- plain unique constraint would treat NULLs as distinct; the expression
-- index below enforces the rule with a fixed zero UUID for "no variant".
create unique index cart_items_cart_product_variant_unique
  on public.cart_items (
    cart_id,
    product_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ---------------------------------------------------------------------------
-- orders / order_items — order_number is generated by the application
-- (e.g. TS-YYYYMMDD-XXXX). title / price on order_items are snapshots.
-- address_snapshot is a jsonb copy of the delivery address at order time.
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending_payment'
    check (status in (
      'pending_payment', 'confirmed', 'processing', 'shipped',
      'delivered', 'cancelled', 'refunded'
    )),
  subtotal_poisha integer not null default 0 check (subtotal_poisha >= 0),
  delivery_poisha integer not null default 0 check (delivery_poisha >= 0),
  discount_poisha integer not null default 0 check (discount_poisha >= 0),
  total_poisha integer not null default 0 check (total_poisha >= 0),
  address_snapshot jsonb not null default '{}'::jsonb,
  payment_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  seller_id uuid references public.profiles (id) on delete set null,
  title text not null,
  price_poisha integer not null check (price_poisha >= 0),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- payments — one row per payment attempt; never exposed to non-admins.
-- No card / bank details are ever stored here.
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  provider text not null,
  provider_reference text,
  amount_poisha integer not null check (amount_poisha >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- reviews — rating is an integer 1–5.
-- ---------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  rating integer not null check (rating >= 1 and rating <= 5),
  text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id, order_id)
);

-- ---------------------------------------------------------------------------
-- wishlists — one row per (user, product).
-- ---------------------------------------------------------------------------
create table public.wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

-- ---------------------------------------------------------------------------
-- coupons — type is 'fixed' only for now (value_poisha off the subtotal).
-- ---------------------------------------------------------------------------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type text not null default 'fixed' check (type = 'fixed'),
  value_poisha integer not null check (value_poisha >= 0),
  min_spend_poisha integer not null default 0 check (min_spend_poisha >= 0),
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  used_count integer not null default 0 check (used_count >= 0),
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- audit_log — admin-only. updated_at is present for consistency with the
-- other tables; rows are append-only in practice and never updated.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security — enabled on every table (default deny: with no
-- policy granting access, a row is invisible). Policies: policies.sql.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.seller_profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;
alter table public.addresses enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.reviews enable row level security;
alter table public.wishlists enable row level security;
alter table public.coupons enable row level security;
alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- Indexes.
-- ---------------------------------------------------------------------------
create index products_category_id_idx on public.products (category_id);
create index products_slug_idx on public.products (slug);
create index products_seller_id_idx on public.products (seller_id);
create index products_status_idx on public.products (status);
create index products_search_text_idx
  on public.products using gin (search_text gin_trgm_ops);
create index products_flash_deal_idx on public.products (is_flash_deal)
  where is_flash_deal = true;

create index product_images_product_id_idx on public.product_images (product_id);
create index product_variants_product_id_idx on public.product_variants (product_id);
create index categories_parent_id_idx on public.categories (parent_id);
create index categories_slug_idx on public.categories (slug);
create index addresses_user_id_idx on public.addresses (user_id);
create index carts_user_id_idx on public.carts (user_id);
create index cart_items_cart_id_idx on public.cart_items (cart_id);
create index cart_items_product_id_idx on public.cart_items (product_id);

create index orders_user_id_idx on public.orders (user_id);
create index orders_status_idx on public.orders (status);
create index orders_order_number_idx on public.orders (order_number);
create index order_items_seller_id_idx on public.order_items (seller_id);
create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);

create index payments_order_id_idx on public.payments (order_id);
create index payments_status_idx on public.payments (status);
create index reviews_product_id_idx on public.reviews (product_id);
create index reviews_user_id_idx on public.reviews (user_id);
create index wishlists_user_id_idx on public.wishlists (user_id);
create index coupons_code_idx on public.coupons (code);
create index audit_log_actor_id_idx on public.audit_log (actor_id);
create index audit_log_created_at_idx on public.audit_log (created_at);

-- ---------------------------------------------------------------------------
-- updated_at triggers (all tables except audit_log, which is append-only).
-- ---------------------------------------------------------------------------
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger seller_profiles_set_updated_at
  before update on public.seller_profiles
  for each row execute function public.set_updated_at();
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();
create trigger product_images_set_updated_at
  before update on public.product_images
  for each row execute function public.set_updated_at();
create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();
create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();
create trigger carts_set_updated_at
  before update on public.carts
  for each row execute function public.set_updated_at();
create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();
create trigger order_items_set_updated_at
  before update on public.order_items
  for each row execute function public.set_updated_at();
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();
create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();
create trigger wishlists_set_updated_at
  before update on public.wishlists
  for each row execute function public.set_updated_at();
create trigger coupons_set_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();
