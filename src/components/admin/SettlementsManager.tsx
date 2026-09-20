'use client';

// src/components/admin/SettlementsManager.tsx
//
// "Settlement" tab — the admin UI for the Settlement Engine
// (105 = schema, 107 = RPCs, Phase 2 = calculate/approve/pay/lock
// routes, Phase 3 = this component's list/detail data source). Pure
// consumer of those routes: every number shown here (total_commission_due,
// item_count, commission_amount per line) is whatever the RPCs froze —
// this component never computes or edits a commission figure itself.
//
// State machine mirrors 107 exactly:
//   CALCULATED --approve--> APPROVED --pay--> PAID --lock--> LOCKED (terminal)
// Each row shows exactly one next-action button, for its current
// status, calling the matching Phase 2 route. No row ever shows more
// than one action — that IS the state machine; a "back" action doesn't
// exist (there's no unapprove/unpay/unlock route to call).
//
// Pagination/filter list shape and table styling follow
// AuditLogManager.tsx (page/pageSize/total, status filter via
// <select>). The partner picker for "calculate new" reuses the same
// direct-Supabase-read pattern PartnersManager.tsx uses for its own
// partner list (`supabase.from('partners').select(...)`, RLS-gated by
// the admin session) rather than adding another API route just to
// list partner id/name pairs.

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatTHB, formatThaiDate } from '@/lib/format';

type SettlementStatus = 'CALCULATED' | 'APPROVED' | 'PAID' | 'LOCKED';

interface PartnerOption {
  id: string;
  name: string;
}

interface SettlementRow {
  id: string;
  partner_id: string;
  period_start: string;
  period_end: string;
  total_commission_due: number;
  item_count: number;
  status: SettlementStatus;
  created_by: string | null;
  approved_by: string | null;
  paid_by: string | null;
  locked_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  partner: { id: string; name: string } | null;
}

interface SettlementItemDetail {
  id: string;
  settlement_id: string;
  order_item_id: string;
  partner_balance: number;
  commission_amount: number;
  created_at: string;
  orderItem: {
    id: string;
    serviceType: string;
    completedAt: string | null;
    orderId: string;
    orderNumber: string | null;
    packageTitle: string | null;
  } | null;
}

interface SettlementDetail {
  settlement: SettlementRow;
  items: SettlementItemDetail[];
}

interface CalculateDraft {
  partnerId: string;
  periodStart: string;
  periodEnd: string;
}

const EMPTY_DRAFT: CalculateDraft = { partnerId: '', periodStart: '', periodEnd: '' };

const STATUS_LABELS: Record<SettlementStatus, string> = {
  CALCULATED: 'คำนวณแล้ว',
  APPROVED: 'อนุมัติแล้ว',
  PAID: 'จ่ายแล้ว',
  LOCKED: 'ล็อกแล้ว',
};

const STATUS_BADGE_CLASS: Record<SettlementStatus, string> = {
  CALCULATED: 'bg-slate-100 text-slate-600',
  APPROVED: 'bg-amber-100 text-amber-800',
  PAID: 'bg-emerald-100 text-emerald-700',
  LOCKED: 'bg-indigo-100 text-indigo-700',
};

// Each status has exactly one forward transition — see file header.
// action: the Phase 2 route segment to POST to. confirmMessage: shown
// via window.confirm before firing, same lightweight-confirm
// convention PartnersManager.tsx uses for suspend/reactivate (a full
// custom modal is reserved for hard-delete, which is a genuinely
// irreversible multi-table cascade — these are single-row status
// flips with their own audit trail).
const NEXT_ACTION: Record<
  SettlementStatus,
  { action: 'approve' | 'pay' | 'lock'; buttonLabel: string; confirmMessage: string } | null
> = {
  CALCULATED: {
    action: 'approve',
    buttonLabel: 'อนุมัติ',
    confirmMessage: 'อนุมัติ settlement นี้?',
  },
  APPROVED: {
    action: 'pay',
    buttonLabel: 'บันทึกว่าจ่ายแล้ว',
    confirmMessage: 'ยืนยันว่าจ่ายเงินให้พาร์ทเนอร์รายนี้แล้ว?',
  },
  PAID: {
    action: 'lock',
    buttonLabel: 'ล็อก',
    confirmMessage: 'ล็อก settlement นี้? หลังล็อกแล้วจะแก้ไขหรือย้อนกลับไม่ได้อีก',
  },
  LOCKED: null,
};

