import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveTripByToken } from "@/lib/trips/resolve-trip-token";

type SortableEvent = { event_date: string; sort_order: number | null };

// GET /api/my-trip/[token] — the ONLY customer-facing trip read path.
// No login required. Security lives entirely in resolveTripByToken()'s
// exists -> revoked -> expired -> scope sequence — do not add any other
// route that queries `trips` by access_token directly.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const { trip, error } = await resolveTripByToken(params.token);

  if (error === "revoked") {
    return NextResponse.json({ error: "link_revoked" }, { status: 410 });
  }
  if (error === "expired") {
    return NextResponse.json({ error: "link_expired" }, { status: 410 });
  }
  if (error || !trip) {
    // deliberately the same generic response for "not_found" and
    // "invalid_token" — don't help an attacker distinguish a wrong token
    // from a well-formed-but-nonexistent one
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = createServiceClient();

  // Every downstream query below filters by trip.id (never by token again)
  // and returns only customer-appropriate fields — no internal ids like
  // order_item_id, no admin-only notes.
  const { data: fullTrip, error: fetchError } = await supabase
    .from("trips")
    .select(
      `
      trip_number, start_date, end_date, origin, destination, status,
      preferred_language,
      trip_participants ( display_name, is_primary, customers ( full_name ) ),
      trip_events (
        event_type, title, event_date, start_time, end_time, location,
        status, contact_name, contact_phone, sort_order, notes,
        partners ( name ),
        transport_assignments (
          vehicle, pickup_location, dropoff_location, pickup_time,
          dropoff_time_estimated, status, driver_name, driver_phone
        )
      )
      `
    )
    .eq("id", trip.id)
    .single();

  if (fetchError || !fullTrip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  fullTrip.trip_events = (fullTrip.trip_events ?? []).sort((a: SortableEvent, b: SortableEvent) => {
    if (a.event_date !== b.event_date) return a.event_date.localeCompare(b.event_date);
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });

  return NextResponse.json({ trip: fullTrip });
}
