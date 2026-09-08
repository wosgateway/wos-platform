import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";

// Admin CRUD for public.transport_vehicle_pricing (migration 081) — the
// "starting from ฿X" hint shown next to the vehicleType picker on the
// Transport booking step (BookingForm.tsx / JourneyBookingForm.tsx),
// via fetchTransportVehiclePricing() in lib/data.ts (public/anon read).
// This route is the admin write path that table previously had none of
// — rows had to be edited directly in the Supabase table editor.
//
// No POST/DELETE: the row set is fixed to the 4 vehicleType values the
// booking UI actually offers (sedan/suv/vip_van/medical_transport,
// seeded by migration 081) — adding a 5th here without also adding it
// to the booking form's VehicleType union would just create an orphan
// row nothing reads, so vehicle_type is never admin-creatable through
// this route. PATCH only ever updates an existing row.

export async function GET() {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("transport_vehicle_pricing")
    .select("*")
    .order("vehicle_type", { ascending: true });

  if (error) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "fetch_failed", detail: error.message }, { status: 500 })
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ pricing: data }));
}

export async function PATCH(req: NextRequest) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.vehicle_type !== "string" || !body.vehicle_type.trim()) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "missing_fields", detail: "vehicle_type is required" }, { status: 400 })
    );
  }

  const patch: Record<string, unknown> = {};
  if ("starting_price" in body) {
    const price = Number(body.starting_price);
    if (!Number.isFinite(price) || price < 0) {
      return withCarriedCookies(
        cookieCarrier,
        NextResponse.json({ error: "invalid_price", detail: "starting_price must be a non-negative number" }, { status: 400 })
      );
    }
    patch.starting_price = price;
  }
  if ("is_active" in body) {
    patch.is_active = Boolean(body.is_active);
  }

  if (Object.keys(patch).length === 0) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "no_editable_fields_provided" }, { status: 400 })
    );
  }

  const supabase = createServiceClient();

  // UPDATE only, deliberately (see file header) — a vehicle_type that
  // doesn't already exist (i.e. not one of the 4 rows migration 081
  // seeded) is a client bug, not a new row to create.
  const { data: row, error } = await supabase
    .from("transport_vehicle_pricing")
    .update(patch)
    .eq("vehicle_type", body.vehicle_type)
    .select("*")
    .single();

  if (error || !row) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        { error: "update_failed", detail: error?.message ?? "vehicle_type not found" },
        { status: error ? 400 : 404 }
      )
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ pricing: row }));
}
