import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: "invalid_json" }, { status: 400 }));
  }

  const editable = ["name", "phone", "partner_id", "status", "line_user_id"];
  const patch: Record<string, unknown> = {};
  for (const key of editable) {
    if (key in body) patch[key] = body[key] === "" ? null : body[key];
  }

  if (Object.keys(patch).length === 0) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "no_editable_fields_provided" }, { status: 400 })
    );
  }

  const supabase = createServiceClient();

  const { data: driver, error } = await supabase
    .from("drivers")
    .update(patch)
    .eq("id", params.id)
    .select("*, partners ( id, name )")
    .single();

  if (error || !driver) {
    // line_user_id has a partial unique index (migration 085) — surface a
    // clear message instead of a raw Postgres constraint error when admin
    // tries to link a LINE account already linked to another driver.
    const dupeLineId = error?.code === "23505" && error.message.includes("line_user_id");
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        {
          error: dupeLineId ? "line_user_id_already_linked" : "update_failed",
          detail: dupeLineId
            ? "LINE ID นี้ถูกผูกกับคนขับคนอื่นอยู่แล้ว"
            : error?.message,
        },
        { status: dupeLineId ? 409 : 400 }
      )
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ driver }));
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const supabase = createServiceClient();

  const { error } = await supabase.from("drivers").delete().eq("id", params.id);

  if (error) {
    // drivers.id is referenced by transport_assignments.driver_id with no
    // ON DELETE clause (default RESTRICT) — a driver with any assignment
    // history can't be hard-deleted. Surface that plainly instead of a
    // raw Postgres FK error; caller should set status='inactive' instead.
    const inUse = error.code === "23503";
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        {
          error: inUse ? "driver_in_use" : "delete_failed",
          detail: inUse
            ? "คนขับคนนี้มีประวัติงานที่ผูกไว้แล้ว ลบไม่ได้ ให้เปลี่ยนสถานะเป็น 'ปิดใช้งาน' แทน"
            : error.message,
        },
        { status: inUse ? 409 : 500 }
      )
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ deleted: true }));
}
