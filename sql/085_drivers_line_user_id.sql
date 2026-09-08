-- 085_drivers_line_user_id.sql
--
-- Adds drivers.line_user_id — the LINE userId used to push job details
-- (pickup/dropoff/time/passenger only, scoped to that driver's own
-- assignment) to a registered driver when a transport_assignment is
-- created or changed.
--
-- This column is expected to be populated automatically later by an
-- inbound LINE webhook that matches the sender's phone number against
-- drivers.phone (auto phone-match). It is nullable and admin-editable
-- from day one so that:
--   - a driver can be linked manually before the auto-match flow exists
--   - admin can clear/fix a mislinked value if the phone-match links the
--     wrong driver (e.g. shared/reused phone numbers)
--
-- Ad-hoc drivers (typed name/phone directly on a trip_event, not a row
-- in this table) have no way to carry a line_user_id and are out of
-- scope here — they still need to be notified out-of-band.

alter table public.drivers
  add column if not exists line_user_id text;

comment on column public.drivers.line_user_id is
  'LINE userId to push this driver''s own assignment details to (pickup, '
  'dropoff, time, passenger — never the full trip). Populated either by '
  'admin manually, or later by an inbound LINE webhook that auto-matches '
  'on drivers.phone. Admin-editable so a mislinked value can be '
  'corrected or cleared.';

-- One driver should only ever be pushed to one LINE account at a time;
-- guard against silently double-linking two driver rows to the same
-- LINE userId by accident (nulls are unrestricted, per Postgres default).
create unique index if not exists idx_drivers_line_user_id_unique
  on public.drivers(line_user_id)
  where line_user_id is not null;
