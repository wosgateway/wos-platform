-- =====================================================================
-- 078_trip_events_order_item_id_unique.sql
-- Closes a TOCTOU race in POST /api/trips/[tripId]/order-items/import:
-- the route does SELECT ... WHERE order_item_id IN (...) to check which
-- order_items are already linked, then INSERTs the ones that aren't.
-- Two concurrent import requests for the same order_item can both pass
-- the SELECT before either INSERT lands, producing two trip_events rows
-- for one order_item. idx_trip_events_order_item_id (076) is a plain
-- non-unique index and does not prevent this.
--
-- This migration adds the invariant "one order_item links to at most one
-- trip_event" at the database level, where a check-then-insert in
-- application code can't enforce it. Partial (WHERE order_item_id IS NOT
-- NULL) because most trip_events are manually created and have no
-- order_item_id at all.
--
-- Safety guard: aborts if any existing duplicates would violate the new
-- constraint, so a bad apply doesn't silently mask already-corrupt data.
-- =====================================================================

begin;

do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count
  from (
    select order_item_id
    from public.trip_events
    where order_item_id is not null
    group by order_item_id
    having count(*) > 1
  ) dupes;

  if dup_count > 0 then
    raise exception
      '% order_item_id value(s) already have more than one trip_event row — resolve duplicates before applying this migration',
      dup_count;
  end if;
end $$;

create unique index trip_events_order_item_id_unique
  on public.trip_events (order_item_id)
  where order_item_id is not null;

commit;
