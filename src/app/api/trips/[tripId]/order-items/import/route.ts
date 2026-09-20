import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";

// POST /api/trips/[tripId]/order-items/import
//
// Trip Builder: turn a batch of the customer's existing order_items into
// trip_events in one call, instead of the admin retyping each one through
// the manual "add event" form. Every field is derived from the order_item
// itself (service_type -> event_type, package title -> event title,
// scheduled_date/time -> event_date/start_time, pickup/dropoff or partner
// name -> location) — an admin can still edit any individual event
// afterwards through the normal edit sheet.
//
// Deliberately NOT a single DB transaction: each order_item is inserted as
// its own trip_events row via a plain loop, and one failure doesn't abort
// the rest — the response reports success/failure per item so a partial
// import is visible, not silently swallowed. Matches the existing
// "trip created, but participant insert failed" pattern in
// POST /api/trips (a warning surfaced to the caller, not a hard rollback).
const SERVICE_TYPE_TO_EVENT_TYPE: Record<string, string> = {
  clinic: "health",
  hotel: "hotel",
  transport: "transport",
  wellness: "wellness",
  insurance: "other",
};

const SERVICE_TYPE_LABEL_TH: Record<string, string> = {
  clinic: "นัดหมายคลินิก",
  hotel: "เข้าพักโรงแรม",
  transport: "การเดินทาง",
  wellness: "โปรแกรมเวลเนส",
  insurance: "ประกันภัย",
};

interface ImportOrderItemRow {
  id: string;
  order_id: string;
  partner_id: string | null;
  service_type: string;
  status: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  packages: { id: string; title: string } | null;
  partners: { id: string; name: string } | null;
}

export async function POST(req: NextRequest, { params }: { params: { tripId: string } }) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const body = await req.json().catch(() => null);
  const orderItemIds: unknown = body?.order_item_ids;

  if (!Array.isArray(orderItemIds) || orderItemIds.length === 0) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "missing_fields", detail: "order_item_ids (non-empty array) is required" }, { status: 400 })
    );
  }

  const supabase = createServiceClient();

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, start_date")
    .eq("id", params.tripId)
    .single();

  if (tripError || !trip) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: "not_found" }, { status: 404 }));
  }

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select(
      `
      id, order_id, partner_id, service_type, status, scheduled_date, scheduled_time,
      pickup_location, dropoff_location,
      packages ( id, title ),
      partners ( id, name )
      `
    )
    .in("id", orderItemIds as string[]);

  if (itemsError) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "fetch_failed", detail: itemsError.message }, { status: 500 })
    );
  }

  const itemById = new Map(((items ?? []) as unknown as ImportOrderItemRow[]).map((i) => [i.id, i]));

  // Skip anything already linked to a trip_event — importing twice would
  // just create a duplicate event, not update the existing one.
  const { data: alreadyLinked } = await supabase
    .from("trip_events")
    .select("order_item_id")
    .in("order_item_id", orderItemIds as string[]);
  const alreadyLinkedIds = new Set((alreadyLinked ?? []).map((e) => e.order_item_id));

  const results: { order_item_id: string; status: "created" | "skipped" | "failed"; detail?: string; event_id?: string }[] = [];

  for (const orderItemId of orderItemIds as string[]) {
    const item = itemById.get(orderItemId);

    if (!item) {
      results.push({ order_item_id: orderItemId, status: "failed", detail: "order_item not found" });
      continue;
    }
    if (alreadyLinkedIds.has(orderItemId)) {
      results.push({ order_item_id: orderItemId, status: "skipped", detail: "already linked to a trip event" });
      continue;
    }
    if (!item.partner_id) {
      results.push({ order_item_id: orderItemId, status: "failed", detail: "order_item has no partner assigned yet" });
      continue;
    }

    const eventType = SERVICE_TYPE_TO_EVENT_TYPE[item.service_type] ?? "other";
    const title = item.packages?.title ?? SERVICE_TYPE_LABEL_TH[item.service_type] ?? "รายการจากคำสั่งจอง";
    const eventDate = item.scheduled_date ?? trip.start_date;
    const location =
      item.service_type === "transport"
        ? item.pickup_location ?? item.dropoff_location ?? item.partners?.name ?? null
        : item.partners?.name ?? null;

    const { data: event, error: insertError } = await supabase
      .from("trip_events")
      .insert({
        trip_id: params.tripId,
        event_type: eventType,
        title,
        event_date: eventDate,
        start_time: item.scheduled_time,
        location,
        order_item_id: item.id,
      })
      .select("id")
      .single();

    if (insertError || !event) {
      // 23505 here means trip_events_order_item_id_unique (migration 078)
      // rejected the insert — another concurrent request linked this
      // order_item first. That's a successful link, not a failure, so
      // report it the same way the pre-check "already linked" path does.
      if (insertError?.code === "23505") {
        results.push({ order_item_id: orderItemId, status: "skipped", detail: "already linked to a trip event" });
        continue;
      }
      results.push({ order_item_id: orderItemId, status: "failed", detail: insertError?.message ?? "insert failed" });
      continue;
    }

    results.push({ order_item_id: orderItemId, status: "created", event_id: event.id });
  }

  const createdCount = results.filter((r) => r.status === "created").length;

  return withCarriedCookies(
    cookieCarrier,
    NextResponse.json({ results, created_count: createdCount }, { status: createdCount > 0 ? 201 : 400 })
  );
}
