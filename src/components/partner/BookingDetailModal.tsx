// src/components/partner/BookingDetailModal.tsx
//
// 2026-08: rewritten from `bookingId` + a direct client-side
// `.from('partner_bookings')` query (dead table, 0 rows since
// BookingForm.tsx moved to orders/order_items — see DashboardMetrics.tsx)
// to `orderId` + GET /api/partner/orders/[id] (src/lib/partner/orders.ts).
//
// An order can now hold items from more than one partner, so this
// renders the order header once (customer, attachment, order-level
// notes) and one card per order_item this partner owns, each with its
// own status + partner_notes editable independently via
// POST /api/partner/order-items/[id]/status and .../notes.
'use client';

import { useEffect, useState } from 'react';
import { formatTHB, formatThaiDate } from '@/lib/format';
import type { PartnerOrder, PartnerOrderItem } from '@/lib/partner/orders';

// order_items.status enum จริง (migration 008) — ไม่มี 'in_progress'
// เหมือน partner_bookings เดิม เพิ่ม 'checked_in' และ 'refunded' แทน
type ItemStatus = 'pending' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'refunded';

const STATUS_LABEL: Record<ItemStatus, string> = {
  pending: 'รอดำเนินการ',
  confirmed: 'ยืนยันแล้ว',
  checked_in: 'เช็คอินแล้ว',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
  refunded: 'คืนเงินแล้ว',
};

const STATUS_BADGE: Record<ItemStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  checked_in: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  refunded: 'bg-slate-100 text-slate-600',
};

// Must match ALLOWED_TRANSITIONS in
// /api/partner/order-items/[id]/status/route.ts exactly — same reasoning
// as BookingsList.tsx's copy of this map: the API route is the real
// enforcement point, this only keeps the <select> below from offering a
// transition that would come back as a 409.
const ALLOWED_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  pending: ['confirmed', 'cancelled', 'refunded'],
  confirmed: ['checked_in', 'cancelled', 'refunded'],
  checked_in: ['completed', 'cancelled', 'refunded'],
  completed: [],
  cancelled: [],
  refunded: [],
};

// Hotel room count / transport mode-days-pickup-dropoff detail line —
// same shape as the equivalent helpers in BookingsManager.tsx and the
// admin order-detail page, since src/lib/partner/orders.ts now
// selects these columns too.
function itemDetailLine(item: PartnerOrderItem): string | null {
  if (item.service_type === 'hotel') {
    const parts: string[] = [];
    if (item.scheduled_date || item.hotel_checkout_date) {
      parts.push(`เข้าพัก ${item.scheduled_date || '-'} ถึง ${item.hotel_checkout_date || '-'}`);
    }
    if ((item.room_quantity ?? 1) > 1) parts.push(`${item.room_quantity} ห้อง`);
    return parts.length ? parts.join(' · ') : null;
  }
  if (item.service_type === 'transport') {
    const mode = item.transport_mode || 'one_way';
    const parts: string[] = [];
    if (mode === 'daily') {
      parts.push(`เหมารายวัน · ${item.quantity || 1} วัน`);
    } else if (mode === 'round_trip') {
      parts.push(`ไป-กลับ · ส่งกลับ ${item.transport_return_date || '-'} ${item.transport_return_time || ''}`.trim());
    } else {
      parts.push('เที่ยวเดียว');
    }
    if (item.pickup_location) parts.push(`รับ: ${item.pickup_location}`);
    if (item.dropoff_location) parts.push(`ส่ง: ${item.dropoff_location}`);
    return parts.join(' · ');
  }
  return null;
}

const CONFIRM_METHODS = [
  { value: 'cash_at_clinic', label: 'เงินสดที่คลินิก' },
  { value: 'cash_at_hotel', label: 'เงินสดที่โรงแรม' },
  { value: 'bank_transfer', label: 'โอนเข้าบัญชี' },
  { value: 'other', label: 'อื่นๆ' },
] as const;
type ConfirmMethod = (typeof CONFIRM_METHODS)[number]['value'];

interface BookingDetailModalProps {
  orderId: string;
  onClose: () => void;
  onUpdate?: () => void;
}

