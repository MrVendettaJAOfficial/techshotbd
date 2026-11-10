-- Migration 0010 — managers may edit products (2026-11-10).
--
-- User decision 2026-11-10: a Manager CAN edit products too,
-- including pausing them — not just add/delete. Migration 0006
-- (applied live 2026-11-09, NEVER edited in place) restricted
-- products UPDATE to owner/co-admin only (policy
-- products_co_admin_update, using is_co_admin()). This migration
-- widens that rule to all staff:
--
-- Products:
--   * INSERT / DELETE — any staff (unchanged, from 0006).
--   * UPDATE          — any staff (Owner, co_admin, manager).
--     products_co_admin_update is dropped and replaced by
--     products_staff_update (using is_staff(), defined in 0006).
--     products_admin_all (Owner, FOR ALL) is kept unchanged.
-- Orders, profiles, announcements: NOT touched. Order status
-- changes stay owner/co-admin only (orders_co_admin_update from
-- 0006); role changes and user deletes stay Owner-only.
--
-- The same change is mirrored in supabase/policies.sql (the
-- canonical policy file for a fresh setup) — keep the two in sync.
-- Apply in the Supabase SQL Editor AFTER the push. Safe to run
-- once: the policy is dropped first, so re-running is idempotent.
-- No data is changed.
--
-- NOTE — APPLIED LIVE 2026-11-10 ("Success. No rows returned";
-- products_staff_update verified present, products_co_admin_update
-- gone). The live database rule now matches the app rule: a
-- manager may update products directly as well as through the UI.

drop policy if exists "products_co_admin_update" on public.products;
create policy "products_staff_update" on public.products
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());
