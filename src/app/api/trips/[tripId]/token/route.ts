import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";
import crypto from "crypto";

export async function POST(req: NextRequest, { params }: { params: { tripId: string } }) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action !== "revoke" && action !== "reissue") {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "invalid_action", detail: "action must be 'revoke' or 'reissue'" }, { status: 400 })
    );
  }

  const supabase = createServiceClient();

  if (action === "revoke") {
    const { data: trip, error } = await supabase
      .from("trips")
      .update({ token_revoked_at: new Date().toISOString() })
      .eq("id", params.tripId)
      .select("id, token_revoked_at")
      .single();

    if (error || !trip) {
      return withCarriedCookies(
        cookieCarrier,
        NextResponse.json({ error: "revoke_failed", detail: error?.message }, { status: 500 })
      );
    }

    return withCarriedCookies(cookieCarrier, NextResponse.json({ trip }));
  }

  const expiresInDays = Number.isFinite(body?.expires_in_days) ? body.expires_in_days : 30;
  const newToken = crypto.randomBytes(24).toString("base64url");
  const newExpiry = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: trip, error } = await supabase
    .from("trips")
    .update({
      access_token: newToken,
      token_revoked_at: null,
      token_expires_at: newExpiry,
    })
    .eq("id", params.tripId)
    .select("id, access_token, token_expires_at")
    .single();

  if (error || !trip) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "reissue_failed", detail: error?.message }, { status: 500 })
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ trip }));
}
