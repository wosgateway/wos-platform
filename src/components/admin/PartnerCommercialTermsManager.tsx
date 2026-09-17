'use client';

// src/components/admin/PartnerCommercialTermsManager.tsx
//
// Admin editor for public.partner_commercial_terms (098 + 101) — the
// per-partner MOU commission rate (default 12%, MOU ข้อ 3) and pilot
// fee-waiver window (MOU ข้อ 5). Confidential per MOU ข้อ 7: this
// table has no anon/authenticated RLS policy at all, so this
// admin-only page + route is the only place these numbers are
// visible or editable.
//
// Since 101, a rate "edit" never overwrites the current row — it
// closes the current period and opens a new one (the route enforces
// this). This component reflects that: there is no inline rate input
// that saves in place anymore. Instead each partner shows their
// current active rate as a read-only line, a "ตั้งอัตราใหม่" action
// that opens a small form for starting the next period, and a
// "ประวัติ" action that lists every past period for that partner.

import { Fragment, useEffect, useState } from 'react';
import { Loader2, History as HistoryIcon } from 'lucide-react';

interface TermsRow {
  partner_id: string;
  partner_name: string;
  commercial_fee_rate: number;
  pilot_started_at: string | null;
  pilot_ends_at: string | null;
  notes: string | null;
  mou_reference: string | null;
  effective_from: string | null;
  updated_at: string | null;
  has_terms_row: boolean;
}

interface HistoryRow {
  id: string;
  commercial_fee_rate: number;
  effective_from: string;
  effective_until: string | null;
  mou_reference: string | null;
  notes: string | null;
  created_at: string;
}

interface NewPeriodDraft {
  rate: string;
  effective_from: string; // yyyy-mm-dd, empty = now
  mou_reference: string;
  pilot_started_at: string;
  pilot_ends_at: string;
  notes: string;
}

const EMPTY_DRAFT: NewPeriodDraft = {
  rate: '',
  effective_from: '',
  mou_reference: '',
  pilot_started_at: '',
  pilot_ends_at: '',
  notes: '',
};

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

