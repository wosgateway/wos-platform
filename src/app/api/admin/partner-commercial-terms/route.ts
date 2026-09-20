import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { withCarriedCookies } from "@/lib/trips/with-carried-cookies";
import { logAdminAction } from "@/lib/admin/audit-log";

// Admin CRUD for public.partner_commercial_terms (098 + 101) — the
// per-partner MOU commission rate (default 12%, MOU ข้อ 3) that
// order_items.commission_amount is computed from.
//
// Since 101, this is a PERIOD table, not a 1-row-per-partner settings
// table: a partner can have many terms rows over time, each with a
// non-overlapping [effective_from, effective_until) window, and at
// most one row per partner has effective_until IS NULL (the currently
// active rate) — enforced in the DB by an EXCLUDE constraint, not
// just by this route's logic. This route never UPDATEs
// commercial_fee_rate on an existing row anymore (that would silently
// rewrite history — exactly what 101 exists to stop) — "changing the
// rate" always means: close the current active row and INSERT a new
// one. Existing rows are otherwise immutable from here.
//
// This table has no anon/authenticated write RLS policy at all (MOU
// ข้อ 7 confidentiality — see 098's header), so this route (service
// role) is the only write path.
//
//   - GET (no query)      -> current active rate per partner, one row
//                             each, with a synthetic 12.00/no-pilot
//                             row (has_terms_row: false) for partners
//                             with no terms row at all yet.
//   - GET ?history=<id>   -> full period history for one partner,
//                             newest first.
//   - PATCH                -> start a new rate period for a partner
//                             (closes the current active period at
//                             the new period's effective_from, then
//                             inserts the new row). Requires
//                             commercial_fee_rate; effective_from
//                             defaults to now().

const DEFAULT_RATE = 12.0;

// Shape of a public.partner_commercial_terms row (098 + 101's added
// period/provenance columns). createServiceClient() doesn't carry
// generated Database types, so `.rpc(...).single()` below can't infer
// this from the schema — without it TS falls back to `{}` on the RPC
// result and the build fails on `newRow.effective_from`. Kept here
// (not shared) since this is the only place that needs the RPC's
// return type spelled out.
interface PartnerCommercialTermsRow {
  id: string;
  partner_id: string;
  commercial_fee_rate: number;
  pilot_started_at: string | null;
  pilot_ends_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  effective_from: string;
  effective_until: string | null;
  created_by: string | null;
  mou_reference: string | null;
}

const TERM_COLUMNS =
  "id, partner_id, commercial_fee_rate, pilot_started_at, pilot_ends_at, notes, mou_reference, effective_from, effective_until, created_by, created_at, updated_at";

export async function GET(req: NextRequest) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const supabase = createServiceClient();
  const historyPartnerId = req.nextUrl.searchParams.get("history");

  // ---- History mode: full period list for one partner ----
  if (historyPartnerId) {
    const { data: history, error } = await supabase
      .from("partner_commercial_terms")
      .select(TERM_COLUMNS)
      .eq("partner_id", historyPartnerId)
      .order("effective_from", { ascending: false });

    if (error) {
      return withCarriedCookies(
        cookieCarrier,
        NextResponse.json({ error: "fetch_failed", detail: error.message }, { status: 500 })
      );
    }
    return withCarriedCookies(cookieCarrier, NextResponse.json({ history: history ?? [] }));
  }

  // ---- Default mode: current active rate per partner ----
  const [{ data: partners, error: partnersError }, { data: terms, error: termsError }] = await Promise.all([
    supabase.from("partners").select("id, name").order("name", { ascending: true }),
    // Every row whose window contains "now" (at most one per
    // partner_id, guaranteed by the 101 exclusion constraint) — plus
    // any still-open row (effective_until IS NULL) even if its
    // effective_from is in the future, so a scheduled future rate
    // change doesn't just disappear from the admin's view.
    supabase
      .from("partner_commercial_terms")
      .select(TERM_COLUMNS)
      .or(`effective_until.is.null,effective_until.gt.${new Date().toISOString()}`)
      .order("effective_from", { ascending: false }),
  ]);

  if (partnersError || termsError) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        { error: "fetch_failed", detail: (partnersError ?? termsError)?.message },
        { status: 500 }
      )
    );
  }

  // A partner can appear twice in `terms` right now if they have both
  // a currently-active row AND a scheduled-future row — take the
  // active one (effective_from <= now, effective_until null-or-future)
  // for the main list; the scheduled one still exists and is visible
  // via `?history=`.
  const now = Date.now();
  const activeByPartnerId = new Map<string, (typeof terms)[number]>();
  for (const t of terms ?? []) {
    const isActiveNow = new Date(t.effective_from).getTime() <= now;
    if (!isActiveNow) continue; // scheduled future row — not "active" yet
    const existing = activeByPartnerId.get(t.partner_id);
    if (!existing || new Date(t.effective_from) > new Date(existing.effective_from)) {
      activeByPartnerId.set(t.partner_id, t);
    }
  }

  const rows = (partners ?? []).map((p) => {
    const t = activeByPartnerId.get(p.id);
    return {
      partner_id: p.id,
      partner_name: p.name,
      commercial_fee_rate: t?.commercial_fee_rate ?? DEFAULT_RATE,
      pilot_started_at: t?.pilot_started_at ?? null,
      pilot_ends_at: t?.pilot_ends_at ?? null,
      notes: t?.notes ?? null,
      mou_reference: t?.mou_reference ?? null,
      effective_from: t?.effective_from ?? null,
      updated_at: t?.updated_at ?? null,
      has_terms_row: Boolean(t),
    };
  });

  return withCarriedCookies(cookieCarrier, NextResponse.json({ terms: rows }));
}

