-- TechShot marketplace — profile creation trigger (migration 0002).
--
-- Background (bug fixed 2026-11-08): when email confirmation is on,
-- sign-up returns no session, so the app could not create the
-- public.profiles row at sign-up time and the profiles table stayed
-- empty for new users. The app now also creates a missing profile on
-- sign-in (see ensureCurrentUserProfile in lib/auth-server.ts), but
-- this trigger is the safety net that makes profile creation
-- independent of any app code path: the row is created the moment
-- the auth.users row is inserted.
--
-- Apply in the Supabase SQL Editor AFTER 0001_initial_schema.sql.
-- It is safe to run on the live TechshotBD project, which was set up
-- before this file existed: the trigger is dropped/recreated first,
-- the backfill at the end only inserts rows that are missing, and
-- existing rows are never overwritten.
--
-- Admin rule: the trigger only ever creates "customer" or "seller"
-- (taken from the role chosen at sign-up, stored in user metadata).
-- "admin" is never assigned here; it is only granted manually in
-- the database, e.g.:
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
-- If the profile row itself is missing, create it as admin in one step:
--   insert into public.profiles (id, display_name, role)
--   values ((select id from auth.users where email = 'you@example.com'),
--           'Your Name', 'admin')
--   on conflict (id) do update set role = 'admin';

-- ---------------------------------------------------------------------------
-- Function: create the matching public.profiles row for a new auth user.
-- SECURITY DEFINER so it runs with the privileges needed to write to
-- public.profiles regardless of RLS; set search_path = public so it
-- cannot be tricked into writing elsewhere.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
  v_role text;
begin
  v_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'TechShot customer'
  );
  -- Only "seller" survives from metadata; anything else — including
  -- "admin" — becomes "customer".
  v_role := case when new.raw_user_meta_data ->> 'role' = 'seller'
    then 'seller' else 'customer' end;

  insert into public.profiles (id, display_name, role)
  values (new.id, v_display_name, v_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Backfill: create profiles rows for auth users who signed up before
-- this trigger existed (their profiles table is empty today).
-- Existing rows are never touched: on conflict do nothing, so an
-- admin's role can never be downgraded here.
-- ---------------------------------------------------------------------------
insert into public.profiles (id, display_name, role)
select
  id,
  coalesce(
    nullif(raw_user_meta_data ->> 'display_name', ''),
    nullif(split_part(coalesce(email, ''), '@', 1), ''),
    'TechShot customer'
  ),
  case when raw_user_meta_data ->> 'role' = 'seller'
    then 'seller' else 'customer' end
from auth.users
on conflict (id) do nothing;
