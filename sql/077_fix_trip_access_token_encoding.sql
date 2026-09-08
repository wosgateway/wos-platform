-- =====================================================================
-- 077_fix_trip_access_token_encoding.sql
-- Follow-up to 076 v6 (already committed) — 076 as run left
-- trips.access_token defaulting to encode(gen_random_bytes(24), 'base64url'),
-- which errors with "unrecognized encoding: base64url" on every INSERT
-- because that encode() format needs PostgreSQL 19+ (this project isn't
-- on it). Confirmed live via POST /api/trips returning 500
-- {"error":"create_failed","detail":"unrecognized encoding: \"base64url\""}.
--
-- No data to migrate: every insert attempt failed on this same default,
-- so trips currently has zero rows. This migration only:
--   1. adds public.generate_url_safe_token(byte_length) — built on the
--      universally-supported 'base64' format, made URL-safe via
--      translate('+/=','-_') (drops '=' padding since translate() removes
--      source chars with no matching target char)
--   2. repoints trips.access_token's default at it
-- Nothing else in the 076 schema (tables, other triggers, RLS, the
-- transport_assignments exclusion-constraint split) is touched.
-- =====================================================================

begin;

create or replace function public.generate_url_safe_token(byte_length integer default 24)
returns text
language sql
as $$
  select translate(encode(gen_random_bytes(byte_length), 'base64'), '+/=', '-_');
$$;

alter table public.trips
  alter column access_token set default public.generate_url_safe_token(24);

commit;
