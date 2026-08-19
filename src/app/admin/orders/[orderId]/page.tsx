'use client';

// src/app/admin/orders/[orderId]/page.tsx
//
// Fetches the dedicated GET /api/admin/orders/[id] endpoint, which
// returns the single order with freshly signed payment-slip URLs
// (see attachSignedSlipUrls / migration 033). The list endpoint
// (/api/admin/orders) intentionally omits slip_url, so it must not
// be used here — that was previously the cause of slip links being
// unopenable on this page.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatTHB } from '@/lib/format';

type OrderStatus =
  | 'draft'
  | 'pending_deposit'
  | 'deposit_paid'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'refunded';

type ServiceType = 'clinic' | 'hotel' | 'transport' | 'wellness' | 'insurance';

interface OrderItem {
  id: string;
  service_type: ServiceType;
  price: number | null;
  quantity: number | null;
  room_quantity: number | null;
  deposit_required: number | null;
  deposit_paid: number | null;
  balance_remaining: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  status: string;
  needs_assignment: boolean;
  hotel_checkout_date: string | null;
  transport_mode: string | null;
  transport_return_date: string | null;
  transport_return_time: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  package: { id: string; title: string; original_price: number | null; special_price: number | null } | null;
  partner: { id: string; name: string } | null;
}

// Extra detail line shown under the service-type badge in the items
// table — mirrors admin/BookingsManager.tsx's transportDetailLabel
// but also covers 'daily' (เหมา) mode, which that helper doesn't, and
// adds hotel room count / transport pickup-dropoff, none of which
// this page rendered at all before (see comment at top of file —
// hotel_checkout_date/transport_mode/transport_return_* were already
// in the type but never used in the table below).
function itemDetailLine(item: OrderItem): string | null {
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

interface Customer {
  id: string;
  full_name: string;
  phone: string;
  line_id: string | null;
  country: string | null;
}

interface Payment {
  id: string;
  order_id: string;
  amount: number | null;
  currency: string | null;
  method: string | null;
  status: string;
  slip_url: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
}

interface Order {
  id: string;
  order_number: string | null;
  status: OrderStatus;
  currency: string | null;
  notes: string | null;
  attachment_url: string | null;
  total_amount: number | null;
  total_deposit_required: number | null;
  total_deposit_paid: number | null;
  total_balance_remaining: number | null;
  cancelled_reason: string | null;
  created_at: string;
  customer: Customer | null;
  items: OrderItem[];
  payments: Payment[];
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: '📝 ฉบับร่าง',
  pending_deposit: '⏳ รอชำระมัดจำ',
  deposit_paid: '💰 ชำระมัดจำแล้ว',
  confirmed: '✅ ยืนยันแล้ว',
  checked_in: '🏥 เช็คอินแล้ว',
  completed: '🎉 เสร็จสิ้น',
  cancelled: '❌ ยกเลิก',
  refunded: '💸 คืนเงินแล้ว',
};

const STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  draft: 'bg-slate-100 text-slate-500',
  pending_deposit: 'bg-amber-100 text-amber-800',
  deposit_paid: 'bg-sky-100 text-sky-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  checked_in: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  refunded: 'bg-orange-100 text-orange-800',
};

const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  clinic: '🏥 คลินิก/โรงพยาบาล',
  wellness: '🧘 เวลเนส',
  insurance: '📄 ประกัน',
  hotel: '🏨 โรงแรม',
  transport: '🚗 รถรับส่ง',
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: '⏳ รอตรวจสอบ',
  waiting_verification: '⏳ รอตรวจสอบ',
  verified: '✅ ตรวจสอบแล้ว',
  rejected: '❌ ปฏิเสธแล้ว',
};

const PAYMENT_STATUS_BADGE_CLASS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  waiting_verification: 'bg-amber-100 text-amber-800',
  verified: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

function isClaimablePayment(status: string): boolean {
  return status === 'pending' || status === 'waiting_verification';
}

function itemLabel(item: OrderItem): string {
  const partnerName = item.partner?.name;
  const title = item.package?.title;
  return [partnerName, title].filter(Boolean).join(' — ') || 'ยังไม่ระบุ';
}

function itemPrice(item: OrderItem): number {
  if (item.price != null) return Number(item.price);
  if (item.package) return Number(item.package.special_price ?? item.package.original_price ?? 0);
  return 0;
}

