-- =====================================================================
-- 088_trip_partner_links.sql
-- Partner-scoped trip links.
--
-- WHY A SEPARATE TABLE INSTEAD OF REUSING trips.access_token:
-- trips.access_token (076) is documented as "the ONLY customer-facing
-- trip read path" — resolveTripByToken() returns every trip_event for
-- the whole trip, unfiltered by partner. Handing that same token to a
-- transport partner or a hotel partner would leak:
--   - other partners' contact_name/contact_phone on events that aren't
--     theirs (cross-partner data exposure)
--   - every trip_event on the trip, not just the one(s) this partner
--     is actually responsible for
--   - no way to revoke a single partner's access without also cutting
--     off the customer (and every other partner sharing that token)
--
-- trip_partner_links gives each (trip, partner) pair its own token,
-- its own expiry, and its own revocation — rotating or revoking one
-- partner's link never touches the customer's link or any other
-- partner's link on the same trip.
--
-- Follows the exact token pattern already proven in 076/077/079
-- (generate_url_safe_token + generated SHA-256 hash column + unique
-- index on the hash) rather than inventing a new one.
-- =====================================================================

begin;

create table public.trip_partner_links (
  id uuid primary key default gen_random_uuid(),

  trip_id uuid not null references public.trips(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,

  access_token text not null unique default public.generate_url_safe_token(24),
  token_expires_at timestamptz,
  token_revoked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- one active link per (trip, partner) — rotate by regenerating
  -- access_token on the existing row (see comment below), not by
  -- inserting a second row for the same pair.
  constraint trip_partner_links_one_per_pair unique (trip_id, partner_id)
);

alter table public.trip_partner_links
  add column access_token_hash text
  generated always as (encode(digest(access_token, 'sha256'), 'hex')) stored;

create unique index trip_partner_links_access_token_hash_unique
  on public.trip_partner_links (access_token_hash);

create index idx_trip_partner_links_trip_id on public.trip_partner_links(trip_id);
create index idx_trip_partner_links_partner_id on public.trip_partner_links(partner_id);

comment on table public.trip_partner_links is
  'Grants one partner a read-scoped link into ONE trip''s events — only '
  'the trip_events rows where trip_events.partner_id matches this row''s '
  'partner_id. Never resolve a partner-facing request against '
  'trips.access_token; always resolve against this table''s '
  'access_token_hash, then filter every downstream query by BOTH '
  'trip_id AND partner_id from the resolved row.';

comment on column public.trip_partner_links.access_token is
  'Same HONEST STATUS caveat as trips.access_token (076): this column '
  'alone is not an authorization boundary. The API layer MUST, in '
  'order: (1) confirm token exists, (2) confirm token_revoked_at is '
  'null, (3) confirm token_expires_at is null or in the future, '
  '(4) THEN scope every trip_events query to trip_id = this row''s '
  'trip_id AND partner_id = this row''s partner_id — never trip_id '
  'alone.';

comment on constraint trip_partner_links_one_per_pair on public.trip_partner_links is
  'To rotate a compromised or expiring link: UPDATE this row (regenerate '
  'access_token, clear token_revoked_at). Do NOT insert a second row for '
  'the same (trip_id, partner_id) — the old row''s token must stop '
  'working the moment the new one is issued, and a second live row '
  'would leave both valid.';

create trigger trip_partner_links_set_updated_at
  before update on public.trip_partner_links
  for each row execute function public.set_updated_at();

-- RLS — deny-by-default, service-role only. Matches every other trip
-- table in 076; API-layer scoping via resolvePartnerTripToken() is
-- what actually enforces the boundary, same division of responsibility
-- as trips.access_token.
alter table public.trip_partner_links enable row level security;

create policy "service_role_only_trip_partner_links" on public.trip_partner_links
  for all using (false);

commit;
