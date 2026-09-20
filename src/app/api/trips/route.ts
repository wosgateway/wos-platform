import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";
import {
  computeAttentionCases,
  computeOverallStatus,
  computeJourneyProgress,
  findNextEvent,
  type AttentionTrip,
  type AttentionReminderDelivery,
  type AttentionTripEvent,
} from "@/lib/journey/attention";

type ParticipantInput = { customer_id?: string | null; display_name?: string | null };

// GET /api/trips — list trips (admin). Supports ?status= and ?customer_id=
//
// Attention/progress/next-event are computed here per trip, not just at
// detail-view time, so the list badges match the Journey Control Center
// spec (Section 4: progress, next event, pending items, attention flag per
// card). This is still ONE query — trip_participants→customers(phone) and
// trip_events→trip_reminder_deliveries are embedded resources PostgREST
// resolves in the same round trip, not a per-trip follow-up query. Event
// fields are kept intentionally narrower than the detail route's select
// (no notes/contact_name/etc.) since this runs once per trip in the list,
// not once for a single trip.
export async function GET(req: NextRequest) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const customerId = searchParams.get("customer_id");

  // trips has RLS "for all using (false)" — deny-by-default for every
  // operation (not just writes). requireAdmin() above is the real
  // authorization gate; this service-role client is what lets an already-
  // authorized request actually reach the table (see src/lib/supabase/service.ts).
  const supabase = createServiceClient();

  let query = supabase
    .from("trips")
    .select(
      `
      id, trip_number, customer_id, start_date, end_date, origin, destination,
      status, requires_passport, requires_visa, preferred_language, created_at,
      customers ( id, full_name, phone ),
      trip_participants ( is_primary, customers ( phone ) ),
      trip_events (
        id, event_type, title, event_date, start_time, status, location, partner_id,
        transport_assignments ( driver_id, driver_name, pickup_location, dropoff_location ),
        trip_reminder_deliveries ( trip_event_id, reminder_type, status )
      )
      `
    )
    .order("start_date", { ascending: false });

  if (status) query = query.eq("status", status);
  if (customerId) query = query.eq("customer_id", customerId);

  const { data, error } = await query;

  if (error) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "fetch_failed", detail: error.message }, { status: 500 })
    );
  }

  const trips = (data ?? []).map((trip) => {
    const attentionTrip = trip as unknown as AttentionTrip;
    const reminders: AttentionReminderDelivery[] = (trip.trip_events ?? []).flatMap(
      (ev: { trip_reminder_deliveries?: AttentionReminderDelivery[] | null }) => ev.trip_reminder_deliveries ?? []
    );
    const attentionCases = computeAttentionCases(attentionTrip, reminders);
    const nextEvent = findNextEvent(attentionTrip) as AttentionTripEvent | null;

    // Strip the heavy nested arrays from the payload — the list view only
    // needs the computed summary, not every event/assignment/reminder row.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { trip_events: _events, trip_participants: _participants, ...tripSummary } = trip;

    return {
      ...tripSummary,
      attention: {
        cases: attentionCases,
        overallStatus: computeOverallStatus(attentionTrip, attentionCases),
        progress: computeJourneyProgress(attentionTrip),
        nextEvent: nextEvent ? { id: nextEvent.id, title: nextEvent.title, event_date: nextEvent.event_date, start_time: nextEvent.start_time } : null,
      },
    };
  });

  return withCarriedCookies(cookieCarrier, NextResponse.json({ trips }));
}

// POST /api/trips — create a new trip (admin)
export async function POST(req: NextRequest) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: "invalid_json" }, { status: 400 }));
  }

  const {
    customer_id,
    start_date,
    end_date,
    origin,
    destination,
    requires_passport = false,
    requires_visa = false,
    border_notes,
    preferred_language = "th",
    notes,
    participants,
  } = body;

  if (!customer_id || !start_date || !end_date) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        { error: "missing_fields", detail: "customer_id, start_date, end_date are required" },
        { status: 400 }
      )
    );
  }

  // Same reasoning as GET — trips/trip_participants are RLS deny-by-default,
  // requireAdmin() already gated this request, service client is what lets
  // the insert actually land.
  const supabase = createServiceClient();

  const { data: trip, error } = await supabase
    .from("trips")
    .insert({
      customer_id,
      start_date,
      end_date,
      origin,
      destination,
      requires_passport,
      requires_visa,
      border_notes,
      preferred_language,
      notes,
    })
    .select()
    .single();

  if (error || !trip) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "create_failed", detail: error?.message }, { status: 500 })
    );
  }

  const participantRows = [
    { trip_id: trip.id, customer_id, is_primary: true },
    ...(Array.isArray(participants)
      ? participants
          .filter((p: ParticipantInput) => p?.customer_id !== customer_id)
          .map((p: ParticipantInput) => ({
            trip_id: trip.id,
            customer_id: p.customer_id ?? null,
            display_name: p.display_name ?? null,
            is_primary: false,
          }))
      : []),
  ];

  const { error: participantError } = await supabase.from("trip_participants").insert(participantRows);

  if (participantError) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        { trip, warning: "trip created, but participant insert failed", detail: participantError.message },
        { status: 201 }
      )
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ trip }, { status: 201 }));
}
