import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";
import { notifyPartnerHotelEvent } from "@/lib/notify/hotel-line";

export async function GET(req: NextRequest, { params }: { params: { tripId: string } }) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("trip_events")
    .select("*, partners ( id, name ), transport_assignments ( * )")
    .eq("trip_id", params.tripId)
    .order("event_date", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "fetch_failed", detail: error.message }, { status: 500 })
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ events: data }));
}

export async function POST(req: NextRequest, { params }: { params: { tripId: string } }) {
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
    event_type,
    title,
    event_date,
    end_date,
    start_time,
    end_time,
    location,
    order_item_id,
    partner_id,
    contact_name,
    contact_phone,
    sort_order = 0,
    notes,
  } = body;

  if (!event_type || !title || !event_date) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        { error: "missing_fields", detail: "event_type, title, event_date are required" },
        { status: 400 }
      )
    );
  }

  const supabase = createServiceClient();

  const insertRow: Record<string, unknown> = {
    trip_id: params.tripId,
    event_type,
    title,
    event_date,
    end_date: end_date ?? null,
    start_time,
    end_time,
    location,
    order_item_id: order_item_id ?? null,
    contact_name,
    contact_phone,
    sort_order,
    notes,
  };

  if (!order_item_id && partner_id) {
    insertRow.partner_id = partner_id;
  }

  const { data: event, error } = await supabase
    .from("trip_events")
    .insert(insertRow)
    .select("*, partners ( id, name, line_user_id )")
    .single();

  if (error) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "create_failed", detail: error.message }, { status: 400 })
    );
  }

  // Best-effort push to the hotel's own LINE, scoped to only this
  // guest's check-in/out details (see hotel-line.ts header). Hotel
  // events only, and only when admin has linked the partner's LINE —
  // NOT awaited, same reasoning as driver-line.ts's call site.
  if (event.event_type === "hotel" && event.partners?.line_user_id) {
    void notifyPartnerHotelEvent({
      partnerLineUserId: event.partners.line_user_id,
      title: event.title,
      checkInDate: event.event_date,
      checkOutDate: event.end_date,
      guestName: event.contact_name,
      notes: event.notes,
      isUpdate: false,
    });
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ event }, { status: 201 }));
}
