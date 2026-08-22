'use client';

// src/app/[locale]/my-trip/[orderNumber]/page.tsx
//
// P0-3 "Booking Confirmation" + the start of P1-5 "My Trip" from the
// roadmap — one page that adapts to order.status instead of two
// separate pages, since the real schema has a single order_number
// (not a separate quote-number vs booking-number pair). Customer
// reaches this either:
//   - right after confirming a quote on /[locale]/quote/[orderNumber]
//   - by revisiting the same secure link later (WhatsApp/LINE)
//
// Reuses GET /api/quote/[orderNumber] (already public + safe-fields
// only) for order/items, and GET /api/quote/[orderNumber]/payments
// for payment-slip history.

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';

type OrderStatus =
  | 'draft'
  | 'pending_deposit'
  | 'pending_verification'
  | 'deposit_paid'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'refunded';

interface QuoteItem {
  id: string;
  service_type: string;
  price: number | null;
  quantity: number | null;
  room_quantity: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  hotel_checkout_date: string | null;
  transport_mode: string | null;
  transport_return_date: string | null;
  transport_return_time: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  package: { title: string } | null;
  partner: { name: string } | null;
}

// Extra detail lines under an item's title — room count for hotel,
// mode/days/pickup-dropoff for transport. Mirrors the logic already
// used correctly in admin/BookingsManager.tsx's transportDetailLabel,
// extended here to also cover 'daily' (เหมา) mode, which that helper
// never handled either.
function tripItemDetailLines(item: QuoteItem): string[] {
  const lines: string[] = [];

  if (item.service_type === 'hotel') {
    if (item.scheduled_date || item.hotel_checkout_date) {
      lines.push(`เข้าพัก ${item.scheduled_date || '-'} ถึง ${item.hotel_checkout_date || '-'}`);
    }
    if ((item.room_quantity ?? 1) > 1) {
      lines.push(`${item.room_quantity} ห้อง`);
    }
  }

  if (item.service_type === 'transport') {
    const mode = item.transport_mode || 'one_way';
    const pickupTime = `${item.scheduled_date || '-'} ${item.scheduled_time || ''}`.trim();
    if (mode === 'daily') {
      lines.push(`เหมารายวัน · ${item.quantity || 1} วัน · เริ่ม ${pickupTime}`);
    } else if (mode === 'round_trip') {
      const ret = `${item.transport_return_date || '-'} ${item.transport_return_time || ''}`.trim();
      lines.push(`ไป-กลับ · รับ ${pickupTime} · ส่งกลับ ${ret}`);
    } else {
      lines.push(`เที่ยวเดียว · รับ ${pickupTime}`);
    }
    if (item.pickup_location) lines.push(`รับที่: ${item.pickup_location}`);
    if (item.dropoff_location) lines.push(`ส่งที่: ${item.dropoff_location}`);
  }

  return lines;
}

interface OrderData {
  order_number: string;
  status: OrderStatus;
  currency: string | null;
  total_amount: number | null;
  total_deposit_required: number | null;
  total_deposit_paid: number | null;
  total_balance_remaining: number | null;
  customer_name: string | null;
  items: QuoteItem[];
}

interface PaymentRow {
  id: string;
  amount: number;
  currency: string;
  method: string | null;
  status: string;
  submitted_at: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  slip_url: string | null;
}

