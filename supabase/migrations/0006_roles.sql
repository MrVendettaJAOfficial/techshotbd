-- Migration 0006 — staff roles: co_admin and manager (2026-11-09).
--
-- Roles (profiles.role):
--   * 'customer'  — shopper (default at sign-up).
--   * 'seller'    — legacy / unused since the single-seller change
--                   (2026-11-08); kept in the list so existing rows
--                   stay valid and nothing breaks.
--   * 'admin'     — the Owner. is_admin() still means Owner-only;
--                   it is NOT redefined here.
--   * 'co_admin'  — second admin: may edit products and orders and
--                   change order status, but may NOT change roles or
--                   delete users.
--   * 'manager'   — staff: may add and delete products and read
--                   orders, but may NOT edit/pause products and may
--                   NOT update orders (read-only on orders).
--
-- Helpers added (same shape as is_admin(): SECURITY DEFINER, STABLE,
-- set search_path = public, so the check reads profiles directly and
-- cannot recurse into policies that call it):
--   * is_co_admin() — role = 'co_admin'
--   * is_manager()  — role = 'manager'
--   * is_staff()    — role in ('admin', 'co_admin', 'manager')
--
-- Self-promotion hole closed: profiles_insert_own only ever lets a
-- user create their own row as a customer, and a BEFORE UPDATE
-- trigger (prevent_non_owner_role_change, below) raises when anyone
-- except the Owner changes a profiles.role value. The self-update
-- policy itself only requires the row to stay the caller's own, so a
-- co_admin / manager can still update their own display_name /
-- phone — the trigger, not the policy, is what stops a role change.
-- A pure policy cannot express "role unchanged": a policy's USING
-- sees the old row and its WITH CHECK sees the new row, but no
-- single expression can compare the two — hence the trigger. Role
-- changes and user deletes stay Owner-only through
-- profiles_admin_all (is_admin()); no policy lets co_admin or
-- manager update profiles.role or delete profiles rows. The Owner's
-- own role changes go through the service-role client
-- (lib/auth-server.ts changeUserRole), for which auth.uid() is null,
-- so the trigger's self-change test does not fire there.
--
-- Products:
--   * INSERT / DELETE — any staff (Owner, co_admin, manager).
--   * UPDATE          — Owner and co_admin only (manager adds /
--     deletes but does not edit or pause — deliberate).
--   * products_admin_all (Owner, FOR ALL) is kept unchanged.
-- Orders:
--   * SELECT — any staff (manager is read-only on orders).
--   * UPDATE — Owner and co_admin only.
--   * orders_admin_all (Owner, FOR ALL) is kept unchanged.
-- No policy added here reads order_items, so the orders/order_items
-- recursion fixed in migration 0004 cannot come back.
--
-- seller_profiles and its policies are NOT touched. No
-- orders_select_seller policy is re-added.
--
-- The same changes are mirrored in supabase/policies.sql (the
-- canonical policy file for a fresh setup) — keep the two in sync.
-- Apply in the Supabase SQL Editor AFTER 0005. Safe to run once:
-- every statement is idempotent (constraints are replaced by name
-- lookup, functions are CREATE OR REPLACE, policies are dropped
-- first). No data is changed; existing roles are all inside the new
-- list, so the widened check cannot fail on live rows.

-- ---------------------------------------------------------------------------
-- 1. Widen the profiles.role check to the five roles.
-- 0001 created the check inline, so Postgres named it
-- profiles_role_check — but do not assume the name: find the check
-- on the role column, drop it, and add the new named one. Re-running
-- finds profiles_role_check already in place and skips the add.
-- ---------------------------------------------------------------------------
do $$
declare
  v_old text;
begin
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
end $$;

-- ---------------------------------------------------------------------------
-- 2. Role helpers. is_admin() is NOT redefined — it still means the
-- Owner (role = 'admin') only.
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

-- ---------------------------------------------------------------------------
-- 3. profiles — close the self-promotion hole. A user creating their
-- own row may only ever set role = 'customer' (insert policy). On
-- update, the policy only requires the row to stay the caller's own
-- — a staff member must still be able to edit their own
-- display_name / phone. The role itself is guarded by the trigger
-- below, because a policy cannot compare the old role with the new
-- one. profiles_admin_all (Owner, FOR ALL) is untouched: role
-- changes and deletes stay Owner-only.
-- ---------------------------------------------------------------------------
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
  -- NOT constrained here — see the trigger below.
  with check (id = auth.uid());

-- BEFORE UPDATE trigger: only the Owner may change a profiles.role
-- value. It fires only on a self-change (old.id = auth.uid()): the
-- Owner changing someone else's role passes straight through, and
-- the service-role client (auth.uid() null — the Owner's role
-- changes in lib/auth-server.ts changeUserRole) is unaffected.
-- A staff member editing their own display_name / phone changes no
-- role, so the trigger lets it through; a customer (or staff member)
-- trying to promote themselves gets an error and no row changes.
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

-- ---------------------------------------------------------------------------
-- 4. products — staff may INSERT and DELETE; UPDATE is Owner and
-- co_admin only (manager adds/deletes but does not edit/pause).
-- products_admin_all (Owner, FOR ALL) is untouched. The legacy
-- seller policies (products_*_own) are untouched.
-- ---------------------------------------------------------------------------
drop policy if exists "products_staff_insert" on public.products;
create policy "products_staff_insert" on public.products
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists "products_staff_delete" on public.products;
create policy "products_staff_delete" on public.products
  for delete to authenticated
  using (public.is_staff());

drop policy if exists "products_co_admin_update" on public.products;
create policy "products_co_admin_update" on public.products
  for update to authenticated
  using (public.is_co_admin())
  with check (public.is_co_admin());

-- ---------------------------------------------------------------------------
-- 5. orders — staff may SELECT; UPDATE is Owner and co_admin only
-- (manager is read-only on orders). orders_admin_all (Owner,
-- FOR ALL) is untouched. No policy here reads order_items.
-- ---------------------------------------------------------------------------
drop policy if exists "orders_staff_select" on public.orders;
create policy "orders_staff_select" on public.orders
  for select to authenticated
  using (public.is_staff());

drop policy if exists "orders_co_admin_update" on public.orders;
create policy "orders_co_admin_update" on public.orders
  for update to authenticated
  using (public.is_co_admin())
  with check (public.is_co_admin());
