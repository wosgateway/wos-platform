-- =====================================================================
-- 079_trips_access_token_hash_index.sql
-- Fixes the O(n) full-table scan in resolveTripByToken()
-- (src/lib/trips/resolve-trip-token.ts): today it fetches every row in
-- trips (.limit(1000)) and runs crypto.timingSafeEqual() against each
-- one in application code, purely to avoid a plain SQL
-- `WHERE access_token = $1` (non-constant-time string comparison at the
-- Postgres level). That scan gets linearly slower and heavier as trips
-- grows past the ~1000-row Phase 1 assumption.
--
-- trips.access_token is already `unique` (076), so Postgres already
-- maintains a b-tree index on it — the scan was never about a missing
-- index, only about avoiding SQL's non-constant-time '=' on the raw
-- secret. This migration adds a SHA-256 hash of the token as a stored
-- generated column with its own unique index, so the app can look up by
-- hash (an O(1) indexed equality match) instead of scanning.
--
-- This is still safe: SHA-256's avalanche effect means a timing
-- difference in comparing hash digests reveals nothing about the
-- original token's characters — unlike comparing the raw token, you
-- cannot use hash-comparison timing to guess your way to a valid token.
-- The app pairs this with one final timingSafeEqual() against the
-- single row the hash lookup returns (not the whole table) as
-- defense-in-depth against a hash collision — negligible cost since
-- it's one comparison, not N.
--
-- pgcrypto is already enabled (076), so digest() is available.
-- =====================================================================

begin;

alter table public.trips
  add column access_token_hash text
  generated always as (encode(digest(access_token, 'sha256'), 'hex')) stored;

create unique index trips_access_token_hash_unique
  on public.trips (access_token_hash);

comment on column public.trips.access_token_hash is
  'SHA-256 hex digest of access_token, maintained automatically as a '
  'generated column. Look up trips by this column indexed O(log n)) '
  'instead of scanning access_token directly. Never derive this by '
  'hashing a token client-side and trusting the match alone — always '
  'follow with a timingSafeEqual() check against the single returned '
  'row''s access_token before treating the token as valid.';

commit;