const STATUS_META: Record<OrderStatus, { label: string; color: string; desc: string }> = {
  draft: { label: 'ร่างใบเสนอราคา', color: 'bg-slate-100 text-slate-600', desc: 'ยังไม่ได้ยืนยันรายการ' },
  pending_deposit: {
    label: '⏳ รอชำระมัดจำ',
    color: 'bg-amber-100 text-amber-800',
    desc: 'ยืนยันรายการแล้ว กรุณาชำระมัดจำเพื่อยืนยันการจอง',
  },
  pending_verification: {
    label: '🔍 รอตรวจสอบการชำระเงิน',
    color: 'bg-blue-100 text-blue-800',
    desc: 'ทีมงานได้รับสลิปแล้ว กำลังตรวจสอบ (ปกติภายใน 24 ชม.)',
  },
  deposit_paid: {
    label: '✅ ชำระมัดจำแล้ว',
    color: 'bg-emerald-100 text-emerald-800',
    desc: 'ทีมงานตรวจสอบและยืนยันการชำระมัดจำแล้ว',
  },
  confirmed: {
    label: '✅ ยืนยันการจองแล้ว',
    color: 'bg-emerald-100 text-emerald-800',
    desc: 'การจองของคุณได้รับการยืนยันแล้ว',
  },
  checked_in: { label: '🏨 เช็คอินแล้ว', color: 'bg-emerald-100 text-emerald-800', desc: 'อยู่ระหว่างการเดินทาง' },
  completed: { label: '🎉 เสร็จสิ้นการเดินทาง', color: 'bg-green-100 text-green-800', desc: 'ขอบคุณที่ใช้บริการ WOS' },
  cancelled: { label: '❌ ยกเลิกแล้ว', color: 'bg-red-100 text-red-800', desc: 'รายการนี้ถูกยกเลิก' },
  refunded: { label: '↩️ คืนเงินแล้ว', color: 'bg-slate-100 text-slate-600', desc: 'ดำเนินการคืนเงินเรียบร้อย' },
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  waiting_verification: '🔍 รอตรวจสอบ',
  pending: '🔍 รอตรวจสอบ',
  verified: '✅ ยืนยันแล้ว',
  rejected: '❌ ถูกปฏิเสธ',
};

// Statuses where paying is definitely not applicable — kept in sync
// with `blockedStatuses` in POST /api/quote/[orderNumber]/payments.
// 'confirmed' is intentionally NOT in this list: it only means the
// deposit requirement was met, not that the full total is paid, so a
// customer with balance_remaining > 0 should still be able to pay it
// off after confirmation.
// 'pending_verification' IS in this list (unlike the backend's
// blockedStatuses) purely for UX: a whole-order payment is already
// waiting_verification, and payments_one_pending_whole_order_idx
// (migration 021) will reject a second one with a 409 — better to
// hide the button than let the customer hit that error.
const NON_PAYABLE_STATUSES = ['draft', 'pending_verification', 'cancelled', 'refunded', 'completed'];

function formatMoney(amount: number | null, currency: string | null) {
  const value = (amount ?? 0).toLocaleString('th-TH');
  return `${value} ${currency || 'THB'}`;
}

