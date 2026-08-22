// src/components/partner/BookingStatusDonut.tsx
//
// 2026-08 (design pass, รอบ 2): จุดเด่นเชิงภาพใหม่ของ dashboard —
// แทนที่ 7-day trend bar ที่เคยอยู่ในการ์ด "การจองทั้งหมด"
// (ดูคอมเมนต์ที่ถอดออกใน DashboardMetrics.tsx) ตาม principle
// "spend your boldness in one place": มี trend bar + donut พร้อมกัน
// จะกลายเป็น decoration สองจุดแข่งความสนใจกันเอง ให้ donut นี้เป็น
// จุดเดียวที่ "ชัดเจนและมีความหมาย" แทน เพราะมันตอบคำถามจริงที่
// partner อยากรู้เวลาเปิด dashboard — "ตอนนี้การจองแต่ละสถานะ
// เท่าไหร่" — ซึ่งตัวเลขนิ่งในการ์ดเดี่ยวๆ ตอบได้แต่ไม่เห็น proportion
//
// Vanilla SVG donut ไม่ลง chart library เพิ่ม (recharts ก็มีอยู่แล้ว
// ในโปรเจกต์ แต่สำหรับ donut เดียวเบาๆ แบบนี้ stroke-dasharray ธรรมดา
// พอ ไม่ต้องแบก client bundle ของ recharts เข้ามาแค่นี้) — เป็น server
// component ล้วน ไม่มี interactivity/animation ที่ต้อง 'use client'
//
// นับจาก order_items (partner_id) เหมือน DashboardMetrics.tsx และ
// RecentBookings.tsx (partner_bookings มี 0 แถวถาวรตั้งแต่
// BookingForm.tsx สาธารณะเปลี่ยนไปยิง orders/order_items แล้ว)
// order_items.status enum จริง (migration 008): pending | confirmed |
// checked_in | completed | cancelled | refunded — ใช้ทั้ง 6 ค่า
// ต่างจาก DashboardMetrics.tsx ที่โชว์แค่ 4 ค่าบนการ์ด เพราะ donut
// ควรสะท้อนสัดส่วนที่แท้จริงของทุกสถานะ รวม cancelled/refunded ด้วย
//
// 2026-08 (design pass, รอบ 3): รับ `range` เดียวกับ DashboardMetrics.tsx
// (ผ่าน dashboard-range.ts ใช้ startDate ตัวเดียวกัน ไม่คำนวณแยก กัน
// ตัวเลขในการ์ดกับสัดส่วนใน donut ไม่ match กันเวลาเปลี่ยนช่วงเวลา)
import { createClient } from '@/lib/supabase/server';
import { rangeStartDate, type DashboardRange } from '@/lib/partner/dashboard-range';

type BookingStatus = 'pending' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'refunded';

const STATUS_ORDER: BookingStatus[] = [
  'pending',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'refunded',
];

// สีอิงชุดเดียวกับ STATUS_BADGE ใน RecentBookings.tsx (amber/emerald/
// blue/green/red/slate) แต่ใช้ hex ตรงๆ เพราะเป็นค่า stroke ของ SVG
// ไม่ใช่ className — completed แยกจาก confirmed ด้วย green-600 เข้ม
// กว่า emerald-500 เพื่อไม่ให้สองสถานะกลืนกันในวงกลมเดียว
const STATUS_COLOR: Record<BookingStatus, string> = {
  pending: '#f59e0b', // amber-500
  confirmed: '#10b981', // emerald-500
  checked_in: '#3b82f6', // blue-500
  completed: '#16a34a', // green-600
  cancelled: '#f87171', // red-400 (สถานะลบ ไม่ต้องเน้นด้วยสีจัด)
  refunded: '#94a3b8', // slate-400
};

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'รอดำเนินการ',
  confirmed: 'ยืนยันแล้ว',
  checked_in: 'เช็คอินแล้ว',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
  refunded: 'คืนเงินแล้ว',
};

