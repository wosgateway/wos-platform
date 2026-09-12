import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePartnerTripToken } from "@/lib/trips/resolve-partner-trip-token";

type SortableEvent = { event_date: string; sort_order: number | null };

// GET /api/partner-trip/[token] — the ONLY partner-facing trip read
// path. No login required. Security lives entirely in
// resolvePartnerTripToken()'s exists -> revoked -> expired sequence,
// PLUS the partner_id filter below — do not add any other route that
// queries trip_events for a partner without both trip_id AND
// partner_id from the resolved link.
//
// Deliberately NOT the same handler as /api/my-trip/[token]:
//   - filters trip_events to this partner's own rows only (no other
//     partner's events, no other partner's contact_name/contact_phone)
//   - never joins trip_participants/customers — uses the per-event
//     contact_name/contact_phone columns instead, which is already the
//     minimum contact info this partner needs to do the job
//   - drops trip_events.notes — that column can carry internal/admin
//     remarks not meant to leave WOS; the customer-facing route
//     currently does select it (see my-trip/[token]/route.ts), which
//     is worth a separate look, but this route starts from the safer
//     default rather than inheriting that
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const { link, error } = await resolvePartnerTripToken(params.token);

  if (error === "revoked") {
    return NextResponse.json({ error: "link_revoked" }, { status: 410 });
  }
  if (error === "expired") {
    return NextResponse.json({ error: "link_expired" }, { status: 410 });
  }
  if (error || !link) {
    // same generic response for "not_found" and "invalid_token" as
    // my-trip/[token] — don't help an attacker distinguish a wrong
    // token from a well-formed-but-nonexistent one
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = createServiceClient();

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("trip_number, start_date, end_date, destination, status")
    .eq("id", link.tripId)
    .single();

  if (tripError || !trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // The partner_id filter here is what turns "this trip's events" into
  // "this partner's events" — trip_id alone would return every event
  // on the trip, including other partners'. Both filters come from the
  // resolved link row, never from the request.
  const { data: events, error: eventsError } = await supabase
    .from("trip_events")
    .select(
      `
      id, event_type, title, event_date, start_time, end_time, location,
      status, contact_name, contact_phone, sort_order,
      transport_assignments (
        vehicle, pickup_location, dropoff_location, pickup_time,
        dropoff_time_estimated, status, driver_name, driver_phone
      )
      `
    )
    .eq("trip_id", link.tripId)
    .eq("partner_id", link.partnerId);

  if (eventsError) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const sortedEvents = (events ?? []).sort((a: SortableEvent, b: SortableEvent) => {
    if (a.event_date !== b.event_date) return a.event_date.localeCompare(b.event_date);
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });

  return NextResponse.json({ trip, events: sortedEvents });
}
