-- =====================================================================
-- 095_trip_reminder_deliveries.sql
-- My Journey Phase 2 — Reminder Engine delivery/idempotency ledger.
--
-- Per the Sprint 2 brief §8 (Duplicate Protection): "ถ้าจำเป็นต้องเพิ่ม
-- persistence สำหรับ notification delivery state ให้เสนอ schema
-- additive migration ก่อน" — this is that migration. Purely additive:
-- one new table, no changes to trips/trip_events/anything else.
--
-- IDEMPOTENCY MODEL:
-- One row per (trip_event_id, reminder_type), enforced by a unique
-- constraint. The engine CLAIMS a reminder slot by inserting a 'pending'
-- row BEFORE attempting to send (see claimDelivery() in
-- src/lib/trips/reminders/duplicate.ts) — if two scheduler runs (or a
-- cron overlap) race for the same event+type, the loser's insert hits
-- the unique constraint and gets a Postgres 23505 error, which the app
-- layer treats as "already being handled, skip" rather than an error.
-- The row is then updated to 'sent' / 'failed' / 'skipped' once the
-- actual send attempt resolves.
--
-- TRADEOFF (documented, not hidden): a row stuck at 'pending' (e.g. the
-- Node process crashed between claim and update) permanently blocks a
-- retry of that exact event+type, since the unique constraint has no
-- concept of "pending expired, safe to reclaim." Phase 2 has no retry
-- requirement in the brief, so this is acceptable for v1 — an admin can
-- delete the stuck row directly if a resend is ever needed. A future
-- phase could add a claimed_at timestamp + reclaim-after-N-minutes
-- policy if that becomes a real operational problem.
-- =====================================================================

begin;

create type trip_reminder_type as enum ('r1_24h', 'r2_1h', 'r3_confirmed');
create type trip_reminder_delivery_status as enum ('pending', 'sent', 'failed', 'skipped');

create table public.trip_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  trip_event_id uuid not null references public.trip_events(id) on delete cascade,

  reminder_type trip_reminder_type not null,
  channel text not null default 'whatsapp',

  status trip_reminder_delivery_status not null default 'pending',
  -- populated on 'failed' (error message) or 'skipped' (reason code, e.g.
  -- 'no_whatsapp_contact', 'event_cancelled') — never populated with
  -- customer PII, matching the no-raw-response-body logging rule already
  -- followed in src/lib/notify/customer-whatsapp.ts
  reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trip_reminder_deliveries_one_per_event_type unique (trip_event_id, reminder_type)
);

create index idx_trip_reminder_deliveries_event on public.trip_reminder_deliveries(trip_event_id);
create index idx_trip_reminder_deliveries_status on public.trip_reminder_deliveries(status);

-- reuses public.set_updated_at(), already defined in migration 076
create trigger trip_reminder_deliveries_set_updated_at
  before update on public.trip_reminder_deliveries
  for each row execute function public.set_updated_at();

-- Same deny-by-default posture as every other Trip/Journey table
-- (076): service-role only, no anon/authenticated policy. All access
-- goes through the reminder engine's service-role Supabase client.
alter table public.trip_reminder_deliveries enable row level security;

create policy "service_role_only_trip_reminder_deliveries"
  on public.trip_reminder_deliveries for all using (false);

commit;