export function PartnerCommercialTermsManager() {
  const [rows, setRows] = useState<TermsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [openFormId, setOpenFormId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, NewPeriodDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryRow[]>>({});
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/admin/partner-commercial-terms', { cache: 'no-store' });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.detail ?? result?.error ?? 'โหลดข้อมูลไม่สำเร็จ');
      setRows(result.terms ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updateDraft(partnerId: string, patch: Partial<NewPeriodDraft>) {
    setDrafts((prev) => ({ ...prev, [partnerId]: { ...(prev[partnerId] ?? EMPTY_DRAFT), ...patch } }));
  }

  function toggleForm(partnerId: string) {
    setOpenFormId((prev) => (prev === partnerId ? null : partnerId));
    setDrafts((prev) => (prev[partnerId] ? prev : { ...prev, [partnerId]: EMPTY_DRAFT }));
    setRowError((prev) => ({ ...prev, [partnerId]: '' }));
  }

  async function saveNewPeriod(partnerId: string) {
    const draft = drafts[partnerId] ?? EMPTY_DRAFT;
    const rate = Number(draft.rate);
    if (draft.rate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      setRowError((prev) => ({ ...prev, [partnerId]: 'อัตราคอมมิชชั่นต้องเป็นตัวเลข 0–100' }));
      return;
    }
    if (draft.pilot_started_at && draft.pilot_ends_at && draft.pilot_ends_at < draft.pilot_started_at) {
      setRowError((prev) => ({ ...prev, [partnerId]: 'วันสิ้นสุด pilot ต้องไม่ก่อนวันเริ่ม' }));
      return;
    }

    setSavingId(partnerId);
    setRowError((prev) => ({ ...prev, [partnerId]: '' }));
    try {
      const res = await fetch('/api/admin/partner-commercial-terms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: partnerId,
          commercial_fee_rate: rate,
          effective_from: draft.effective_from || undefined,
          mou_reference: draft.mou_reference || null,
          pilot_started_at: draft.pilot_started_at || null,
          pilot_ends_at: draft.pilot_ends_at || null,
          notes: draft.notes || null,
        }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.detail ?? result?.error ?? 'บันทึกไม่สำเร็จ');

      setRows((prev) =>
        prev.map((r) =>
          r.partner_id === partnerId
            ? {
                ...r,
                commercial_fee_rate: result.term.commercial_fee_rate,
                pilot_started_at: result.term.pilot_started_at,
                pilot_ends_at: result.term.pilot_ends_at,
                notes: result.term.notes,
                mou_reference: result.term.mou_reference,
                effective_from: result.term.effective_from,
                updated_at: result.term.updated_at,
                has_terms_row: true,
              }
            : r
        )
      );
      setDrafts((prev) => ({ ...prev, [partnerId]: EMPTY_DRAFT }));
      setOpenFormId(null);
      // If history is currently expanded for this partner, refresh it
      // so the just-closed period shows up immediately.
      if (openHistoryId === partnerId) {
        loadHistory(partnerId);
      }
    } catch (e) {
      setRowError((prev) => ({
        ...prev,
        [partnerId]: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ',
      }));
    } finally {
      setSavingId(null);
    }
  }

  async function loadHistory(partnerId: string) {
    setHistoryLoading(partnerId);
    setHistoryError((prev) => ({ ...prev, [partnerId]: '' }));
    try {
      const res = await fetch(`/api/admin/partner-commercial-terms?history=${partnerId}`, { cache: 'no-store' });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.detail ?? result?.error ?? 'โหลดประวัติไม่สำเร็จ');
      setHistory((prev) => ({ ...prev, [partnerId]: result.history ?? [] }));
    } catch (e) {
      setHistoryError((prev) => ({
        ...prev,
        [partnerId]: e instanceof Error ? e.message : 'โหลดประวัติไม่สำเร็จ',
      }));
    } finally {
      setHistoryLoading(null);
    }
  }

  function toggleHistory(partnerId: string) {
    const next = openHistoryId === partnerId ? null : partnerId;
    setOpenHistoryId(next);
    if (next && !history[partnerId]) {
      loadHistory(partnerId);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">อัตราคอมมิชชั่นพาร์ทเนอร์ (MOU)</h2>
        <p className="mt-1 text-xs text-slate-400">
          ข้อมูลนี้เป็นความลับตาม MOU ข้อ 7 — ไม่แสดงต่อสาธารณะหรือพาร์ทเนอร์รายอื่น พาร์ทเนอร์ที่ยังไม่เคยตั้งค่าจะใช้อัตรา
          MOU เริ่มต้น 12% โดยอัตโนมัติ (แสดงเป็น &quot;ยังไม่ตั้งค่า&quot;) จนกว่าจะบันทึกที่นี่ การแก้อัตราจะไม่เขียนทับของเดิม —
          ระบบจะปิดช่วงอัตราปัจจุบันแล้วเปิดช่วงใหม่ ประวัติอัตราเดิมดูได้จากปุ่ม &quot;ประวัติ&quot;
        </p>
      </div>

      {listError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{listError}</div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-400">กำลังโหลด...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">ยังไม่มีพาร์ทเนอร์ในระบบ</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2">พาร์ทเนอร์</th>
                <th className="px-4 py-2">อัตราปัจจุบัน (%)</th>
                <th className="px-4 py-2">มีผลตั้งแต่</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const draft = drafts[row.partner_id] ?? EMPTY_DRAFT;
                const formOpen = openFormId === row.partner_id;
                const historyOpen = openHistoryId === row.partner_id;
                return (
                  <Fragment key={row.partner_id}>
                    <tr className="border-t border-slate-100 align-top">
                      <td className="px-4 py-2 font-medium text-slate-800">{row.partner_name}</td>
                      <td className="px-4 py-2 text-slate-700">{row.commercial_fee_rate}%</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(row.effective_from)}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            row.has_terms_row
                              ? 'bg-primary-light text-primary-dark'
                              : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          {row.has_terms_row ? 'ตั้งค่าแล้ว' : 'ยังไม่ตั้งค่า (ใช้ 12%)'}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleForm(row.partner_id)}
                            className="btn-primary px-3 py-1.5 text-xs"
                          >
                            {formOpen ? 'ยกเลิก' : 'ตั้งอัตราใหม่'}
                          </button>
                          <button
                            onClick={() => toggleHistory(row.partner_id)}
                            className="flex items-center gap-1 text-xs font-medium text-slate-500"
                          >
                            <HistoryIcon className="h-3.5 w-3.5" />
                            {historyOpen ? 'ซ่อนประวัติ' : 'ประวัติ'}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {formOpen ? (
                      <tr className="border-t border-slate-50 bg-slate-50/60">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                            <div>
                              <label className="text-xs text-slate-500">อัตราใหม่ (%)</label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                className="form-input mt-1 w-full"
                                value={draft.rate}
                                onChange={(e) => updateDraft(row.partner_id, { rate: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">มีผลตั้งแต่ (ว่าง = ตอนนี้)</label>
                              <input
                                type="datetime-local"
                                className="form-input mt-1 w-full"
                                value={draft.effective_from}
                                onChange={(e) => updateDraft(row.partner_id, { effective_from: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">เลขที่ MOU / อ้างอิง</label>
                              <input
                                type="text"
                                className="form-input mt-1 w-full"
                                value={draft.mou_reference}
                                onChange={(e) => updateDraft(row.partner_id, { mou_reference: e.target.value })}
                                placeholder="เช่น MOU-2026-014"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">เริ่ม pilot</label>
                              <input
                                type="date"
                                className="form-input mt-1 w-full"
                                value={draft.pilot_started_at}
                                onChange={(e) => updateDraft(row.partner_id, { pilot_started_at: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">สิ้นสุด pilot</label>
                              <input
                                type="date"
                                className="form-input mt-1 w-full"
                                value={draft.pilot_ends_at}
                                onChange={(e) => updateDraft(row.partner_id, { pilot_ends_at: e.target.value })}
                              />
                            </div>
                            <div className="col-span-2 md:col-span-3">
                              <label className="text-xs text-slate-500">หมายเหตุ</label>
                              <textarea
                                className="form-input mt-1 w-full"
                                rows={2}
                                value={draft.notes}
                                onChange={(e) => updateDraft(row.partner_id, { notes: e.target.value })}
                                placeholder="เงื่อนไขพิเศษ ฯลฯ (เลขที่ MOU ใส่ในช่องด้านบนแทน)"
                              />
                            </div>
                          </div>

                          {rowError[row.partner_id] ? (
                            <p className="mt-2 text-xs text-rose-600">{rowError[row.partner_id]}</p>
                          ) : null}

                          <div className="mt-3 flex items-center gap-2">
                            <button
                              onClick={() => saveNewPeriod(row.partner_id)}
                              disabled={savingId === row.partner_id}
                              className="btn-primary px-4 py-1.5 text-xs"
                            >
                              {savingId === row.partner_id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                'เริ่มใช้อัตราใหม่'
                              )}
                            </button>
                            <span className="text-xs text-slate-400">
                              จะปิดอัตราปัจจุบัน ({row.commercial_fee_rate}%) ที่วันที่เลือกด้านบน แล้วเริ่มอัตราใหม่ทันที — ไม่กระทบ
                              commission ที่คำนวณไปแล้วก่อนหน้านี้
                            </span>
                          </div>
                        </td>
                      </tr>
                    ) : null}

                    {historyOpen ? (
                      <tr className="border-t border-slate-50 bg-slate-50/40">
                        <td colSpan={5} className="px-4 py-3">
                          {historyLoading === row.partner_id ? (
                            <p className="text-xs text-slate-400">กำลังโหลดประวัติ...</p>
                          ) : historyError[row.partner_id] ? (
                            <p className="text-xs text-rose-600">{historyError[row.partner_id]}</p>
                          ) : (history[row.partner_id] ?? []).length === 0 ? (
                            <p className="text-xs text-slate-400">ยังไม่มีประวัติอัตรา</p>
                          ) : (
                            <table className="w-full text-left text-xs">
                              <thead className="text-slate-400">
                                <tr>
                                  <th className="py-1 pr-3">อัตรา</th>
                                  <th className="py-1 pr-3">มีผลตั้งแต่</th>
                                  <th className="py-1 pr-3">สิ้นสุด</th>
                                  <th className="py-1 pr-3">เลขที่ MOU</th>
                                  <th className="py-1">บันทึกเมื่อ</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(history[row.partner_id] ?? []).map((h) => (
                                  <tr key={h.id} className="border-t border-slate-100">
                                    <td className="py-1 pr-3 font-medium text-slate-700">{h.commercial_fee_rate}%</td>
                                    <td className="py-1 pr-3 text-slate-500">{formatDateTime(h.effective_from)}</td>
                                    <td className="py-1 pr-3 text-slate-500">
                                      {h.effective_until ? formatDateTime(h.effective_until) : 'ปัจจุบัน'}
                                    </td>
                                    <td className="py-1 pr-3 text-slate-500">{h.mou_reference ?? '—'}</td>
                                    <td className="py-1 text-slate-400">{formatDateTime(h.created_at)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
