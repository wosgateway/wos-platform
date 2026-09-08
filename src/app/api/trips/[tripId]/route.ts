import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";

type SortableEvent = { event_date: string; sort_order: number | null };

export async function GET(req: NextRequest, { params }: { params: { tripId: string } }) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const supabase = createServiceClient();

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select(
      `
      *,
      customers ( id, full_name, phone ),
      trip_participants ( id, customer_id, display_name, is_primary ),
      trip_events (
        id, event_type, title, event_date, start_time, end_time, location,
        status, partner_id, order_item_id, contact_name, contact_phone,
        sort_order, notes,
        partners ( id, name ),
        transport_assignments (
          id, driver_id, driver_name, driver_phone, vehicle,
          pickup_location, dropoff_location, pickup_time, dropoff_time_estimated, status,
          drivers ( id, name, phone, partner_id )
        )
      )
      `
    )
    .eq("id", params.tripId)
    .single();

  if (tripError || !trip) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: "not_found" }, { status: 404 }));
  }

  trip.trip_events = (trip.trip_events ?? []).sort((a: SortableEvent, b: SortableEvent) => {
    if (a.event_date !== b.event_date) return a.event_date.localeCompare(b.event_date);
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });

  return withCarriedCookies(cookieCarrier, NextResponse.json({ trip }));
}

export async function PATCH(req: NextRequest, { params }: { params: { tripId: string } }) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: "invalid_json" }, { status: 400 }));
  }

  const editable = [
    "start_date",
    "end_date",
    "origin",
    "destination",
    "status",
    "requires_passport",
    "requires_visa",
    "border_notes",
    "preferred_language",
    "notes",
  ];

  const patch: Record<string, unknown> = {};
  for (const key of editable) {
    if (key in body) patch[key] = body[key];
  }

  if (Object.keys(patch).length === 0) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "no_editable_fields_provided" }, { status: 400 })
    );
  }

  const supabase = createServiceClient();

  const { data: trip, error } = await supabase
    .from("trips")
    .update(patch)
    .eq("id", params.tripId)
    .select()
    .single();

  if (error || !trip) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "update_failed", detail: error?.message }, { status: 500 })
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ trip }));
}
