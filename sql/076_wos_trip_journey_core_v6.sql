-- =====================================================================
-- 076_wos_trip_journey_core.sql (v6 — fixes v5's non-IMMUTABLE index expr)
-- WOS Trip Journey System — Phase 1 (Trip Core)
--
-- Changes from v5:
--   -1. MUST-FIX: the two EXCLUDE ... USING gist constraints on
--       transport_assignments computed `pickup_time + interval '1 hour'`
--       as a fallback when dropoff_time_estimated was null, directly
--       inside the index expression. `timestamptz + interval` is
--       registered STABLE in Postgres (not IMMUTABLE) — Postgres can't
--       tell at the catalog level whether a given interval value is
--       "pure hours" (safe) vs. carries day/month components (whose
--       result depends on the TimeZone setting, e.g. across a DST
--       transition), so the operator is uniformly STABLE regardless of
--       which interval literal you actually pass. GiST index expressions
--       must be IMMUTABLE, so this failed with 42P17 on migration run.
--       Fix: dropped the interval arithmetic from the index expression
--       entirely. Each exclusion constraint is now split in two:
--         (a) rows where dropoff_time_estimated IS NOT NULL — overlap
--             check via tstzrange(pickup_time, dropoff_time_estimated),
--             both plain column refs, genuinely immutable.
--         (b) rows where dropoff_time_estimated IS NULL — no duration to
--             range against, so fall back to a plain unique index on
--             (driver_id/driver_name, pickup_time): still catches two
--             assignments starting at the exact same instant, but won't
--             catch a partial overlap when neither row has an estimated
--             dropoff. Acceptable for V1 — encourage capturing
--             dropoff_time_estimated at booking time to get the full
--             overlap guarantee from (a).
--
-- Changes from v4:
--   0. MUST-FIX: trip_events_validate_partner_change_vs_driver was declared
--      "before update of partner_id" only. Postgres decides whether a
--      column-specific trigger fires from the UPDATE statement's SET list,
--      not from whether the column's value actually changed at runtime —
--      so an UPDATE that only touches order_item_id (and lets
--      trip_events_sync_partner derive a new partner_id as a side effect)
--      never fired this validator. Now declared
--      "before update of partner_id, order_item_id" so both paths are
--      covered. trip_events_sync_partner still runs first in the same
--      BEFORE UPDATE (alphabetical trigger ordering: "..._sync_partner"
--      < "..._validate_partner_change_vs_driver"), so this trigger always
--      sees the post-sync NEW.partner_id.
--
-- Changes from v3:
--   1. MUST-FIX: new trigger on trip_events — when partner_id changes
--      (directly, or via order_item_id sync) and this event already has
--      a transport_assignment with a driver_id, re-validates that the
--      driver still belongs to the (new) partner or is a shared-pool
--      driver (partner_id is null). Closes the hole where changing an
--      event's partner after a driver was already assigned left a
--      stale cross-partner assignment unchecked.
--   2. Adopted reviewer's Option A: trip_number is now a clean global
--      sequence (WT-00000001, WT-00000002, ...) instead of date-prefixed —
--      avoids the "format gets long and ambiguous after a few years"
--      operational concern. Still collision-proof (same sequence
--      mechanism as v3, just reformatted).
--   3. Business rule for driver/partner confirmed and kept as-is (no
--      schema change needed, v3 already implemented this correctly):
--        - driver.partner_id set -> driver can only serve that partner's events
--        - driver.partner_id null -> WOS shared pool, can serve any partner
--        - event.partner_id null -> logistics-only event, any driver OK
--   4. access_token: documentation comment kept (v3), status honestly
--      remains "rule defined + visible in DB, NOT enforced by DB" —
--      real enforcement is Trip CRUD API work, tracked as the next step,
--      not schema work. Not re-claimed as fixed here.
--
-- ASSUMPTIONS TO VERIFY BEFORE RUNNING:
--   - public.customers(id), public.partners(id), public.order_items(id)
--     exist with the columns this migration references (order_items.partner_id)
--   - No DB-level is_admin() helper exists yet -> RLS stays deny-by-default
-- =====================================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------

create type trip_status as enum (
  'planned', 'in_progress', 'completed', 'cancelled'
);

create type trip_event_type as enum (
  'transport', 'hotel', 'health', 'wellness', 'dining', 'shopping', 'tour', 'experience', 'other'
);

create type trip_event_status as enum (
  'pending', 'confirmed', 'in_progress', 'completed', 'cancelled'
);

create type transport_status as enum (
  'pending', 'confirmed', 'driver_assigned', 'picked_up', 'dropped_off', 'cancelled'
);

create type driver_status as enum (
  'active', 'inactive'
);

-- ---------------------------------------------------------------------
-- SEQUENCE for human-readable trip numbers — global sequence, clean
-- format per reviewer's Option A (no date prefix, no future ambiguity)
-- ---------------------------------------------------------------------

create sequence public.trip_number_seq;

create or replace function public.generate_trip_number()
returns text
language sql
as $$
  select 'WT-' || lpad(nextval('public.trip_number_seq')::text, 8, '0');
$$;

-- ---------------------------------------------------------------------
-- DRIVERS
-- ---------------------------------------------------------------------

create table public.drivers (
  id uuid primary key default gen_random_uuid(),

  -- null = WOS shared/pool driver, can serve any partner's events.
  -- set  = dedicated to that partner's events only.
  partner_id uuid references public.partners(id),

  name text not null,
  phone text,
  status driver_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.drivers.partner_id is
  'NULL means WOS-managed shared transport pool driver — can be assigned to '
  'any partner''s trip_event. A non-null value restricts this driver to '
  'trip_events belonging to that same partner (enforced by '
  'check_driver_partner_match trigger on transport_assignments and '
  'check_event_partner_change_driver_impact trigger on trip_events).';

create index idx_drivers_partner_id on public.drivers(partner_id);

-- ---------------------------------------------------------------------
-- TRIPS
-- ---------------------------------------------------------------------

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  trip_number text not null unique default public.generate_trip_number(),

  customer_id uuid not null references public.customers(id),

  start_date date not null,
  end_date date not null,
  origin text,
  destination text,

  status trip_status not null default 'planned',

  requires_passport boolean not null default false,
  requires_visa boolean not null default false,
  border_notes text,

  preferred_language text not null default 'th'
    check (preferred_language in ('th', 'lo', 'en', 'ru', 'zh')),

  access_token text not null unique default encode(gen_random_bytes(24), 'base64url'),
  token_expires_at timestamptz,
  token_revoked_at timestamptz,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trips_dates_valid check (end_date >= start_date)
);

comment on column public.trips.access_token is
  'HONEST STATUS: rule defined + documented here, NOT enforced by the database. '
  'This column alone is not an authorization boundary. API layer MUST, in order: '
  '(1) confirm token exists, (2) confirm token_revoked_at is null, '
  '(3) confirm token_expires_at is null or in the future, (4) THEN scope the '
  'query to this trip only. A bare `SELECT * FROM trips WHERE access_token = $1` '
  'with no expiry/revocation check is a security bug, not an acceptable shortcut. '
  'This enforcement is Trip CRUD API work — tracked separately, not done yet.';

create index idx_trips_customer_id on public.trips(customer_id);
create index idx_trips_status on public.trips(status);
create index idx_trips_dates on public.trips(start_date, end_date);

-- ---------------------------------------------------------------------
-- TRIP PARTICIPANTS
-- ---------------------------------------------------------------------

create table public.trip_participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  customer_id uuid references public.customers(id),
  display_name text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),

  constraint trip_participants_identity check (
    customer_id is not null or display_name is not null
  )
);

