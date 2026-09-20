-- 086_partners_line_user_id.sql
--
-- Adds partners.line_user_id — the LINE userId used to push a hotel's
-- own guest details (check-in, check-out, guest name — never transport
-- or clinic info) when a trip_event of type 'hotel' linked to that
-- partner is created or edited.
--
-- Unlike drivers.line_user_id (migration 085), there is no
-- "auto phone-match" for partners: the partners table has no phone
-- column to match an inbound LINE message against (see
-- partner_update_own_profile migration — partners only has
-- name/description/province/logo_url/cover_image_url). This stays
-- admin-set-only, nullable, and editable from day one.

alter table public.partners
  add column if not exists line_user_id text;

comment on column public.partners.line_user_id is
  'LINE userId to push this hotel''s own guest details to (check-in, '
  'check-out, guest name — never transport/clinic info from the same '
  'trip). Admin-set only; no auto phone-match exists for partners '
  '(unlike drivers.line_user_id, see migration 085) since partners has '
  'no phone column to match against.';

-- Same guard as drivers.line_user_id: one partner shouldn't silently
-- share a LINE account with another (nulls are unrestricted).
create unique index if not exists idx_partners_line_user_id_unique
  on public.partners(line_user_id)
  where line_user_id is not null;

-- No backfill from partner_applications.primary_line_id: that table
-- (see 030_partner_applications.sql) has no column linking a row back
-- to the partners row it became once approved — company_name is the
-- only text in common, and matching on that is too fuzzy to trust for
-- an unattended migration (same name used twice, renamed on approval,
-- etc). Any existing approved partner who already gave a LINE ID at
-- signup needs it re-entered once via the admin field added to
-- PartnersManager.tsx — a one-time manual pass, not something safe to
-- automate here.
