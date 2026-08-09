-- ============================================================
-- 023_partner_homepage_logos.sql
--
-- Adds what the homepage "Trusted by" scrolling logo strip needs.
-- Previously PartnerLogos.tsx was a text-only placeholder pulling
-- names from src/messages/*.json (home.partners.names) — not
-- connected to the partners table at all, and not actual logo
-- images. This migration lets an admin pick which partners' real
-- logos appear there, managed entirely from PartnersManager.tsx
-- (no code change needed to add/remove a logo going forward).
--
-- logo_url is intentionally separate from partners.cover_image_url:
-- cover_image_url is a photo used on partner directory/detail cards
-- (see PartnerCard.tsx / PartnerDirectory.tsx) and is usually a wide
-- photo, not a brand mark suitable for a small logo strip.
--
-- Safe to re-run.
-- ============================================================

alter table public.partners
  add column if not exists logo_url text,
  add column if not exists show_on_homepage boolean not null default false;

comment on column public.partners.logo_url is
  'Transparent PNG/SVG brand logo shown in the homepage "Trusted by" scrolling strip (PartnerLogos.tsx). Separate from cover_image_url, which is a photo used on directory/detail cards.';
comment on column public.partners.show_on_homepage is
  'Whether this partner''s logo appears in the homepage PartnerLogos scroller. Managed from the admin Partners screen — no code change needed to add/remove one.';

-- Only partners actually shown on the homepage need to be scanned by
-- PartnerLogos.tsx's query, so a partial index keeps that lookup cheap
-- even as the partners table grows.
create index if not exists idx_partners_show_on_homepage
  on public.partners (name)
  where show_on_homepage = true and logo_url is not null;
