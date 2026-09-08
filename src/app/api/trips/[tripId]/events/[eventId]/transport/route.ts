import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";
import { notifyDriverAssigned } from "@/lib/notify/driver-line";

// transport_assignments is a 1:1 child of trip_events (unique trip_event_id,
// see migration 076). PUT here upserts that single row — the DB triggers
// (check_transport_assignment_event_type, check_driver_partner_match, the
// GiST overlap exclusions) do the real validation; we just surface whatever
// error comes back.
export async function PUT(
  req: NextRequest,
  { params }: { params: { tripId: string; eventId: string } }
) {
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
    driver_id,
    driver_name,
    driver_phone,
    vehicle,
    pickup_location,
    dropoff_location,
    pickup_time,
    dropoff_time_estimated,
    status,
  } = body;

  if (!pickup_location || !dropoff_location || !pickup_time) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        { error: "missing_fields", detail: "pickup_location, dropoff_location, pickup_time are required" },
        { status: 400 }
      )
    );
  }

  if (!driver_id && !driver_name) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        { error: "missing_fields", detail: "driver_id or driver_name is required" },
        { status: 400 }
      )
    );
  }

  // The GiST exclusion constraints (migration 076) build tstzrange(pickup_time,
  // dropoff_time_estimated) whenever both are set, and Postgres rejects a range
  // whose lower bound is after its upper bound with a raw, non-obvious message
  // ("range lower bound must be less than or equal to range upper bound").
  // Catch it here with the same check so the admin gets a clear Thai message
  // instead of that error surfacing straight from the DB.
  if (
    dropoff_time_estimated &&
    new Date(dropoff_time_estimated).getTime() < new Date(pickup_time).getTime()
  ) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        {
          error: "dropoff_before_pickup",
          detail: "เวลาส่งโดยประมาณต้องอยู่หลังเวลารับ กรุณาตรวจสอบวันที่และเวลาอีกครั้ง",
        },
        { status: 400 }
      )
    );
  }

  const supabase = createServiceClient();

  // Confirm this event actually belongs to the trip in the URL before
  // touching transport_assignments (trip_event_id has no trip_id column
  // of its own to scope by directly).
  const { data: event, error: eventError } = await supabase
    .from("trip_events")
    .select("id")
    .eq("id", params.eventId)
    .eq("trip_id", params.tripId)
    .single();

  if (eventError || !event) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: "not_found" }, { status: 404 }));
  }

  const row = {
    trip_event_id: params.eventId,
    driver_id: driver_id || null,
    // when a registered driver is picked, drop the ad-hoc name/phone so
    // the row doesn't carry stale text once it has a real driver_id
    driver_name: driver_id ? null : driver_name || null,
    driver_phone: driver_id ? null : driver_phone || null,
    vehicle: vehicle || null,
    pickup_location,
    dropoff_location,
    pickup_time,
    dropoff_time_estimated: dropoff_time_estimated || null,
    status: status || "pending",
  };

  // Was this a create or an edit? Needed only for the driver LINE
  // message's wording ("new job" vs "job updated") — fetched before
  // the upsert since the upsert itself doesn't tell us which branch
  // it took.
  const { data: existingAssignment } = await supabase
    .from("transport_assignments")
    .select("trip_event_id")
    .eq("trip_event_id", params.eventId)
    .maybeSingle();
  const isUpdate = Boolean(existingAssignment);

  console.log("[transport PUT] about to upsert row:", JSON.stringify(row, null, 2));
  console.log("[transport PUT] existingAssignment before upsert:", existingAssignment);

  const { data: assignment, error } = await supabase
    .from("transport_assignments")
    .upsert(row, { onConflict: "trip_event_id" })
    .select("*, drivers ( id, name, phone, partner_id, line_user_id )")
    .single();

  console.log("[transport PUT] upsert result -> data:", JSON.stringify(assignment, null, 2));
  console.log("[transport PUT] upsert result -> error:", error);

  // sanity re-read straight from the DB, bypassing anything upsert() might
  // be doing under the hood, to prove the row is really there
  const { data: recheck, error: recheckError } = await supabase
    .from("transport_assignments")
    .select("*")
    .eq("trip_event_id", params.eventId)
    .maybeSingle();
  console.log("[transport PUT] recheck read after upsert:", JSON.stringify(recheck, null, 2), recheckError);

  if (error) {
    // GiST exclusion / unique-index violations (driver double-booked at
    // an overlapping or identical pickup time) come back as 23P01/23505.
    const conflict = error.code === "23P01" || error.code === "23505";
    // Belt-and-suspenders: the explicit check above should catch this before
    // it ever reaches Postgres, but if it doesn't (e.g. equal-bound edge
    // case), don't let the raw range-constructor message leak to the admin.
    const invalidRange = error.message?.includes("range lower bound must be less than or equal to range upper bound");
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        {
          error: conflict ? "driver_time_conflict" : invalidRange ? "dropoff_before_pickup" : "save_failed",
          detail: conflict
            ? "คนขับคนนี้มีงานอื่นทับช่วงเวลานี้อยู่แล้ว"
            : invalidRange
            ? "เวลาส่งโดยประมาณต้องอยู่หลังเวลารับ กรุณาตรวจสอบวันที่และเวลาอีกครั้ง"
            : error.message,
        },
        { status: conflict ? 409 : 400 }
      )
    );
  }

  // Best-effort push to the driver's own LINE, scoped to only this job's
  // details (see driver-line.ts header). Registered driver + linked
  // LINE account only — ad-hoc drivers and unlinked registered drivers
  // are silently skipped here (still need out-of-band contact for now).
  // NOT awaited: a LINE outage or bad line_user_id must never delay or
  // fail saving the assignment, same reasoning as order-notify.ts.
  if (assignment.drivers?.line_user_id) {
    supabase
      .from("trips")
      .select("customers ( full_name )")
      .eq("id", params.tripId)
      .single()
      .then(({ data: tripRow }) => {
        // trips.customer_id is a not-null many-to-one FK (migration 076),
        // so this join is always a single row at runtime — but without
        // generated Supabase types, the client can't infer that and
        // types `customers` as an array. Normalize defensively so this
        // works regardless of which shape actually comes back.
        const customerRow = Array.isArray(tripRow?.customers)
          ? tripRow.customers[0]
          : tripRow?.customers;
        void notifyDriverAssigned({
          driverLineUserId: assignment.drivers.line_user_id,
          pickupLocation: assignment.pickup_location,
          dropoffLocation: assignment.dropoff_location,
          pickupTime: assignment.pickup_time,
          passengerName: customerRow?.full_name ?? null,
          vehicle: assignment.vehicle,
          isUpdate,
        });
      });
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ assignment }));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { tripId: string; eventId: string } }
) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const supabase = createServiceClient();

  // Same ownership check as PUT: trip_event_id alone doesn't prove the
  // event belongs to the trip in the URL, so confirm it before deleting.
  const { data: event, error: eventError } = await supabase
    .from("trip_events")
    .select("id")
    .eq("id", params.eventId)
    .eq("trip_id", params.tripId)
    .single();

  if (eventError || !event) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: "not_found" }, { status: 404 }));
  }

  const { error } = await supabase
    .from("transport_assignments")
    .delete()
    .eq("trip_event_id", params.eventId);

  if (error) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "delete_failed", detail: error.message }, { status: 500 })
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ deleted: true }));
}
