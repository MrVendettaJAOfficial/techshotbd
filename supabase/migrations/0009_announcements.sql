-- Migration 0009 — admin broadcast announcements (2026-11-09).
--
-- Adds public.announcements: messages the store sends in-app to
-- ALL signed-in users (notifications, offers, etc.), shown in the
-- user's inbox (/inbox) alongside their own order updates. That is
-- why the inbox exists: the admin composes a message in the admin
-- panel (Messages tab) and every user sees it.
--
--   * id         uuid — the announcement id.
--   * title      text — 1–200 characters, the inbox headline.
--   * body       text — 1–2000 characters, the message itself.
--   * kind       text — 'notification' or 'offer'.
--   * created_by uuid — profiles.id of the staff member who sent
--     it; NULL when unknown. ON DELETE SET NULL, like audit_log.
--   * created_at timestamptz — when it was sent; the inbox sorts
--     on this.
--
-- There is no per-user targeting, no scheduling and no read/unread
-- storage: a sent announcement is visible to every signed-in user
-- until it is deleted. Read/unread would need a separate reads
-- table — deliberately NOT added here.
--
-- RLS (mirrored in supabase/policies.sql — keep the two in sync):
--   * every signed-in user may SELECT announcements (they are
--     broadcasts to all users);
--   * only the Owner ('admin') and co-admins ('co_admin') may
--     INSERT or DELETE — a manager is staff but may NOT send, and
--     customers can never send. The server actions in
--     lib/announcements-server.ts enforce the same rule
--     (lib/roles.ts canSendBroadcasts) on every call, so the RLS
--     policy is the second layer, not the only one.
--   * audit_log stays admin-only (migration 0001 / policies.sql):
--     customers never read it directly. The inbox's order-status
--     history is served by a server action
--     (lib/inbox-server.ts) that reads audit_log with the
--     service-role client scoped to the caller's own order ids.
--
-- *** NOT APPLIED LIVE YET — apply in the Supabase SQL Editor only
-- *** after the user's approval, like migrations 0002–0008 before
-- *** it. Until it is applied, the admin Messages tab reports that
-- *** broadcasts are unavailable and the inbox shows order updates
-- *** only: the server actions return a generic error / empty list
-- *** instead of failing the page. Safe to run once: the table is
-- *** created only if missing and the policies are dropped first.
-- *** No data is changed.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) >= 1 and char_length(title) <= 200),
  body text not null check (char_length(body) >= 1 and char_length(body) <= 2000),
  kind text not null default 'notification' check (kind in ('notification', 'offer')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.announcements is
  'Broadcast messages from the store to all signed-in users (notifications and offers), shown in the user inbox. Sent and deleted by the Owner and co-admins only.';

comment on column public.announcements.kind is
  'Message type: ''notification'' (store / order news) or ''offer'' (a discount or promotion).';

alter table public.announcements enable row level security;

-- Every signed-in user may read broadcasts.
drop policy if exists "announcements_select_authenticated" on public.announcements;
create policy "announcements_select_authenticated" on public.announcements
  for select to authenticated
  using (true);

-- Only the Owner and co-admins may send (insert) broadcasts.
-- A manager is staff but may NOT send; customers can never send.
drop policy if exists "announcements_staff_insert" on public.announcements;
create policy "announcements_staff_insert" on public.announcements
  for insert to authenticated
  with check (public.is_admin() or public.is_co_admin());

-- Only the Owner and co-admins may delete broadcasts.
drop policy if exists "announcements_staff_delete" on public.announcements;
create policy "announcements_staff_delete" on public.announcements
  for delete to authenticated
  using (public.is_admin() or public.is_co_admin());

create index if not exists announcements_created_at_idx
  on public.announcements (created_at desc);
