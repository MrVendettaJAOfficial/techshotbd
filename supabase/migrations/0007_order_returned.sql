-- Migration 0007 — orders status 'returned' (2026-11-09).
--
-- Extends the orders.status check with 'returned', alongside the
-- existing values:
--   pending_payment, confirmed, processing, shipped, delivered,
--   cancelled, refunded, returned
-- so an order that came back can be recorded as returned instead of
-- being forced into cancelled / refunded. No data is changed and no
-- existing status value is removed, so the widened check cannot fail
-- on live rows.
--
-- The same change is mirrored in supabase/policies.sql (the
-- canonical file for a fresh setup) — keep the two in sync. Apply in
-- the Supabase SQL Editor AFTER 0006. Safe to run once: the old
-- check is found by column lookup (0001 created it inline, so
-- Postgres named it orders_status_check, but the name is not
-- assumed), dropped, and replaced with the new named one; re-running
-- finds orders_status_check already in place and skips the add.

do $$
declare
  v_old text;
begin
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
