import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";
import { notifyPartnerHotelEvent } from "@/lib/notify/hotel-line";

const EVENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  // Terminal states still allow reverting, so an accidental status change
  // can be corrected without a direct DB edit. Kept in sync with the
  // frontend copy in JourneyDetail.tsx.
  completed: ["in_progress"],
  cancelled: ["pending"],
};

export async function PATCH(
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

  const supabase = createServiceClient();

  const editable = [
    "title",
    "event_date",
    "end_date",
    "start_time",
    "end_time",
    "location",
    "partner_id",
    "contact_name",
    "contact_phone",
    "sort_order",
    "notes",
  ];

  const patch: Record<string, unknown> = {};
  for (const key of editable) {
    if (key in body) patch[key] = body[key];
  }

  if ("status" in body) {
    const { data: current, error: currentError } = await supabase
      .from("trip_events")
      .select("status")
      .eq("id", params.eventId)
      .eq("trip_id", params.tripId)
      .single();

    if (currentError || !current) {
      return withCarriedCookies(cookieCarrier, NextResponse.json({ error: "not_found" }, { status: 404 }));
    }

    const allowed = EVENT_STATUS_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(body.status)) {
      return withCarriedCookies(
        cookieCarrier,
        NextResponse.json(
          { error: "invalid_transition", detail: `cannot move from ${current.status} to ${body.status}` },
          { status: 400 }
        )
      );
    }

    patch.status = body.status;
  }

  if (Object.keys(patch).length === 0) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "no_editable_fields_provided" }, { status: 400 })
    );
  }

  const { data: event, error } = await supabase
    .from("trip_events")
    .update(patch)
    .eq("id", params.eventId)
    .eq("trip_id", params.tripId)
    .select("*, partners ( id, name, line_user_id )")
    .single();

  if (error || !event) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "update_failed", detail: error?.message }, { status: 400 })
    );
  }

  // Best-effort push to the hotel's own LINE — same scope/conditions
  // as the create path in events/route.ts. Fires on every edit that
  // touches an editable field, not just check-in/out changes; simpler
  // than diffing which fields actually changed, and an extra ping to
  // a hotel about their own guest is a low-cost false positive.
  if (event.event_type === "hotel" && event.partners?.line_user_id) {
    void notifyPartnerHotelEvent({
      partnerLineUserId: event.partners.line_user_id,
      title: event.title,
      checkInDate: event.event_date,
      checkOutDate: event.end_date,
      guestName: event.contact_name,
      notes: event.notes,
      isUpdate: true,
    });
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ event }));
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

  const { error } = await supabase
    .from("trip_events")
    .delete()
    .eq("id", params.eventId)
    .eq("trip_id", params.tripId);

  if (error) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "delete_failed", detail: error.message }, { status: 500 })
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ deleted: true }));
}
