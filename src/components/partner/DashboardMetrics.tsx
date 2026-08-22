// src/components/partner/DashboardMetrics.tsx
//
// ⚠️ 2026-08: เปลี่ยนจากนับ `partner_bookings` (organization_id) มาเป็น
// `order_items` (partner_id) เพราะ BookingForm.tsx สาธารณะเปลี่ยนไปยิง
// POST /api/orders -> create_order_with_items() RPC ตั้งแต่ migration
// 012/014 แล้ว ทำให้ order ใหม่ทั้งหมดเข้า orders/order_items ไม่ใช่
// partner_bookings อีกต่อไป (ตารางนั้นมี 0 แถวถาวร ไม่มีโค้ดที่ไหน insert
// เข้าแล้ว) การนับจาก partner_bookings จึงเป็น false-empty เสมอ
//
// หมายเหตุ organization_id -> partner_id: order_items ผูกกับ
// `partners.id` ตรงๆ (migration 010) ไม่ใช่ organizations.id เหมือน
// partner_bookings เดิม ดังนั้น component นี้ต้องรับ `partnerId` เป็น
// ตัวขับหลัก ไม่ใช่ organizationId แล้ว — ตัวเรียก (dashboard/page.tsx)
// ต้อง resolve partnerId จาก users.branch_id -> branches.partner_id
// ก่อนส่งเข้ามา (ดูเส้นทางใน PROJECT_STRUCTURE.md ข้อ 2) ถ้า partnerId
// เป็น null (user ยังไม่ผูก branch_id) จะโชว์ค่า 0 ทั้งหมดแทนการ error
//
// 2026-08 (design pass): แทนที่ emoji icon ด้วย lucide-react (เส้น,
// scale ได้, ไม่ผูกกับ emoji set ของ OS ผู้ใช้)
//
// 2026-08 (design pass, รอบ 2): ถอด 7-day trend bar ที่เคยเพิ่มไว้ใน
// การ์ด "การจองทั้งหมด" ออก — ตอนนี้มี BookingStatusDonut.tsx เป็นจุด
// เด่นเชิงภาพของหน้า dashboard แล้ว (วางข้าง RecentBookings ใน
// dashboard/page.tsx) ตาม principle "spend your boldness in one place":
// มี trend bar + donut พร้อมกันจะกลายเป็น decoration สองจุดแข่งกันเอง
// การ์ดตัวเลขจึงกลับไปเรียบง่ายเหมือนเดิม เหลือแค่ไอคอน+ตัวเลข+label
//
// 2026-08 (design pass, รอบ 3): เพิ่มตัวกรองช่วงเวลา — รับ `range` จาก
// dashboard/page.tsx (อ่านจาก ?range= ผ่าน DashboardRangeSelect.tsx)
// แล้ว filter เฉพาะ 4 การ์ดที่นับจาก order_items (totalBookings/
// pendingBookings/confirmedBookings/completedBookings) ด้วย
// .gte('created_at', startDate) ส่วน totalPackages/publishedPackages
// ยังนับแบบ all-time เสมอ เพราะ "โปรแกรมทั้งหมด/ที่เผยแพร่" ไม่ใช่
// metric เชิงเวลาแบบเดียวกับการจอง (การมี/ไม่มี range ไม่เปลี่ยน
// ความหมายของมัน) — ดู rangeStartDate() ใน dashboard-range.ts
import {
  ClipboardList,
  Clock3,
  CheckCircle2,
  Trophy,
  Package,
  Rocket,
  type LucideIcon,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { rangeStartDate, type DashboardRange } from '@/lib/partner/dashboard-range';

// order_items.status enum จริง (migration 008): pending | confirmed |
// checked_in | completed | cancelled | refunded — ไม่มี 'in_progress'
// เหมือน partner_bookings เดิม การ์ดที่นี่ใช้แค่ 4 ค่าที่มีอยู่จริง
async function getMetrics(partnerId: string | null, range: DashboardRange) {
  const supabase = createClient();

  if (!partnerId) {
    // user ยังไม่ผูก branch_id -> partner_id (เคสเดียวกับข้อ 3.6 ใน
    // PROJECT_STRUCTURE.md) — โชว์ 0 ทุกช่องแทนที่จะ query ด้วย partner_id
    // เป็น null (ซึ่งจะ error หรือคืนทุกแถวของทุก partner โดยไม่ตั้งใจ)
    return {
      totalBookings: 0,
      pendingBookings: 0,
      confirmedBookings: 0,
      completedBookings: 0,
      totalPackages: 0,
      publishedPackages: 0,
    };
  }

  const startDate = rangeStartDate(range);

  // helper เล็กๆ กัน query ซ้ำ 4 บรรทัด — ใส่ .gte แค่ตอนมี startDate
  // จริง ('all' คืน null แปลว่าไม่ filter)
  function bookingCountQuery(status?: string) {
    let q = supabase
      .from('order_items')
      .select('*', { count: 'exact', head: true })
      .eq('partner_id', partnerId as string);
    if (status) q = q.eq('status', status);
    if (startDate) q = q.gte('created_at', startDate);
    return q;
  }

  const [
    { count: totalBookings },
    { count: pendingBookings },
    { count: confirmedBookings },
    { count: completedBookings },
    { count: totalPackages },
    { count: publishedPackages },
  ] = await Promise.all([
    bookingCountQuery(),
    bookingCountQuery('pending'),
    bookingCountQuery('confirmed'),
    bookingCountQuery('completed'),
    // packages ไม่ผูกกับ range — โปรแกรมทั้งหมด/ที่เผยแพร่นับ all-time เสมอ
    supabase.from('packages').select('*', { count: 'exact', head: true }).eq('partner_id', partnerId),
    supabase.from('packages').select('*', { count: 'exact', head: true }).eq('partner_id', partnerId).eq('status', 'published'),
  ]);

  return {
    totalBookings: totalBookings || 0,
    pendingBookings: pendingBookings || 0,
    confirmedBookings: confirmedBookings || 0,
    completedBookings: completedBookings || 0,
    totalPackages: totalPackages || 0,
    publishedPackages: publishedPackages || 0,
  };
}

const METRIC_CARDS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'totalBookings', label: 'การจองทั้งหมด', icon: ClipboardList },
  { key: 'pendingBookings', label: 'รอดำเนินการ', icon: Clock3 },
  { key: 'confirmedBookings', label: 'ยืนยันแล้ว', icon: CheckCircle2 },
  { key: 'completedBookings', label: 'เสร็จสิ้น', icon: Trophy },
  { key: 'totalPackages', label: 'โปรแกรมทั้งหมด', icon: Package },
  { key: 'publishedPackages', label: 'โปรแกรมที่เผยแพร่', icon: Rocket },
];

export async function DashboardMetrics({
  partnerId,
  range = 'all',
}: {
  partnerId: string | null;
  range?: DashboardRange;
}) {
  const metrics = await getMetrics(partnerId, range);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {METRIC_CARDS.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.key} className="rounded-xl border border-slate-100 bg-white p-5 shadow-card">
            <div className="flex items-center justify-between">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-light/60 text-primary-dark">
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <span className="text-2xl font-bold text-slate-900">
                {metrics[card.key as keyof typeof metrics] as number ?? 0}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{card.label}</p>
          </div>
        );
      })}
    </div>
  );
}