export function BookingDetailModal({ orderId, onClose, onUpdate }: BookingDetailModalProps) {
  const [order, setOrder] = useState<PartnerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  // Phase 1 balance-confirm form state, keyed by order_item id — a
  // partner can only have one confirmation form open per item at a
  // time (same "one active edit per row" pattern as notesDraft).
  const [confirmOpenId, setConfirmOpenId] = useState<string | null>(null);
  const [confirmAmount, setConfirmAmount] = useState('');
  const [confirmMethod, setConfirmMethod] = useState<ConfirmMethod>('cash_at_clinic');
  const [confirmReference, setConfirmReference] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  async function loadOrder() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/partner/orders/${orderId}`);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || 'โหลดข้อมูลไม่สำเร็จ');
      }

      const loaded = json.order as PartnerOrder;
      setOrder(loaded);
      setNotesDraft(
        Object.fromEntries(loaded.items.map((item) => [item.id, item.partner_notes ?? '']))
      );
    } catch (err) {
      setError('โหลดข้อมูลไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function updateItemStatus(itemId: string, newStatus: ItemStatus) {
    setSavingItemId(itemId);

    try {
      const res = await fetch(`/api/partner/order-items/${itemId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || 'อัปเดตสถานะไม่สำเร็จ');
      }

      setOrder((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) =>
                item.id === itemId ? { ...item, status: newStatus } : item
              ),
            }
          : prev
      );
      if (onUpdate) onUpdate();
    } catch (err) {
      alert('อัปเดตสถานะไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingItemId(null);
    }
  }

  async function saveItemNotes(itemId: string) {
    setSavingItemId(itemId);
    const notes = notesDraft[itemId] ?? '';

    try {
      const res = await fetch(`/api/partner/order-items/${itemId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || 'บันทึกหมายเหตุไม่สำเร็จ');
      }

      setOrder((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) =>
                item.id === itemId ? { ...item, partner_notes: notes } : item
              ),
            }
          : prev
      );
      if (onUpdate) onUpdate();
    } catch (err) {
      alert('บันทึกหมายเหตุไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingItemId(null);
    }
  }

  function openConfirmForm(item: PartnerOrderItem) {
    const remaining = (item.partner_balance ?? 0) - item.partner_balance_confirmed;
    setConfirmOpenId(item.id);
    setConfirmAmount(remaining > 0 ? String(remaining) : '');
    setConfirmMethod('cash_at_clinic');
    setConfirmReference('');
    setConfirmError(null);
  }

  function closeConfirmForm() {
    setConfirmOpenId(null);
    setConfirmError(null);
  }

  // POST /api/partner/payments/confirm-balance (migration 104) — see
  // that route for the full validation contract (amount_exceeds_balance
  // returns remainingBeforeThis, which we surface as-is).
  async function submitConfirmBalance(itemId: string) {
    setConfirmError(null);
    const amount = Number(confirmAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setConfirmError('กรุณาระบุจำนวนเงินให้ถูกต้อง');
      return;
    }

    setConfirmSubmitting(true);
    try {
      const res = await fetch('/api/partner/payments/confirm-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderItemId: itemId,
          amount,
          paymentMethod: confirmMethod,
          reference: confirmReference.trim() || undefined,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.message || json?.error || 'ยืนยันการรับเงินไม่สำเร็จ');
      }

      setOrder((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) =>
                item.id === itemId
                  ? { ...item, partner_balance_confirmed: item.partner_balance_confirmed + amount }
                  : item
              ),
            }
          : prev
      );
      setConfirmOpenId(null);
      if (onUpdate) onUpdate();
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            รายละเอียดการจอง {order ? `· ${order.order_number}` : ''}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="ปิด">
            ✕
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : error || !order ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-600">
              {error || 'ไม่พบข้อมูล'}
            </div>
          ) : (
            <>
              {/* Customer + order-level info */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="font-medium text-slate-800">{order.customer?.full_name || '-'}</p>
                <p className="text-sm text-slate-500">
                  {order.customer?.phone || '-'}
                  {order.customer?.line_id && ` · LINE: ${order.customer.line_id}`}
                  {order.customer?.country && ` · ${order.customer.country}`}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  แจ้งเมื่อ {formatThaiDate(order.created_at)}
                </p>
                {order.notes && (
                  <p className="mt-2 text-sm text-slate-600">
                    <span className="font-medium">หมายเหตุ (ออเดอร์):</span> {order.notes}
                  </p>
                )}
                {order.attachment_url && (
                  <a
                    href={order.attachment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-sm text-primary-dark hover:underline"
                  >
                    📎 ดูไฟล์แนบ
                  </a>
                )}
              </div>

              {/* Per-item cards */}
              <div className="space-y-3">
                {order.items.map((item: PartnerOrderItem) => (
                  <div key={item.id} className="rounded-xl border border-slate-100 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-800">{item.packages?.title || item.service_type}</p>
                        <p className="text-xs text-slate-400">
                          {item.scheduled_date ? formatThaiDate(item.scheduled_date) : 'ยังไม่กำหนดวัน'}
                          {item.scheduled_time && ` · ${item.scheduled_time}`}
                        </p>
                        {itemDetailLine(item) ? (
                          <p className="mt-0.5 text-xs text-slate-400">{itemDetailLine(item)}</p>
                        ) : null}
                      </div>
                      <span className="text-sm font-semibold text-slate-800">{formatTHB(item.price)}</span>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs text-slate-400">สถานะ:</span>
                      <select
                        value={item.status}
                        onChange={(e) => updateItemStatus(item.id, e.target.value as ItemStatus)}
                        disabled={
                          savingItemId === item.id ||
                          ALLOWED_TRANSITIONS[item.status as ItemStatus]?.length === 0
                        }
                        className={`rounded-full px-2 py-1 text-xs font-medium border-0 ${
                          STATUS_BADGE[item.status as ItemStatus] || 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {(Object.keys(STATUS_LABEL) as ItemStatus[])
                          .filter(
                            (s) =>
                              s === item.status ||
                              ALLOWED_TRANSITIONS[item.status as ItemStatus]?.includes(s)
                          )
                          .map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                      </select>
                    </div>

                    {item.partner_balance !== null && (
                      <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                        <div className="flex justify-between text-slate-500">
                          <span>ราคาแพ็กเกจ</span>
                          <span>{formatTHB(item.price)}</span>
                        </div>
                        <div className="flex justify-between text-slate-500">
                          <span>ค่าธรรมเนียม WOS</span>
                          <span>{formatTHB(item.deposit_required)}</span>
                        </div>
                        <div className="mt-1.5 flex justify-between font-medium text-slate-700">
                          <span>ยอด Partner ต้องได้รับ</span>
                          <span>{formatTHB(item.partner_balance)}</span>
                        </div>
                        <div className="flex justify-between text-emerald-600">
                          <span>ยืนยันรับแล้ว</span>
                          <span>{formatTHB(item.partner_balance_confirmed)}</span>
                        </div>
                        <div className="flex justify-between font-medium text-amber-600">
                          <span>คงเหลือ</span>
                          <span>
                            {formatTHB((item.partner_balance ?? 0) - item.partner_balance_confirmed)}
                          </span>
                        </div>
                        {item.commission_amount !== null && (
                          <div className="mt-1.5 flex justify-between text-slate-400">
                            <span>
                              Commission
                              {item.commission_rate_snapshot !== null
                                ? ` (${item.commission_rate_snapshot}%)`
                                : ''}
                            </span>
                            <span>{formatTHB(item.commission_amount)}</span>
                          </div>
                        )}

                        {(item.partner_balance ?? 0) - item.partner_balance_confirmed > 0 &&
                          (confirmOpenId === item.id ? (
                            <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  type="number"
                                  min={0}
                                  value={confirmAmount}
                                  onChange={(e) => setConfirmAmount(e.target.value)}
                                  placeholder="จำนวนเงิน"
                                  className="form-input text-sm"
                                />
                                <select
                                  value={confirmMethod}
                                  onChange={(e) => setConfirmMethod(e.target.value as ConfirmMethod)}
                                  className="form-input text-sm"
                                >
                                  {CONFIRM_METHODS.map((m) => (
                                    <option key={m.value} value={m.value}>
                                      {m.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <input
                                type="text"
                                value={confirmReference}
                                onChange={(e) => setConfirmReference(e.target.value)}
                                placeholder="เลขอ้างอิง / หมายเหตุ (ถ้ามี)"
                                className="form-input text-sm"
                              />
                              {confirmError && <p className="text-red-600">{confirmError}</p>}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => submitConfirmBalance(item.id)}
                                  disabled={confirmSubmitting}
                                  className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  {confirmSubmitting ? 'กำลังบันทึก...' : 'ยืนยัน'}
                                </button>
                                <button
                                  onClick={closeConfirmForm}
                                  disabled={confirmSubmitting}
                                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100"
                                >
                                  ยกเลิก
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => openConfirmForm(item)}
                              className="mt-3 w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700 hover:bg-emerald-100"
                            >
                              ยืนยันว่าได้รับเงินแล้ว
                            </button>
                          ))}
                      </div>
                    )}

                    <div className="mt-3">
                      <label className="mb-1 block text-xs text-slate-400">หมายเหตุ (รายการนี้)</label>
                      <textarea
                        value={notesDraft[item.id] ?? ''}
                        onChange={(e) =>
                          setNotesDraft((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                        rows={2}
                        className="form-input text-sm"
                        placeholder="เพิ่มหมายเหตุสำหรับรายการนี้..."
                      />
                      <button
                        onClick={() => saveItemNotes(item.id)}
                        disabled={savingItemId === item.id}
                        className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {savingItemId === item.id ? 'กำลังบันทึก...' : 'บันทึกหมายเหตุ'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
