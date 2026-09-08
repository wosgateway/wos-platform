import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";

// GET /api/trips/[tripId]/order-items
//
// Trip Builder source list: the trip's primary customer's existing
// order_items (real paid/confirmed bookings from the orders engine),
// so an admin can compose a trip out of what the customer already
// bought instead of retyping everything by hand into the event form.
//
// Only items with partner_id set are eligible — trip_events_sync_partner
// (sql/076) raises an exception on insert if the linked order_item has no
// partner_id, so an unassigned item (needs_assignment=true, no partner_id
// yet) would just 500 the import. Those are filtered out here, not left
// for the import route to fail on one at a time.
//
// Items already linked to a trip_event (this trip or any other) are
// still returned, flagged via `linked_trip_event`, so the UI can show
// "already added" instead of just silently omitting them (an admin
// re-opening this sheet shouldn't wonder where a booking went).
export async function GET(req: NextRequest, { params }: { params: { tripId: string } }) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const supabase = createServiceClient();

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, customer_id")
    .eq("id", params.tripId)
    .single();

  if (tripError || !trip) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: "not_found" }, { status: 404 }));
  }

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, order_number")
    .eq("patient_id", trip.customer_id);

  if (ordersError) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "fetch_failed", detail: ordersError.message }, { status: 500 })
    );
  }

  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length === 0) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ items: [] }));
  }
  const orderNumberByOrderId = new Map((orders ?? []).map((o) => [o.id, o.order_number]));

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select(
      `
      id, order_id, partner_id, package_id, service_type, price, status,
      scheduled_date, scheduled_time, quantity, room_quantity,
      transport_mode, pickup_location, dropoff_location,
      packages ( id, title ),
      partners ( id, name )
      `
    )
    .in("order_id", orderIds)
    .not("status", "in", "(cancelled,refunded)")
    .not("partner_id", "is", null)
    .order("scheduled_date", { ascending: true, nullsFirst: false });

  if (itemsError) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "fetch_failed", detail: itemsError.message }, { status: 500 })
    );
  }

  const itemIds = (items ?? []).map((i) => i.id);

  const { data: linkedEvents, error: linkedError } =
    itemIds.length > 0
      ? await supabase
          .from("trip_events")
          .select("id, trip_id, order_item_id, trips ( trip_number )")
          .in("order_item_id", itemIds)
      : { data: [], error: null };

  if (linkedError) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "fetch_failed", detail: linkedError.message }, { status: 500 })
    );
  }

  const linkedByOrderItemId = new Map(
    (linkedEvents ?? []).map((ev) => [
      ev.order_item_id,
      { id: ev.id, trip_id: ev.trip_id, trip_number: (ev as unknown as { trips: { trip_number: string } | null }).trips?.trip_number ?? null },
    ])
  );

  const result = (items ?? []).map((item) => ({
    ...item,
    order_number: orderNumberByOrderId.get(item.order_id) ?? null,
    linked_trip_event: linkedByOrderItemId.get(item.id) ?? null,
  }));

  return withCarriedCookies(cookieCarrier, NextResponse.json({ items: result }));
}
