// src/app/api/trips/[tripId]/partner-links/route.ts
//
// Admin-only issue/reissue/revoke for partner-scoped trip links
// (088_trip_partner_links.sql). Same shape as /api/trips/[tripId]/token
// (the customer-facing link) — one action-based POST — except each
// link is additionally keyed by partner_id, since a trip can have many
// partner links (one per partner working that trip), not just one.
//
// GET  -> list every trip_partner_links row for this trip, joined with
//         the partner's name, so the admin UI can render a status pill
//         per partner without a second round-trip.
// POST -> { partnerId, action: 'reissue' | 'revoke', expiresInDays? }
//         'reissue' both creates the first link for a partner AND
//         rotates an existing one — same "reissue means issue-or-
//         rotate" convention already used by the customer token route
//         and by JourneyDetail.tsx's "สร้างลิงก์ / ออกลิงก์ใหม่" button,
//         so the UI doesn't need two separate actions.
//
// access_token is returned in plain text by both GET and POST here,
// deliberately matching how trips.access_token already works elsewhere
// in this codebase (GET /api/trips/[tripId] returns it on every fetch,
// not just once at issuance — see JourneyDetail.tsx's handleCopyLink).
// The column stores the token in plain text either way (088's comment
// about "shown once" describes the friction of the old SQL-editor
// INSERT ... RETURNING workflow this route replaces, not a hash-only
// storage design) — resolvePartnerTripToken() itself reads the plain
// access_token column back out for its constant-time comparison. So
// there is nothing gained by hiding it after the first response, and
// hiding it would just push admins back to the SQL editor.
//
// Never write the raw token into audit_log or console — only the
// link id, trip id, and partner id.

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { requireAdmin } from "@/lib/admin/require-admin";
import { logAdminAction } from "@/lib/admin/audit-log";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";

export async function GET(req: NextRequest, { params }: { params: { tripId: string } }) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("trip_partner_links")
    .select(
      "id, partner_id, access_token, token_revoked_at, token_expires_at, created_at, updated_at, partners ( id, name )"
    )
    .eq("trip_id", params.tripId)
    .order("created_at", { ascending: true });

  if (error) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "fetch_failed", detail: error.message }, { status: 500 })
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ links: data ?? [] }));
}

export async function POST(req: NextRequest, { params }: { params: { tripId: string } }) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const body = await req.json().catch(() => null);
  const action = body?.action;
  const partnerId = body?.partnerId;

  if (typeof partnerId !== "string" || !partnerId) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "invalid_partner_id", detail: "partnerId is required" }, { status: 400 })
    );
  }

  if (action !== "revoke" && action !== "reissue") {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "invalid_action", detail: "action must be 'revoke' or 'reissue'" }, { status: 400 })
    );
  }

  const supabase = createServiceClient();

  // Confirm the partner actually exists first, so a typo'd or stale
  // partnerId 400s with a clear message instead of an FK-violation
  // 500 (matching the "check before mutating" pattern in the
  // partner-impersonate route).
  const { data: partner, error: partnerErr } = await supabase
    .from("partners")
    .select("id, name")
    .eq("id", partnerId)
    .maybeSingle();

  if (partnerErr) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "partner_lookup_failed", detail: partnerErr.message }, { status: 500 })
    );
  }
  if (!partner) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "partner_not_found" }, { status: 404 })
    );
  }

  if (action === "revoke") {
    const { data: link, error } = await supabase
      .from("trip_partner_links")
      .update({ token_revoked_at: new Date().toISOString() })
      .eq("trip_id", params.tripId)
      .eq("partner_id", partnerId)
      .select("id, partner_id, token_revoked_at")
      .maybeSingle();

    if (error) {
      return withCarriedCookies(
        cookieCarrier,
        NextResponse.json({ error: "revoke_failed", detail: error.message }, { status: 500 })
      );
    }
    if (!link) {
      return withCarriedCookies(
        cookieCarrier,
        NextResponse.json({ error: "link_not_found", detail: "no link exists for this partner on this trip" }, { status: 404 })
      );
    }

    await logAdminAction({
      actorUserId: admin.user.id,
      actorEmail: admin.user.email,
      action: "trip_partner_link.revoke",
      entityType: "trip_partner_link",
      entityId: link.id,
      metadata: { tripId: params.tripId, partnerId, partnerName: partner.name },
    });

    return withCarriedCookies(cookieCarrier, NextResponse.json({ link }));
  }

  // action === "reissue" — issue-or-rotate via upsert on the
  // (trip_id, partner_id) unique constraint (088). Generating the
  // token in JS (not relying on the column's DB-side default) is the
  // same choice /api/trips/[tripId]/token/route.ts already makes for
  // trips.access_token, and it's required here regardless since a
  // column default only fires on INSERT, never on the UPDATE path an
  // upsert takes when a link for this (trip, partner) already exists.
  const expiresInDays = Number.isFinite(body?.expires_in_days) ? body.expires_in_days : 30;
  const newToken = crypto.randomBytes(24).toString("base64url");
  const newExpiry = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: link, error } = await supabase
    .from("trip_partner_links")
    .upsert(
      {
        trip_id: params.tripId,
        partner_id: partnerId,
        access_token: newToken,
        token_revoked_at: null,
        token_expires_at: newExpiry,
      },
      { onConflict: "trip_id,partner_id" }
    )
    .select("id, partner_id, access_token, token_expires_at")
    .single();

  if (error || !link) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "reissue_failed", detail: error?.message }, { status: 500 })
    );
  }

  await logAdminAction({
    actorUserId: admin.user.id,
    actorEmail: admin.user.email,
    action: "trip_partner_link.reissue",
    entityType: "trip_partner_link",
    entityId: link.id,
    metadata: { tripId: params.tripId, partnerId, partnerName: partner.name, expiresInDays },
  });

  return withCarriedCookies(cookieCarrier, NextResponse.json({ link }));
}
