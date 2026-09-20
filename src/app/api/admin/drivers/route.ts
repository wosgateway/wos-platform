import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";

export async function GET() {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("drivers")
    .select("*, partners ( id, name )")
    .order("name", { ascending: true });

  if (error) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "fetch_failed", detail: error.message }, { status: 500 })
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ drivers: data }));
}

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

  const { name, phone, partner_id, status, line_user_id } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "missing_fields", detail: "name is required" }, { status: 400 })
    );
  }

  const supabase = createServiceClient();

  const { data: driver, error } = await supabase
    .from("drivers")
    .insert({
      name: name.trim(),
      phone: phone || null,
      // null = WOS shared pool driver (see migration 076 comment on drivers.partner_id)
      partner_id: partner_id || null,
      status: status === "inactive" ? "inactive" : "active",
      // manual link for now; may later be auto-filled by phone-match (see migration 085)
      line_user_id: line_user_id || null,
    })
    .select("*, partners ( id, name )")
    .single();

  if (error) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "create_failed", detail: error.message }, { status: 400 })
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ driver }, { status: 201 }));
}
