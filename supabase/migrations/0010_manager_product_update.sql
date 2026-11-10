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
-- NOTE — written, NOT applied live: this file only takes effect
-- once it is run in the SQL Editor. Until then the live database
-- still has the 0006 policy, so a manager updating a product
-- directly through PostgREST/REST is denied by RLS (403, no
-- crash). Edits made through the admin UI go through the
-- server actions, which use the service-role client (bypassing
-- RLS) and already allow managers after this build — so the UI
-- edit works before the migration, and the migration brings the
-- database rule into line with the app rule.

drop policy if exists "products_co_admin_update" on public.products;
create policy "products_staff_update" on public.products
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());