export default function AdminOrderDetailPage() {
  const params = useParams();
  const orderId = params?.orderId as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingPaymentId, setProcessingPaymentId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`);
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'failed to load order');
      if (!result.order) throw new Error('ไม่พบคำสั่งจองนี้');
      setOrder(result.order as Order);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (orderId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function verifyPayment(paymentId: string) {
    if (!confirm('ยืนยันว่าตรวจสอบสลิปนี้แล้ว และเงินเข้าจริง?')) return;
    setProcessingPaymentId(paymentId);
    try {
      const res = await fetch(`/api/admin/payments/${paymentId}/verify`, { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'ยืนยันไม่สำเร็จ');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'ยืนยันไม่สำเร็จ');
    } finally {
      setProcessingPaymentId(null);
    }
  }

  async function rejectPayment(paymentId: string) {
    const reason = prompt('เหตุผลที่ปฏิเสธสลิปนี้ (จำเป็นต้องระบุ):');
    if (!reason || !reason.trim()) return;
    setProcessingPaymentId(paymentId);
    try {
      const res = await fetch(`/api/admin/payments/${paymentId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'ปฏิเสธไม่สำเร็จ');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'ปฏิเสธไม่สำเร็จ');
    } finally {
      setProcessingPaymentId(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-100" />
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Link href="/admin/orders" className="text-sm text-primary-dark hover:underline">
          ← กลับไปหน้ารายการจอง
        </Link>
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error || 'ไม่พบคำสั่งจองนี้'}
        </div>
      </div>
    );
  }

  const createdAt = order.created_at ? new Date(order.created_at).toLocaleString('th-TH') : '-';

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <Link href="/admin/orders" className="text-sm text-primary-dark hover:underline">
        ← กลับไปหน้ารายการจอง
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            {order.order_number || order.id.slice(0, 8)}
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">แจ้งเมื่อ {createdAt}</p>
        </div>
        <span className={`rounded-lg px-3 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS[order.status]}`}>
          {STATUS_LABEL[order.status]}
        </span>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-slate-700">ลูกค้า</h2>
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div><span className="text-slate-400">ชื่อ:</span> {order.customer?.full_name || '-'}</div>
          <div><span className="text-slate-400">โทร:</span> {order.customer?.phone || '-'}</div>
          <div><span className="text-slate-400">ประเทศ:</span> {order.customer?.country || '-'}</div>
          <div><span className="text-slate-400">LINE:</span> {order.customer?.line_id || '-'}</div>
        </div>
        {order.attachment_url ? (
          <a
            href={order.attachment_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-xs text-primary-dark hover:underline"
          >
            📎 ไฟล์แนบ
          </a>
        ) : null}
        {order.notes ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{order.notes}</p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 p-5 pb-3 text-sm font-bold text-slate-700">รายการในคำสั่งจอง</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr>
              <th className="px-5 py-2 font-medium">ประเภท</th>
              <th className="px-5 py-2 font-medium">รายละเอียด</th>
              <th className="px-5 py-2 font-medium">วันที่</th>
              <th className="px-5 py-2 text-right font-medium">ราคา</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-t border-slate-50">
                <td className="px-5 py-3">
                  {SERVICE_TYPE_LABEL[item.service_type]}
                  {item.needs_assignment ? (
                    <div className="text-xs text-amber-600">⚠️ ยังไม่ได้มอบหมายพาร์ทเนอร์</div>
                  ) : null}
                </td>
                <td className="px-5 py-3 text-slate-700">
                  {itemLabel(item)}
                  {itemDetailLine(item) ? (
                    <div className="text-xs font-normal text-slate-400">{itemDetailLine(item)}</div>
                  ) : null}
                </td>
                <td className="px-5 py-3 text-xs text-slate-500">
                  {item.scheduled_date || '-'} {item.scheduled_time || ''}
                </td>
                <td className="px-5 py-3 text-right font-medium text-slate-800">
                  {formatTHB(itemPrice(item))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-slate-700">สรุปยอดเงิน</h2>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">ยอดรวมทั้งหมด</span>
            <span className="font-semibold text-slate-900">{formatTHB(order.total_amount ?? 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">มัดจำที่ต้องชำระ</span>
            <span>{formatTHB(order.total_deposit_required ?? 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">มัดจำที่ชำระแล้ว</span>
            <span className="text-emerald-600">{formatTHB(order.total_deposit_paid ?? 0)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-1.5 font-semibold">
            <span className="text-slate-700">ยอดคงเหลือ</span>
            <span>{formatTHB(order.total_balance_remaining ?? 0)}</span>
          </div>
        </div>
        {order.cancelled_reason ? (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-600">
            เหตุผลยกเลิก: {order.cancelled_reason}
          </p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 p-5 pb-3 text-sm font-bold text-slate-700">การชำระเงิน</h2>
        {order.payments.length === 0 ? (
          <p className="p-5 text-sm text-slate-400">ยังไม่มีการส่งสลิปชำระเงิน</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {order.payments.map((payment) => {
              const submittedAt = payment.submitted_at
                ? new Date(payment.submitted_at).toLocaleString('th-TH')
                : '-';
              const busy = processingPaymentId === payment.id;
              return (
                <div key={payment.id} className="flex flex-wrap items-start justify-between gap-3 p-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">
                        {formatTHB(payment.amount ?? 0)}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          PAYMENT_STATUS_BADGE_CLASS[payment.status] || 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {PAYMENT_STATUS_LABEL[payment.status] || payment.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      ส่งเมื่อ {submittedAt}
                      {payment.method ? ` · ${payment.method}` : ''}
                    </p>
                    {payment.slip_url ? (
                      <a
                        href={payment.slip_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs text-primary-dark hover:underline"
                      >
                        📎 ดูสลิป
                      </a>
                    ) : null}
                    {payment.rejection_reason ? (
                      <p className="mt-1 text-xs text-red-600">เหตุผลปฏิเสธ: {payment.rejection_reason}</p>
                    ) : null}
                  </div>
                  {isClaimablePayment(payment.status) ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => verifyPayment(payment.id)}
                        disabled={busy}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        ✅ ยืนยันการชำระเงิน
                      </button>
                      <button
                        onClick={() => rejectPayment(payment.id)}
                        disabled={busy}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        ❌ ปฏิเสธ
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
