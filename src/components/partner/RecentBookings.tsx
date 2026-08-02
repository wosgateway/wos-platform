// src/components/partner/RecentBookings.tsx
// เอาไว้แค่โชว์ 8 รายการล่าสุดบน dashboard ไม่มี filter/search/export และไม่มี realtime update
// ทำเป็น server component (ไม่ใช้ 'use client') ให้สอดคล้องกับ DashboardMetrics.tsx

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatTHB, formatThaiDate } from '@/lib/format';

type BookingStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

interface RecentBooking {
  id: string;
  customer_name: string;
  customer_phone: string;
  booking_date: string;
  status: BookingStatus;
  total_price: number | null;
  packages: { title: string } | null;
}

const STATUS_BADGE: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'รอดำเนินการ',
  confirmed: 'ยืนยันแล้ว',
  in_progress: 'กำลังดำเนินการ',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
};

const RECENT_LIMIT = 8;

async function getRecentBookings(organizationId: string): Promise<RecentBooking[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('partner_bookings')
    .select(
      `
      id,
      customer_name,
      customer_phone,
      booking_date,
      status,
      total_price,
      packages!bookings_package_id_fkey ( title )
    `
    )
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(RECENT_LIMIT);

  if (error) {
    // ไม่ throw เพื่อไม่ให้ทั้งหน้า dashboard ล่ม แค่เว้นว่าง widget เฉยๆ
    console.error('RecentBookings: โหลดข้อมูลไม่สำเร็จ', error.message);
    return [];
  }

  return (data as unknown as RecentBooking[]) ?? [];
}

export async function RecentBookings({ organizationId }: { organizationId: string }) {
  const bookings = await getRecentBookings(organizationId);

  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h2 className="font-semibold text-slate-900">การจองล่าสุด</h2>
        <Link href="/bookings" className="text-sm text-primary hover:underline">
          ดูทั้งหมด →
        </Link>
      </div>

      {bookings.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-400">📭 ยังไม่มีรายการจอง</div>
      ) : (
        <ul className="divide-y divide-slate-50">
          {bookings.map((booking) => (
            <li key={booking.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{booking.customer_name}</p>
                <p className="truncate text-xs text-slate-400">
  {booking.packages?.title || '-'} · {formatThaiDate(booking.booking_date)}
</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-medium text-slate-800">
                  {booking.total_price ? formatTHB(booking.total_price) : '-'}
                </span>
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${STATUS_BADGE[booking.status]}`}
                >
                  {STATUS_LABEL[booking.status]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}