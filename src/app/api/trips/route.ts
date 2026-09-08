import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";

type ParticipantInput = { customer_id?: string | null; display_name?: string | null };

// GET /api/trips — list trips (admin). Supports ?status= and ?customer_id=
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
      customers ( id, full_name, phone )
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

  return withCarriedCookies(cookieCarrier, NextResponse.json({ trips: data }));
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