export function SettlementsManager() {
  const supabase = useMemo(() => createClient('admin'), []);

  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [partnersError, setPartnersError] = useState<string | null>(null);

  const [rows, setRows] = useState<SettlementRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [statusFilter, setStatusFilter] = useState<SettlementStatus | ''>('');
  const [partnerFilter, setPartnerFilter] = useState('');

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, SettlementDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<Record<string, string>>({});

  const [calculateOpen, setCalculateOpen] = useState(false);
  const [draft, setDraft] = useState<CalculateDraft>(EMPTY_DRAFT);
  const [calculating, setCalculating] = useState(false);
  const [calculateError, setCalculateError] = useState<string | null>(null);
  const [calculateSuccess, setCalculateSuccess] = useState<string | null>(null);

  // Partner list for both the filter <select> and the "calculate new"
  // form's partner picker. Loaded once — settlements only ever concern
  // partners that already exist, and the admin session's RLS already
  // scopes this to what PartnersManager.tsx shows on its own tab.
  useEffect(() => {
    supabase
      .from('partners')
      .select('id, name')
      .order('name')
      .then(({ data, error }) => {
        if (error) {
          setPartnersError('โหลดรายชื่อพาร์ทเนอร์ไม่สำเร็จ: ' + error.message);
          return;
        }
        setPartners(data ?? []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Accepts explicit filter overrides (rather than always reading
  // statusFilter/partnerFilter state) so handleClearFilters can reload
  // with the CLEARED values immediately — calling setState and then
  // load() in the same handler would otherwise still close over the
  // pre-clear state, since state updates aren't visible until the
  // next render.
  async function load(targetPage: number, overrides?: { status?: SettlementStatus | ''; partnerId?: string }) {
    const status = overrides?.status ?? statusFilter;
    const partnerId = overrides?.partnerId ?? partnerFilter;
    setLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (status) params.set('status', status);
      if (partnerId) params.set('partnerId', partnerId);

      const res = await fetch(`/api/admin/settlements?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setListError(data.error ?? 'โหลด settlements ไม่สำเร็จ');
        setRows([]);
        return;
      }
      setRows(data.rows);
      setTotal(data.total);
      setPage(data.page);
      setPageSize(data.pageSize);
    } catch (e) {
      setListError('เชื่อมต่อ API ไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault();
    load(0);
  }

  function handleClearFilters() {
    setStatusFilter('');
    setPartnerFilter('');
    load(0, { status: '', partnerId: '' });
  }

  async function fetchDetail(id: string) {
    setDetailLoadingId(id);
    setDetailError((prev) => ({ ...prev, [id]: '' }));
    try {
      const res = await fetch(`/api/admin/settlements/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'โหลดรายละเอียดไม่สำเร็จ');
      setDetailCache((prev) => ({ ...prev, [id]: data as SettlementDetail }));
    } catch (e) {
      setDetailError((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : 'โหลดรายละเอียดไม่สำเร็จ',
      }));
    } finally {
      setDetailLoadingId(null);
    }
  }

  function toggleDetail(id: string) {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (next && !detailCache[id]) {
      fetchDetail(id);
    }
  }

  async function runTransition(row: SettlementRow) {
    const next = NEXT_ACTION[row.status];
    if (!next) return;
    if (!confirm(next.confirmMessage)) return;

    setActionLoadingId(row.id);
    setActionError((prev) => ({ ...prev, [row.id]: '' }));
    try {
      const res = await fetch(`/api/admin/settlements/${row.id}/${next.action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'ทำรายการไม่สำเร็จ');
      // Refresh both the row (status/approved_by/etc changed) and, if
      // it's expanded, the cached detail — the settlement_items don't
      // change on a transition, but approved_at/paid_at/locked_at on
      // the header do, and a stale detail would show the OLD status
      // right next to the just-updated row.
      await load(page);
      // The header fields (status/approved_at/paid_at/locked_at) just
      // changed — if this row's detail is open, refetch it in place
      // rather than collapsing it, so the admin keeps seeing the line
      // items they were looking at with the now-current header.
      if (expandedId === row.id) await fetchDetail(row.id);
    } catch (e) {
      setActionError((prev) => ({
        ...prev,
        [row.id]: e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ',
      }));
    } finally {
      setActionLoadingId(null);
    }
  }

  async function submitCalculate(e: React.FormEvent) {
    e.preventDefault();
    setCalculateError(null);
    setCalculateSuccess(null);

    if (!draft.partnerId) {
      setCalculateError('กรุณาเลือกพาร์ทเนอร์');
      return;
    }
    if (!draft.periodStart || !draft.periodEnd) {
      setCalculateError('กรุณาเลือกช่วงวันที่ให้ครบ');
      return;
    }
    if (draft.periodEnd < draft.periodStart) {
      setCalculateError('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
      return;
    }

    setCalculating(true);
    try {
      const res = await fetch('/api/admin/settlements/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerId: draft.partnerId,
          periodStart: draft.periodStart,
          periodEnd: draft.periodEnd,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'คำนวณ settlement ไม่สำเร็จ');

      const partnerName = partners.find((p) => p.id === draft.partnerId)?.name ?? draft.partnerId;
      setCalculateSuccess(
        `คำนวณสำเร็จ — ${partnerName}: ${data.itemCount} รายการ รวม ${formatTHB(data.totalCommissionDue)}`
      );
      setDraft(EMPTY_DRAFT);
      setCalculateOpen(false);
      load(0);
    } catch (e) {
      setCalculateError(e instanceof Error ? e.message : 'คำนวณ settlement ไม่สำเร็จ');
    } finally {
      setCalculating(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Settlement {total > 0 && <span className="font-normal text-slate-400">({total} รายการ)</span>}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            ยอดคอมมิชชั่นที่พาร์ทเนอร์ต้องจ่ายให้ WOS ต่อ order_item ที่ status = completed — คำนวณจาก
            commission_amount ที่ frozen ไว้แล้ว ไม่คำนวณใหม่จากที่นี่
          </p>
        </div>
        <button
          onClick={() => {
            setCalculateOpen((v) => !v);
            setCalculateError(null);
          }}
          className="btn-primary text-sm"
        >
          {calculateOpen ? 'ยกเลิก' : '+ คำนวณ Settlement ใหม่'}
        </button>
      </div>

      {calculateSuccess && (
        <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{calculateSuccess}</div>
      )}

      {calculateOpen && (
        <form onSubmit={submitCalculate} className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
          {partnersError && <p className="text-xs text-rose-600">{partnersError}</p>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">พาร์ทเนอร์</label>
              <select
                value={draft.partnerId}
                onChange={(e) => setDraft((d) => ({ ...d, partnerId: e.target.value }))}
                className="form-input w-full text-sm"
              >
                <option value="">— เลือกพาร์ทเนอร์ —</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ช่วงเริ่ม (period_start)</label>
              <input
                type="date"
                value={draft.periodStart}
                onChange={(e) => setDraft((d) => ({ ...d, periodStart: e.target.value }))}
                className="form-input w-full text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ช่วงสิ้นสุด (period_end)</label>
              <input
                type="date"
                value={draft.periodEnd}
                onChange={(e) => setDraft((d) => ({ ...d, periodEnd: e.target.value }))}
                className="form-input w-full text-sm"
              />
            </div>
          </div>

          {calculateError && <p className="text-xs text-rose-600">{calculateError}</p>}

          <div className="flex items-center gap-2">
            <button type="submit" disabled={calculating} className="btn-primary px-4 py-1.5 text-xs">
              {calculating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'คำนวณ'}
            </button>
            <span className="text-xs text-slate-400">
              จะดึง order_items ที่ completed, commission_amount &gt; 0, completed_at อยู่ในช่วงนี้ และยังไม่เคยอยู่ใน
              settlement ไหน — ถ้าไม่มีรายการที่เข้าเงื่อนไขเลย จะไม่สร้าง settlement เปล่าทิ้งไว้
            </span>
          </div>
        </form>
      )}

      <form
        onSubmit={handleFilterSubmit}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">สถานะ</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as SettlementStatus | '')}
            className="form-input text-sm"
          >
            <option value="">ทั้งหมด</option>
            {(Object.keys(STATUS_LABELS) as SettlementStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">พาร์ทเนอร์</label>
          <select value={partnerFilter} onChange={(e) => setPartnerFilter(e.target.value)} className="form-input text-sm">
            <option value="">ทั้งหมด</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary text-sm">
            กรอง
          </button>
          <button type="button" onClick={handleClearFilters} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
            ล้างตัวกรอง
          </button>
        </div>
      </form>

      {listError && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{listError}</div>}

      {loading && !rows ? (
        <div className="py-8 text-center text-sm text-slate-400">🔄 กำลังโหลด...</div>
      ) : rows && rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">ไม่พบ settlement ที่ตรงกับตัวกรอง</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">พาร์ทเนอร์</th>
                <th className="px-4 py-2">ช่วงเวลา</th>
                <th className="px-4 py-2 text-right">รายการ</th>
                <th className="px-4 py-2 text-right">ยอดคอมมิชชั่น</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2">อัปเดตล่าสุด</th>
                <th className="px-4 py-2 text-right">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows?.map((row) => {
                const next = NEXT_ACTION[row.status];
                const detail = detailCache[row.id];
                const isExpanded = expandedId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr>
                      <td className="px-4 py-2 font-medium text-slate-800">{row.partner?.name ?? row.partner_id}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                        {formatThaiDate(row.period_start)} – {formatThaiDate(row.period_end)}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600">{row.item_count}</td>
                      <td className="px-4 py-2 text-right font-medium text-slate-800">
                        {formatTHB(row.total_commission_due)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                          {STATUS_LABELS[row.status]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-400">
                        {formatThaiDate(row.updated_at)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => toggleDetail(row.id)} className="text-xs text-primary-dark hover:underline">
                            {isExpanded ? 'ซ่อน' : 'ดูรายการ'}
                          </button>
                          {next && (
                            <button
                              onClick={() => runTransition(row)}
                              disabled={actionLoadingId === row.id}
                              className="btn-primary px-3 py-1 text-xs"
                            >
                              {actionLoadingId === row.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                next.buttonLabel
                              )}
                            </button>
                          )}
                        </div>
                        {actionError[row.id] && (
                          <p className="mt-1 text-right text-xs text-rose-600">{actionError[row.id]}</p>
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="bg-slate-50 px-4 py-3">
                          {detailLoadingId === row.id ? (
                            <p className="text-xs text-slate-400">กำลังโหลดรายละเอียด...</p>
                          ) : detailError[row.id] ? (
                            <p className="text-xs text-rose-600">{detailError[row.id]}</p>
                          ) : !detail ? null : (
                            <div className="space-y-2">
                              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500 md:grid-cols-4">
                                <div>สร้างเมื่อ: {formatThaiDate(detail.settlement.created_at)}</div>
                                <div>อนุมัติเมื่อ: {formatThaiDate(detail.settlement.approved_at)}</div>
                                <div>จ่ายเมื่อ: {formatThaiDate(detail.settlement.paid_at)}</div>
                                <div>ล็อกเมื่อ: {formatThaiDate(detail.settlement.locked_at)}</div>
                              </div>
                              {detail.items.length === 0 ? (
                                <p className="text-xs text-slate-400">ไม่มีรายการ</p>
                              ) : (
                                <table className="w-full text-left text-xs">
                                  <thead className="text-slate-400">
                                    <tr>
                                      <th className="py-1 pr-3">Order</th>
                                      <th className="py-1 pr-3">แพ็กเกจ / บริการ</th>
                                      <th className="py-1 pr-3">Completed</th>
                                      <th className="py-1 pr-3 text-right">Partner balance</th>
                                      <th className="py-1 text-right">ยอดคอมมิชชั่น</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.items.map((item) => (
                                      <tr key={item.id} className="border-t border-slate-100">
                                        <td className="py-1 pr-3">
                                          {item.orderItem?.orderId ? (
                                            <Link
                                              href={`/admin/orders/${item.orderItem.orderId}`}
                                              className="text-primary-dark hover:underline"
                                            >
                                              {item.orderItem.orderNumber ?? item.orderItem.orderId.slice(0, 8) + '…'}
                                            </Link>
                                          ) : (
                                            '—'
                                          )}
                                        </td>
                                        <td className="py-1 pr-3 text-slate-600">
                                          {item.orderItem?.packageTitle ?? item.orderItem?.serviceType ?? '—'}
                                        </td>
                                        <td className="py-1 pr-3 text-slate-500">
                                          {formatThaiDate(item.orderItem?.completedAt)}
                                        </td>
                                        <td className="py-1 pr-3 text-right text-slate-500">
                                          {formatTHB(item.partner_balance)}
                                        </td>
                                        <td className="py-1 text-right font-medium text-slate-800">
                                          {formatTHB(item.commission_amount)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            หน้า {page + 1} / {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => load(page - 1)}
              disabled={page <= 0 || loading}
              className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40"
            >
              ก่อนหน้า
            </button>
            <button
              onClick={() => load(page + 1)}
              disabled={page + 1 >= totalPages || loading}
              className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40"
            >
              ถัดไป
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
