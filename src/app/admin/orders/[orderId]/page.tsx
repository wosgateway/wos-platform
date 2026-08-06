'use client';

// src/app/admin/orders/[orderId]/page.tsx
//
// Reuses the existing GET /api/admin/orders list endpoint (same one
// BookingsManager already calls) and finds the matching order client-side.
// No new API route required. If a dedicated GET /api/admin/orders/[id]
// endpoint gets added later, swap the fetch below for that and drop the
// .find() — everything else stays the same.

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
  package: { id: string; title: string; original_price: number | null; special_price: number | null } | null;
  partner: { id: string; name: string } | null;
}

interface Customer {
  id: string;
  full_name: string;
  phone: string;
  line_id: string | null;
  country: string | null;
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

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/orders');
        const result = await res.json();
        if (!res.ok) throw new Error(result?.error ?? 'failed to load orders');
        const found = (result.orders as Order[]).find((o) => o.id === orderId);
        if (!found) throw new Error('ไม่พบคำสั่งจองนี้');
        setOrder(found);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown error');
      } finally {
        setLoading(false);
      }
    }
    if (orderId) load();
  }, [orderId]);

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
        <Link href="/admin/orders" className="text-sm text-primary hover:underline">
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
      <Link href="/admin/orders" className="text-sm text-primary hover:underline">
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
            className="mt-3 inline-block text-xs text-primary hover:underline"
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
                <td className="px-5 py-3 text-slate-700">{itemLabel(item)}</td>
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
    </div>
  );
}
