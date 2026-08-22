// src/components/partner/RecentBookings.tsx
// เอาไว้แค่โชว์ 8 รายการล่าสุดบน dashboard ไม่มี filter/search/export และไม่มี realtime update
// ทำเป็น server component (ไม่ใช้ 'use client') ให้สอดคล้องกับ DashboardMetrics.tsx
//
// 2026-08: เปลี่ยนจาก partner_bookings (organizationId) มาเป็น
// order_items ผ่าน getPartnerOrders() (partnerId) — เหตุผลเดียวกับที่
// DashboardMetrics.tsx เปลี่ยนไปแล้ว (partner_bookings มี 0 แถวถาวร
// ตั้งแต่ BookingForm.tsx สาธารณะเปลี่ยนไปยิง orders/order_items)
// getPartnerOrders() คืนค่า 1 แถวต่อ 1 order_item อยู่แล้ว เรียกตรงจาก
// server component นี้ได้เลยโดยไม่ต้องผ่าน HTTP (เหมือน DashboardMetrics)
//
// 2026-08 (design pass): เปลี่ยน emoji empty-state icon เป็น lucide,
// logic ไม่แตะเลย

import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { getPartnerOrders } from '@/lib/partner/orders';
import { formatTHB, formatThaiDate } from '@/lib/format';

// order_items.status enum จริง (migration 008) — ไม่มี 'in_progress'
// เหมือน partner_bookings เดิม เพิ่ม 'checked_in' และ 'refunded' แทน
type BookingStatus = 'pending' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'refunded';

const STATUS_BADGE: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  checked_in: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  refunded: 'bg-slate-100 text-slate-600',
};

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'รอดำเนินการ',
  confirmed: 'ยืนยันแล้ว',
  checked_in: 'เช็คอินแล้ว',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
  refunded: 'คืนเงินแล้ว',
};

const RECENT_LIMIT = 8;

export async function RecentBookings({ partnerId }: { partnerId: string | null }) {
  // เหมือน DashboardMetrics.tsx: user ยังไม่ผูก branch_id -> แสดง
  // widget ว่างแทนการ error ทั้งหน้า
  const orders = partnerId ? await getPartnerOrders(partnerId) : [];
  const bookings = orders.slice(0, RECENT_LIMIT);

  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h2 className="font-semibold text-slate-900">การจองล่าสุด</h2>
        <Link href="/bookings" className="text-sm text-primary-dark hover:underline">
          ดูทั้งหมด →
        </Link>
      </div>

      {bookings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-400">
          <Inbox className="h-8 w-8 text-slate-300" strokeWidth={1.5} />
          ยังไม่มีรายการจอง
        </div>
      ) : (
        <ul className="divide-y divide-slate-50">
          {bookings.map((booking) => (
            <li key={booking.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{booking.customer_name}</p>
                <p className="truncate text-xs text-slate-400">
                  {booking.packages?.title || '-'} ·{' '}
                  {booking.scheduled_date ? formatThaiDate(booking.scheduled_date) : formatThaiDate(booking.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-medium text-slate-800">
                  {booking.price ? formatTHB(booking.price) : '-'}
                </span>
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${
                    STATUS_BADGE[booking.status as BookingStatus] || 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {STATUS_LABEL[booking.status as BookingStatus] || booking.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