export default function MyTripPage() {
  const params = useParams();
  const orderNumber = params?.orderNumber as string;
  // Required by /api/quote/[orderNumber]/payments as of migration 021
  // — order_number alone isn't a secret (predictable sequence), so a
  // token from the secure link is required too. NOTE: /api/quote/
  // [orderNumber] (the plain order-details route, not /payments)
  // still has no equivalent check — same fix should be applied there
  // too since it isn't part of this payment-flow patch.
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';

  const [order, setOrder] = useState<OrderData | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [quoteRes, paymentsRes] = await Promise.all([
        fetch(`/api/quote/${orderNumber}?token=${encodeURIComponent(token)}`),
        fetch(`/api/quote/${orderNumber}/payments?token=${encodeURIComponent(token)}`),
      ]);
      const quoteResult = await quoteRes.json();
      if (!quoteRes.ok) throw new Error(quoteResult?.error ?? 'โหลดข้อมูลไม่สำเร็จ');
      setOrder(quoteResult.order);

      if (paymentsRes.ok) {
        const paymentsResult = await paymentsRes.json();
        setPayments(paymentsResult.payments ?? []);
        setPaymentsError(null);
      } else {
        // Previously silent: payments stayed [] with no indication anything
        // went wrong, which looked identical to "no payments submitted yet"
        // (see admin/orders/[orderId]/page.tsx for the pattern this now
        // matches — always tell the customer apart from a real empty state).
        const paymentsResult = await paymentsRes.json().catch(() => null);
        setPaymentsError(paymentsResult?.error ?? 'โหลดประวัติการชำระเงินไม่สำเร็จ');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }, [orderNumber, token]);

  useEffect(() => {
    if (orderNumber) load();
  }, [orderNumber, load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-100" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      </div>
    );
  }

  if (!order) return null;

  if (order.status === 'draft') {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6 text-center">
        <p className="text-sm text-slate-500">รายการนี้ยังไม่ได้ยืนยัน กรุณายืนยันใบเสนอราคาก่อน</p>
        <Link
          href={`/quote/${orderNumber}`}
          className="inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white"
        >
          ไปที่ใบเสนอราคา
        </Link>
      </div>
    );
  }

  const meta = STATUS_META[order.status];
  const balanceRemaining = order.total_balance_remaining ?? Math.max(
    (order.total_deposit_required ?? 0) - (order.total_deposit_paid ?? 0),
    0
  );
  // A submitted-but-unverified slip doesn't always flip order.status
  // (that only happens automatically from 'pending_deposit' — see
  // POST /api/quote/[orderNumber]/payments). If the order was already
  // 'confirmed'/'deposit_paid' when the customer paid off the
  // remaining balance, status stays put until admin verifies, so
  // balanceRemaining is still > 0 too. Without this check the "ชำระเงิน"
  // button kept showing even though a slip was already waiting for
  // review — confusing customers into thinking they hadn't paid.
  const hasPendingPayment = payments.some(
    (p) => p.status === 'waiting_verification' || p.status === 'pending'
  );
  const canPay = !NON_PAYABLE_STATUSES.includes(order.status) && !hasPendingPayment && balanceRemaining > 0;

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <p className="text-xs text-slate-400">การจองของคุณ</p>
        <h1 className="mt-0.5 text-lg font-bold text-slate-900">
          {order.order_number}
          {order.customer_name ? ` · คุณ${order.customer_name}` : ''}
        </h1>
        <span className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${meta.color}`}>
          {meta.label}
        </span>
        <p className="mt-2 text-sm text-slate-500">{meta.desc}</p>
      </div>

      {/* Trip items */}
      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 p-5 pb-3 text-sm font-bold text-slate-700">รายการเดินทาง</h2>
        <div className="divide-y divide-slate-50">
          {order.items.map((item) => {
            const detailLines = tripItemDetailLines(item);
            return (
              <div key={item.id} className="p-5">
                <div className="font-medium text-slate-800">
                  {[item.partner?.name, item.package?.title].filter(Boolean).join(' — ') || item.service_type}
                </div>
                {detailLines.length > 0 ? (
                  detailLines.map((line, i) => (
                    <div key={i} className="text-xs text-slate-500">
                      {line}
                    </div>
                  ))
                ) : item.scheduled_date ? (
                  <div className="text-xs text-slate-500">
                    {item.scheduled_date} {item.scheduled_time || ''}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Payment summary */}
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">ยอดรวมทั้งหมด</span>
          <span className="font-semibold text-slate-900">{formatMoney(order.total_amount, order.currency)}</span>
        </div>
        <div className="mt-1.5 flex justify-between text-sm">
          <span className="text-slate-500">มัดจำที่ชำระแล้ว</span>
          <span className="font-semibold text-emerald-600">
            {formatMoney(order.total_deposit_paid, order.currency)}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between text-sm">
          <span className="text-slate-500">ยอดคงเหลือ</span>
          <span className="font-semibold text-primary-dark">{formatMoney(balanceRemaining, order.currency)}</span>
        </div>
      </div>

      {canPay ? (
        <Link
          href={`/my-trip/${orderNumber}/payment?token=${encodeURIComponent(token)}`}
          className="block w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-white"
        >
          💳 ชำระเงิน
        </Link>
      ) : hasPendingPayment ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-center text-sm text-blue-700">
          🔍 ทีมงานกำลังตรวจสอบสลิปที่คุณส่งไว้ กรุณารอ (ปกติภายใน 24 ชม.)
        </div>
      ) : null}

      {/* Payment history */}
      {paymentsError ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 p-5 text-sm text-red-600">
          {paymentsError} — <button onClick={() => load()} className="underline">ลองอีกครั้ง</button>
        </div>
      ) : payments.length > 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 p-5 pb-3 text-sm font-bold text-slate-700">ประวัติการชำระเงิน</h2>
          <div className="divide-y divide-slate-50">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-5">
                <div>
                  <div className="font-medium text-slate-800">{formatMoney(p.amount, p.currency)}</div>
                  {p.rejection_reason ? (
                    <div className="mt-0.5 text-xs text-red-500">เหตุผล: {p.rejection_reason}</div>
                  ) : null}
                  {p.slip_url ? (
                    <a
                      href={p.slip_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-block text-xs font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700"
                    >
                      ดูสลิป
                    </a>
                  ) : null}
                </div>
                <span className="text-xs font-medium text-slate-600">
                  {PAYMENT_STATUS_LABEL[p.status] || p.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-center text-xs text-slate-400">
        มีคำถาม? ติดต่อ LINE @vlf9996z · WhatsApp wa.me/message/BVJXBWDYR2UHN1
      </p>
    </div>
  );
}