create index idx_trip_participants_trip_id on public.trip_participants(trip_id);
create unique index idx_trip_participants_one_primary
  on public.trip_participants(trip_id) where is_primary;
create unique index idx_trip_participants_no_dupe_customer
  on public.trip_participants(trip_id, customer_id) where customer_id is not null;

-- ---------------------------------------------------------------------
-- TRIP EVENTS
-- ---------------------------------------------------------------------

create table public.trip_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,

  event_type trip_event_type not null,
  title text not null,

  event_date date not null,
  start_time time,
  end_time time,

  location text,

  status trip_event_status not null default 'pending',

  partner_id uuid references public.partners(id),
  order_item_id uuid references public.order_items(id),

  contact_name text,
  contact_phone text,

  sort_order integer not null default 0,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_trip_events_trip_id on public.trip_events(trip_id);
create index idx_trip_events_partner_id on public.trip_events(partner_id);
create index idx_trip_events_order_item_id on public.trip_events(order_item_id);
create index idx_trip_events_date on public.trip_events(event_date);
create index idx_trip_events_status on public.trip_events(status);

-- v3: sync partner_id from order_items whenever order_item_id is set,
-- fires on either column changing — cannot diverge via direct UPDATE.
create or replace function public.sync_trip_event_partner()
returns trigger
language plpgsql
as $$
declare
  linked_partner_id uuid;
