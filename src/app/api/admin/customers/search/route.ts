import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";

// GET /api/admin/customers/search?q=... — used by the Journey Control
// Center's "create trip" customer picker. `customers` has zero RLS
// policies (service-role only, see sql/011_create_customers_table.sql),
// so this can't be queried directly from the browser client the way
// `partners` is elsewhere in admin — needs its own server route.
export async function GET(req: NextRequest) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ customers: [] }));
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, phone, email")
    .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`)
    .order("full_name", { ascending: true })
    .limit(20);

  if (error) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "search_failed", detail: error.message }, { status: 500 })
    );
  }

  return withCarriedCookies(cookieCarrier, NextResponse.json({ customers: data ?? [] }));
}
