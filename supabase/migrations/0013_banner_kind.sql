-- Migration 0013 — banner kind (2026-11-10).
-- APPLIED LIVE 2026-11-11 ("Success. No rows returned"; kind
-- column verified: text, default 'promotion').
--
-- Adds public.banners.kind: whether a banner is a "promotion" or
-- an "offer". The admin Banners tab offers the two kinds in a
-- select (components/admin/banners-section.tsx); the saved-banner
-- list shows the kind as a badge (Promotion = green, Offer =
-- orange), and the server derives the stored headline from the
-- kind ("Promotion banner" / "Offer banner") — that headline is
-- only the carousel slide's alt text.
--
-- Why: the 2026-11-10 image-only carousel redesign. The hero
-- carousel now shows just the banner photo — no headline,
-- subcopy or button text — so the banner's text fields are no
-- longer edited in the admin form. The headline / subcopy /
-- cta_label / cta_href columns are UNUSED for visible rendering
-- since that redesign but are KEPT: this migration makes no
-- destructive change, touches no existing row, and drops nothing.
-- Existing rows keep their old text values; new writes set the
-- headline from the kind and clear subcopy / button text.
--
-- Safe to run once: the column is added only if missing, and
-- existing rows get the 'promotion' default. No RLS changes —
-- kind needs no new policy (the banners policies from 0011
-- already cover the whole row).

alter table public.banners
  add column if not exists kind text not null default 'promotion'
  check (kind in ('promotion', 'offer'));

comment on column public.banners.kind is
  'Banner kind: "promotion" (green badge in the admin list) or "offer" (orange badge). The server derives the stored headline from the kind — it is only the carousel slide''s alt text, never visible.';