async function getStatusCounts(partnerId: string | null, range: DashboardRange) {
  const empty = STATUS_ORDER.reduce(
    (acc, status) => ({ ...acc, [status]: 0 }),
    {} as Record<BookingStatus, number>
  );

  if (!partnerId) return empty;

  const supabase = createClient();
  const startDate = rangeStartDate(range);

  const results = await Promise.all(
    STATUS_ORDER.map((status) => {
      let q = supabase
        .from('order_items')
        .select('*', { count: 'exact', head: true })
        .eq('partner_id', partnerId)
        .eq('status', status);
      if (startDate) q = q.gte('created_at', startDate);
      return q;
    })
  );

  const counts = { ...empty };
  STATUS_ORDER.forEach((status, i) => {
    counts[status] = results[i].count || 0;
  });
  return counts;
}

// วงกลม r=15.9155 คือค่ามาตรฐานที่ทำให้เส้นรอบวง = 100 พอดี
// (2 * PI * 15.9155 ≈ 100) ทำให้แปลง % เป็น dasharray ตรงๆ ได้เลย
// โดยไม่ต้องคำนวณเส้นรอบวงจริงทุกครั้ง
const RADIUS = 15.9155;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export async function BookingStatusDonut({
  partnerId,
  range = 'all',
}: {
  partnerId: string | null;
  range?: DashboardRange;
}) {
  const counts = await getStatusCounts(partnerId, range);
  const total = STATUS_ORDER.reduce((sum, s) => sum + counts[s], 0);

  const segments = STATUS_ORDER.filter((s) => counts[s] > 0).map((status) => ({
    status,
    value: counts[status],
    pct: total > 0 ? counts[status] / total : 0,
  }));

  // สะสม offset ทีละ segment รอบวงกลม เริ่มที่ 12 นาฬิกา (rotate -90deg
  // ที่ <svg>) ตามเข็มนาฬิกา
  let cumulative = 0;
  const arcs = segments.map((seg) => {
    const dash = seg.pct * CIRCUMFERENCE;
    const arc = {
      ...seg,
      dasharray: `${dash} ${CIRCUMFERENCE - dash}`,
      dashoffset: -cumulative,
    };
    cumulative += dash;
    return arc;
  });

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-card">
      <h2 className="font-semibold text-slate-900">สถานะการจอง</h2>

      {total === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-slate-400">
          <svg
            viewBox="0 0 36 36"
            className="h-28 w-28 text-slate-100"
            aria-hidden="true"
          >
            <circle cx="18" cy="18" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="3.5" />
          </svg>
          {range === 'all' ? 'ยังไม่มีรายการจอง' : 'ไม่มีรายการจองในช่วงเวลานี้'}
        </div>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <div className="relative h-36 w-36 shrink-0">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              <circle cx="18" cy="18" r={RADIUS} fill="none" stroke="#f1f5f9" strokeWidth="3.5" />
              {arcs.map((arc) => (
                <circle
                  key={arc.status}
                  cx="18"
                  cy="18"
                  r={RADIUS}
                  fill="none"
                  stroke={STATUS_COLOR[arc.status]}
                  strokeWidth="3.5"
                  strokeDasharray={arc.dasharray}
                  strokeDashoffset={arc.dashoffset}
                  strokeLinecap="round"
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-slate-900">{total}</span>
              <span className="text-xs text-slate-400">การจอง</span>
            </div>
          </div>

          <ul className="w-full min-w-0 space-y-2">
            {segments.map((seg) => (
              <li key={seg.status} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-slate-600">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: STATUS_COLOR[seg.status] }}
                  />
                  <span className="truncate">{STATUS_LABEL[seg.status]}</span>
                </span>
                <span className="shrink-0 font-medium text-slate-800">
                  {seg.value}
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    ({Math.round(seg.pct * 100)}%)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