begin
  if new.order_item_id is not null then
    select partner_id into linked_partner_id
    from public.order_items
    where id = new.order_item_id;

    if linked_partner_id is null then
      raise exception 'order_item % has no partner_id; cannot link trip_event', new.order_item_id;
    end if;

    new.partner_id := linked_partner_id;
  end if;

  return new;
end;
$$;

create trigger trip_events_sync_partner
  before insert or update of order_item_id, partner_id on public.trip_events
  for each row execute function public.sync_trip_event_partner();

-- when this event's partner_id ends up changing (whether directly, via a
-- direct SET partner_id = ..., or indirectly via order_item_id changing
-- and trip_events_sync_partner deriving a new partner_id) — this trigger
-- fires on updates of either column (see header note, v5 fix) and runs
-- AFTER trip_events_sync_partner within the same BEFORE UPDATE row
-- (alphabetical ordering: "..._sync_partner" < "..._validate_..."), so it
-- always reads the post-sync NEW.partner_id — check any existing
-- transport_assignment on this event still has a valid driver for the
-- new partner.
create or replace function public.validate_event_partner_change_vs_driver()
returns trigger
language plpgsql
as $$
declare
  assigned_driver_id uuid;
  assigned_driver_partner_id uuid;
begin
  if new.partner_id is distinct from old.partner_id then
    select ta.driver_id into assigned_driver_id
    from public.transport_assignments ta
    where ta.trip_event_id = new.id;

    if assigned_driver_id is not null then
      select partner_id into assigned_driver_partner_id
      from public.drivers
      where id = assigned_driver_id;

      if new.partner_id is not null
         and assigned_driver_partner_id is not null
         and new.partner_id is distinct from assigned_driver_partner_id then
        raise exception
          'cannot change trip_event % to partner % — it already has a transport_assignment with driver % who belongs to partner %. Reassign or unassign the driver first.',
          new.id, new.partner_id, assigned_driver_id, assigned_driver_partner_id;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger trip_events_validate_partner_change_vs_driver
  before update of partner_id, order_item_id on public.trip_events
  for each row execute function public.validate_event_partner_change_vs_driver();

-- ---------------------------------------------------------------------
-- TRANSPORT ASSIGNMENTS
-- ---------------------------------------------------------------------

create table public.transport_assignments (
  id uuid primary key default gen_random_uuid(),
  trip_event_id uuid not null unique references public.trip_events(id) on delete cascade,

  driver_id uuid references public.drivers(id),
  driver_name text,
  driver_phone text,

  vehicle text,

  pickup_location text not null,
  dropoff_location text not null,
  pickup_time timestamptz not null,
  dropoff_time_estimated timestamptz,

  status transport_status not null default 'pending',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint transport_assignments_driver_identity check (
    driver_id is not null or driver_name is not null
  )
);

create index idx_transport_assignments_pickup_time on public.transport_assignments(pickup_time);
create index idx_transport_assignments_driver_id on public.transport_assignments(driver_id);

-- (a) registered driver, known dropoff estimate — full overlap protection
alter table public.transport_assignments
  add constraint transport_assignments_no_driver_id_overlap
  exclude using gist (
    driver_id with =,
    tstzrange(pickup_time, dropoff_time_estimated) with &&
  )
  where (status <> 'cancelled' and driver_id is not null and dropoff_time_estimated is not null);

