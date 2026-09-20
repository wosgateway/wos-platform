import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePartnerTripToken } from "@/lib/trips/resolve-partner-trip-token";
import { notifyEventConfirmed } from "@/lib/trips/reminders/engine";

// PATCH /api/partner-trip/[token]/events/[eventId]/status  body: { status }
//
// B2 — the Journey-partner counterpart to admin's
// /api/trips/[tripId]/events/[eventId]/route.ts PATCH, but scoped to
// a single trip_partner_links token instead of requireAdmin().
//
// NOTE ON AUTH MODEL: the Sprint 1 brief's B1/B2 spec assumed
// `requirePartnerAuth` (the organizations/branches/users login used
// by the order_items partner portal) would apply here. It doesn't —
// trip_events.partner_id points at `public.partners`, a different
// identity system from that portal, and the already-shipped B1 read
// path (GET /api/partner-trip/[token]) authenticates via a per-link
// access token (migration 088), not a logged-in session. This route
// follows that same, already-established pattern rather than bolting
// on a second, unrelated auth system. Confirm this is the intended
// model before wiring a "send link" flow for it.
//
// Scope is enforced by resolvePartnerTripToken() (exists -> revoked ->
// expired) PLUS the trip_id AND partner_id filter on every query below
// — never by trip_id alone. A partner can only move their own events,
// and only through the restricted subset of transitions the brief
// grants a partner (no cancel, no reopening a terminal state).
const PARTNER_ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed"],
  confirmed: ["in_progress"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: { token: string; eventId: string } }
) {
  const { link, error } = await resolvePartnerTripToken(params.token);

  if (error === "revoked") {
    return NextResponse.json({ error: "link_revoked" }, { status: 410 });
  }
  if (error === "expired") {
    return NextResponse.json({ error: "link_expired" }, { status: 410 });
  }
  if (error || !link) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const nextStatus = body?.status;
  if (!nextStatus || typeof nextStatus !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Scoped to this partner's own event on this trip — trip_id AND
  // partner_id both from the resolved link, never from the request.
  const { data: current, error: currentError } = await supabase
    .from("trip_events")
    .select("id, status")
    .eq("id", params.eventId)
    .eq("trip_id", link.tripId)
    .eq("partner_id", link.partnerId)
    .maybeSingle();

  if (currentError || !current) {
    // Same generic 404 whether the event doesn't exist, belongs to a
    // different trip, or belongs to a different partner — don't let
    // the response distinguish "not yours" from "doesn't exist".
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const allowed = PARTNER_ALLOWED_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    return NextResponse.json(
      { error: "invalid_transition", detail: `cannot move from ${current.status} to ${nextStatus}` },
      { status: 400 }
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("trip_events")
    .update({ status: nextStatus })
    .eq("id", params.eventId)
    .eq("trip_id", link.tripId)
    .eq("partner_id", link.partnerId)
    .select("id, status")
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: "update_failed" }, { status: 400 });
  }

  // My Journey Phase 2, R3 (brief §4): partner confirming an event is
  // exactly the pending -> confirmed transition this route already
  // enforces via PARTNER_ALLOWED_TRANSITIONS above — fire the customer
  // notification here rather than re-detecting it elsewhere. Best-effort,
  // never blocks or fails the status update itself (same fire-and-forget
  // contract as notifyPartnerHotelEvent() in the admin events route).
  if (nextStatus === "confirmed") {
    void notifyEventConfirmed(updated.id);
  }

  return NextResponse.json({ event: updated });
}
