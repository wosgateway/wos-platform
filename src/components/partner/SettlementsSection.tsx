'use client';

// src/components/partner/SettlementsSection.tsx
//
// Partner Portal — Phase 6 (Partner Portal / Notification) of the
// Settlement Engine build. Read-only counterpart to
// src/components/admin/SettlementsManager.tsx: same status labels,
// same table/expand-for-line-items shape, but:
//
//   - Scoped to the logged-in partner automatically (the API route
//     resolves partnerId from the session — no partner picker, no
//     partnerId param this component could even send).
//   - No action buttons. approve/pay/lock are admin-only (sql/107's
//     header) — a partner can see their settlement status change, not
//     cause it.
//   - No partner-name column (it's always this partner).
//
// Fetches via /api/partner/settlements + /api/partner/settlements/:id
// (fetch(), not a direct supabase client query) — those tables have
// RLS enabled with zero client policies (105's header: "Settlement
// financial data is service-role/admin controlled"), so unlike
// BillingDashboard.tsx's organizations query, a session-bound
// supabase client here would always return nothing.

import { Fragment, useEffect, useState } from 'react';
import { formatTHB, formatThaiDate } from '@/lib/format';

type SettlementStatus = 'CALCULATED' | 'APPROVED' | 'PAID' | 'LOCKED';

interface SettlementRow {
  id: string;
  partner_id: string;
  period_start: string;
  period_end: string;
  total_commission_due: number;
  item_count: number;
  status: SettlementStatus;
  approved_at: string | null;
  paid_at: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
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
    orderNumber: string | null;
    packageTitle: string | null;
  } | null;
}

interface SettlementDetail {
  settlement: SettlementRow;
  items: SettlementItemDetail[];
}

const STATUS_LABELS: Record<SettlementStatus, string> = {
  CALCULATED: 'คำนวณแล้ว',
  APPROVED: 'ยืนยันยอดแล้ว',
  PAID: 'ชำระแล้ว',
  LOCKED: 'ปิดงวดแล้ว',
};

const STATUS_BADGE_CLASS: Record<SettlementStatus, string> = {
  CALCULATED: 'bg-slate-100 text-slate-600',
  APPROVED: 'bg-amber-100 text-amber-800',
  PAID: 'bg-emerald-100 text-emerald-700',
  LOCKED: 'bg-indigo-100 text-indigo-700',
};

export function SettlementsSection() {
  const [rows, setRows] = useState<SettlementRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [statusFilter, setStatusFilter] = useState<SettlementStatus | ''>('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, SettlementDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<Record<string, string>>({});

  async function load(targetPage: number, overrideStatus?: SettlementStatus | '') {
    const status = overrideStatus ?? statusFilter;
    setLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (status) params.set('status', status);

      const res = await fetch(`/api/partner/settlements?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setListError(data.error ?? 'โหลด settlement ไม่สำเร็จ');
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

  function handleFilterChange(status: SettlementStatus | '') {
    setStatusFilter(status);
    load(0, status);
  }

  async function fetchDetail(id: string) {
    setDetailLoadingId(id);
    setDetailError((prev) => ({ ...prev, [id]: '' }));
    try {
      const res = await fetch(`/api/partner/settlements/${id}`);
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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Settlement {total > 0 && <span className="font-normal text-slate-400">({total} รายการ)</span>}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            ยอดคอมมิชชั่นที่ต้องชำระให้ WOS ต่องวด — สรุปตามสถานะปัจจุบัน ตัวเลขทั้งหมดยืนยันโดยทีม WOS แล้ว
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">สถานะ</label>
          <select
            value={statusFilter}
            onChange={(e) => handleFilterChange(e.target.value as SettlementStatus | '')}
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
      </div>

      {listError && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{listError}</div>}

      {loading && !rows ? (
        <div className="py-8 text-center text-sm text-slate-400">🔄 กำลังโหลด...</div>
      ) : rows && rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">ยังไม่มี settlement</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">ช่วงเวลา</th>
                <th className="px-4 py-2 text-right">รายการ</th>
                <th className="px-4 py-2 text-right">ยอดคอมมิชชั่น</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2">อัปเดตล่าสุด</th>
                <th className="px-4 py-2 text-right">รายละเอียด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows?.map((row) => {
                const detail = detailCache[row.id];
                const isExpanded = expandedId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr>
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
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => toggleDetail(row.id)} className="text-xs text-primary-dark hover:underline">
                          {isExpanded ? 'ซ่อน' : 'ดูรายการ'}
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="bg-slate-50 px-4 py-3">
                          {detailLoadingId === row.id ? (
                            <p className="text-xs text-slate-400">กำลังโหลดรายละเอียด...</p>
                          ) : detailError[row.id] ? (
                            <p className="text-xs text-rose-600">{detailError[row.id]}</p>
                          ) : !detail ? null : (
                            <div className="space-y-2">
                              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500 md:grid-cols-4">
                                <div>สร้างเมื่อ: {formatThaiDate(detail.settlement.created_at)}</div>
                                <div>ยืนยันยอดเมื่อ: {formatThaiDate(detail.settlement.approved_at)}</div>
                                <div>ชำระเมื่อ: {formatThaiDate(detail.settlement.paid_at)}</div>
                                <div>ปิดงวดเมื่อ: {formatThaiDate(detail.settlement.locked_at)}</div>
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
                                      <th className="py-1 text-right">ยอดคอมมิชชั่น</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.items.map((item) => (
                                      <tr key={item.id} className="border-t border-slate-100">
                                        <td className="py-1 pr-3">
                                          {item.orderItem?.orderNumber ?? '—'}
                                        </td>
                                        <td className="py-1 pr-3 text-slate-600">
                                          {item.orderItem?.packageTitle ?? item.orderItem?.serviceType ?? '—'}
                                        </td>
                                        <td className="py-1 pr-3 text-slate-500">
                                          {formatThaiDate(item.orderItem?.completedAt)}
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