-- (a-null) registered driver, no dropoff estimate yet — can only catch an
-- exact-same-instant collision, not a partial overlap (see header note)
create unique index transport_assignments_no_driver_id_same_pickup
  on public.transport_assignments(driver_id, pickup_time)
  where (status <> 'cancelled' and driver_id is not null and dropoff_time_estimated is null);

-- (b) ad-hoc driver (name fallback), known dropoff estimate
alter table public.transport_assignments
  add constraint transport_assignments_no_driver_name_overlap
  exclude using gist (
    driver_name with =,
    tstzrange(pickup_time, dropoff_time_estimated) with &&
  )
  where (status <> 'cancelled' and driver_id is null and driver_name is not null and dropoff_time_estimated is not null);

-- (b-null) ad-hoc driver, no dropoff estimate yet
create unique index transport_assignments_no_driver_name_same_pickup
  on public.transport_assignments(driver_name, pickup_time)
  where (status <> 'cancelled' and driver_id is null and driver_name is not null and dropoff_time_estimated is null);

create or replace function public.check_transport_assignment_event_type()
returns trigger
language plpgsql
as $$
declare
  linked_event_type trip_event_type;
begin
  select event_type into linked_event_type
  from public.trip_events
  where id = new.trip_event_id;

  if linked_event_type is distinct from 'transport' then
    raise exception 'trip_event % is not a transport event (type=%), cannot attach a transport_assignment',
      new.trip_event_id, linked_event_type;
  end if;

  return new;
end;
$$;

create trigger transport_assignments_check_event_type
  before insert or update of trip_event_id on public.transport_assignments
  for each row execute function public.check_transport_assignment_event_type();

-- driver must belong to the same partner as the event (or be a shared-pool
-- driver with partner_id null) — checked at assignment time
create or replace function public.check_driver_partner_match()
returns trigger
language plpgsql
as $$
declare
  event_partner_id uuid;
  assigned_driver_partner_id uuid;
begin
  if new.driver_id is null then
    return new;
  end if;

  select partner_id into event_partner_id
  from public.trip_events
  where id = new.trip_event_id;

  select partner_id into assigned_driver_partner_id
  from public.drivers
  where id = new.driver_id;

  if event_partner_id is not null
     and assigned_driver_partner_id is not null
     and event_partner_id is distinct from assigned_driver_partner_id then
    raise exception
      'driver % belongs to partner %, but trip_event % belongs to partner % — cross-partner driver assignment is not allowed (driver.partner_id must be null for a shared-pool driver)',
      new.driver_id, assigned_driver_partner_id, new.trip_event_id, event_partner_id;
  end if;

  return new;
end;
$$;

create trigger transport_assignments_check_driver_partner
  before insert or update of driver_id, trip_event_id on public.transport_assignments
  for each row execute function public.check_driver_partner_match();

-- =====================================================================
-- updated_at triggers
-- =====================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger drivers_set_updated_at
  before update on public.drivers
  for each row execute function public.set_updated_at();

create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

create trigger trip_events_set_updated_at
  before update on public.trip_events
  for each row execute function public.set_updated_at();

create trigger transport_assignments_set_updated_at
  before update on public.transport_assignments
  for each row execute function public.set_updated_at();

-- =====================================================================
-- RLS — deny-by-default, service-role only (unchanged; API-layer scoping
-- is the next piece of work — Trip CRUD API)
-- =====================================================================

alter table public.drivers enable row level security;
alter table public.trips enable row level security;
alter table public.trip_participants enable row level security;
alter table public.trip_events enable row level security;
alter table public.transport_assignments enable row level security;

create policy "service_role_only_drivers" on public.drivers for all using (false);
create policy "service_role_only_trips" on public.trips for all using (false);
create policy "service_role_only_trip_participants" on public.trip_participants for all using (false);
create policy "service_role_only_trip_events" on public.trip_events for all using (false);
create policy "service_role_only_transport_assignments" on public.transport_assignments for all using (false);

commit;