export async function PATCH(req: NextRequest) {
  const cookieCarrier = NextResponse.next();
  const admin = await requireAdmin(cookieCarrier);
  if (!admin.authorized) {
    return withCarriedCookies(cookieCarrier, NextResponse.json({ error: admin.message }, { status: admin.status }));
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.partner_id !== "string" || !body.partner_id.trim()) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "missing_fields", detail: "partner_id is required" }, { status: 400 })
    );
  }

  if (!("commercial_fee_rate" in body)) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        { error: "missing_fields", detail: "commercial_fee_rate is required to start a new rate period" },
        { status: 400 }
      )
    );
  }

  const rate = Number(body.commercial_fee_rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        { error: "invalid_rate", detail: "commercial_fee_rate must be between 0 and 100" },
        { status: 400 }
      )
    );
  }

  const effectiveFrom = body.effective_from ? new Date(body.effective_from) : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "invalid_effective_from" }, { status: 400 })
    );
  }

  const pilotStartedAt = "pilot_started_at" in body ? body.pilot_started_at || null : null;
  const pilotEndsAt = "pilot_ends_at" in body ? body.pilot_ends_at || null : null;
  if (pilotStartedAt && pilotEndsAt && pilotEndsAt < pilotStartedAt) {
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json({ error: "invalid_pilot_window" }, { status: 400 })
    );
  }

  const notes = "notes" in body && typeof body.notes === "string" ? body.notes : null;
  const mouReference = "mou_reference" in body && typeof body.mou_reference === "string" ? body.mou_reference : null;

  const supabase = createServiceClient();
  const partnerId = body.partner_id as string;

  // For the audit-log "before" snapshot only — the RPC below re-reads
  // the current-open row itself (under FOR UPDATE) and is what
  // actually enforces the close+insert atomically, so a stale read
  // here can't cause an incorrect write, only a slightly stale log.
  const { data: currentOpenForLog } = await supabase
    .from("partner_commercial_terms")
    .select("commercial_fee_rate, effective_from")
    .eq("partner_id", partnerId)
    .is("effective_until", null)
    .maybeSingle();

  // Close-current-period + insert-new-period happen inside a single
  // DB transaction (101_partner_commercial_terms_history.sql) instead
  // of two sequential REST calls, so a crash between them can't leave
  // the partner with zero active rows (which would silently fall back
  // to the 12.00 MOU default for any order created in that gap).
  const { data: newRow, error: rpcError } = await supabase
    .rpc("start_partner_commercial_term_period", {
      p_partner_id: partnerId,
      p_commercial_fee_rate: rate,
      p_effective_from: effectiveFrom.toISOString(),
      p_pilot_started_at: pilotStartedAt,
      p_pilot_ends_at: pilotEndsAt,
      p_notes: notes,
      p_mou_reference: mouReference,
      p_created_by: admin.user.id,
    })
    .single()
    .overrideTypes<PartnerCommercialTermsRow, { merge: false }>();

  if (rpcError || !newRow) {
    const isBackdatedError = rpcError?.message?.includes("effective_from_before_current_period");
    return withCarriedCookies(
      cookieCarrier,
      NextResponse.json(
        {
          error: isBackdatedError ? "effective_from_before_current_period" : "insert_failed",
          detail: isBackdatedError
            ? "วันเริ่มอัตราใหม่ต้องหลังวันที่อัตราปัจจุบันเริ่มใช้งาน — ไม่สามารถย้อนแก้ประวัติเดิมได้"
            : rpcError?.message ?? "unknown error",
        },
        { status: 400 }
      )
    );
  }

  await logAdminAction({
    actorUserId: admin.user.id,
    actorEmail: admin.user.email,
    action: "partner_commercial_terms.rate_change",
    entityType: "partner",
    entityId: partnerId,
    before: currentOpenForLog
      ? { commercial_fee_rate: currentOpenForLog.commercial_fee_rate, effective_from: currentOpenForLog.effective_from }
      : null,
    after: { commercial_fee_rate: rate, effective_from: newRow.effective_from, mou_reference: mouReference },
  });

  return withCarriedCookies(cookieCarrier, NextResponse.json({ term: { ...newRow, has_terms_row: true } }));
}
