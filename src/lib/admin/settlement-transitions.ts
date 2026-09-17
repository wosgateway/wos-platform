// src/lib/admin/settlement-transitions.ts
//
// approve_settlement / pay_settlement / lock_settlement (sql/107) are
// three RPCs with an identical shape: an atomic
// `UPDATE ... WHERE status = '<required-prior-status>'` claim, a
// `settlement_not_found` exception when the id simply doesn't exist,
// and a `settlement_not_<x>able` exception when it exists but is in
// the wrong status (double-click, stale tab, two admins racing —
// see 107's header). That means the three admin API routes that call
// them (approve/pay/lock) would otherwise be the same ~25 lines of
// error-mapping copy-pasted three times with only the RPC name and
// error string changed. Centralizing it here means a fix to the
// mapping only has to happen once, and the three route.ts files stay
// focused on the one thing that's actually different per-route: which
// RPC to call and what audit_log action to record.
//
// Auth (requireAdmin) deliberately stays OUT of this helper and in
// each route — same reasoning as every other admin route in this
// codebase: the cookie carrier / refreshed-session handling is
// request-scoped and belongs next to the NextResponse it's mutating,
// not buried in a shared lib.

import type { SupabaseClient } from '@supabase/supabase-js';

import { notifyPartnerSettlementStatus, type NotifiableSettlementStatus } from '@/lib/notify/settlement-line';

export type SettlementTransitionRpc = 'approve_settlement' | 'pay_settlement' | 'lock_settlement';

export type SettlementTransitionResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: 404 | 409 | 500; error: string };

const NOT_TRANSITIONABLE_MESSAGE: Record<SettlementTransitionRpc, string> = {
  approve_settlement: 'Settlement is not in CALCULATED status — it may already be approved, or another admin just acted on it.',
  pay_settlement: 'Settlement is not in APPROVED status — it may not be approved yet, or already marked paid.',
  lock_settlement: 'Settlement is not in PAID status — it may not be paid yet, or already locked.',
};

const NOT_TRANSITIONABLE_CODE: Record<SettlementTransitionRpc, string> = {
  approve_settlement: 'settlement_not_approvable',
  pay_settlement: 'settlement_not_payable',
  lock_settlement: 'settlement_not_lockable',
};

export async function runSettlementTransition(
  supabase: SupabaseClient,
  rpcName: SettlementTransitionRpc,
  settlementId: string,
  adminId: string
): Promise<SettlementTransitionResult> {
  const { data, error } = await supabase.rpc(rpcName, {
    p_settlement_id: settlementId,
    p_admin_id: adminId,
  });

  if (error) {
    const message = error.message ?? '';

    if (message.includes('settlement_not_found')) {
      return { ok: false, status: 404, error: 'Settlement not found' };
    }
    if (message.includes(NOT_TRANSITIONABLE_CODE[rpcName])) {
      // 409: the settlement exists, but its current status conflicts
      // with the transition being requested — the same "state
      // conflict" meaning 409 already carries elsewhere in this
      // codebase (payment_not_claimable, blocked_settlements, etc).
      return { ok: false, status: 409, error: NOT_TRANSITIONABLE_MESSAGE[rpcName] };
    }

    console.error(`${rpcName} RPC failed`, { settlementId, error });
    return { ok: false, status: 500, error: message || 'Settlement update failed' };
  }

  return { ok: true, data: data as Record<string, unknown> };
}

const NOTIFIABLE_STATUS: Record<SettlementTransitionRpc, NotifiableSettlementStatus> = {
  approve_settlement: 'APPROVED',
  pay_settlement: 'PAID',
  lock_settlement: 'LOCKED',
};

// Best-effort LINE push after a successful transition — Phase 6
// (Partner Portal / Notification). Deliberately NOT called for
// calculate_settlement: CALCULATED is an internal WOS bookkeeping
// step the partner doesn't need pinged about (Phase 6 scoping).
//
// Two extra reads beyond what runSettlementTransition() already knows
// (the RPC's jsonb result has partnerId/totalCommissionDue/itemCount
// but not period_start/period_end, and never the partner's
// line_user_id) — both cheap, both AFTER the transition already
// committed, and neither one is awaited by the caller: see
// settlement-line.ts's header for why a LINE outage must never delay
// or fail the transition response itself. Call this without `await`
// from each of approve/pay/lock's route.ts, same as every other
// notify/*-line.ts call site in this codebase.
export async function notifySettlementTransition(
  supabase: SupabaseClient,
  rpcName: SettlementTransitionRpc,
  settlementId: string,
  result: SettlementTransitionResult
): Promise<void> {
  if (!result.ok) return;

  const partnerId = result.data.partnerId as string | undefined;
  if (!partnerId) return;

  try {
    const [{ data: partner }, { data: settlement }] = await Promise.all([
      supabase.from('partners').select('line_user_id').eq('id', partnerId).maybeSingle(),
      supabase.from('settlements').select('period_start, period_end').eq('id', settlementId).maybeSingle(),
    ]);

    const lineUserId = (partner as { line_user_id: string | null } | null)?.line_user_id;
    if (!lineUserId) return; // not linked — silent skip, same as hotel-line.ts / driver-line.ts

    const periodRow = settlement as { period_start: string; period_end: string } | null;
    if (!periodRow) return;

    await notifyPartnerSettlementStatus({
      partnerLineUserId: lineUserId,
      status: NOTIFIABLE_STATUS[rpcName],
      totalCommissionDue: Number(result.data.totalCommissionDue ?? 0),
      itemCount: Number(result.data.itemCount ?? 0),
      periodStart: periodRow.period_start,
      periodEnd: periodRow.period_end,
    });
  } catch (err) {
    // Mirrors notifyPartnerSettlementStatus's own catch — this extra
    // layer only exists to guard the two lookup queries above it,
    // which notifyPartnerSettlementStatus itself can't see.
    console.error(`settlement LINE notify lookup failed for ${rpcName}:`, { settlementId, err });
  }
}
