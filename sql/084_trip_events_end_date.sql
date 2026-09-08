-- =====================================================================
-- 084_trip_events_end_date.sql
-- trip_events currently models every event as happening within a single
-- calendar day (event_date + optional start_time/end_time). That's wrong
-- for 'hotel' events, which span a check-in date and a (later) check-out
-- date — there is no meaningful "start_time/end_time" for a hotel stay,
-- only which day you arrive and which day you leave.
--
-- Adds end_date, nullable so existing single-day events (and non-hotel
-- types) are unaffected. event_date keeps meaning "check-in / the day
-- this event starts"; end_date, when set, is "check-out / the day it
-- ends". Application layer decides which event_types populate it (hotel,
-- initially) — not enforced here, same pattern as other optional columns
-- on this table (location, notes, etc).
-- =====================================================================

begin;

alter table public.trip_events
  add column end_date date;

alter table public.trip_events
  add constraint trip_events_end_date_after_event_date
  check (end_date is null or end_date >= event_date);

commit;
