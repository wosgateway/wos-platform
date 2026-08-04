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
import { createClient } from '@/lib/supabase/server';

// order_items.status enum จริง (migration 008): pending | confirmed |
// checked_in | completed | cancelled | refunded — ไม่มี 'in_progress'
// เหมือน partner_bookings เดิม การ์ดที่นี่ใช้แค่ 4 ค่าที่มีอยู่จริง
async function getMetrics(partnerId: string | null) {
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

  const [
    { count: totalBookings },
    { count: pendingBookings },
    { count: confirmedBookings },
    { count: completedBookings },
    { count: totalPackages },
    { count: publishedPackages },
  ] = await Promise.all([
    supabase.from('order_items').select('*', { count: 'exact', head: true }).eq('partner_id', partnerId),
    supabase.from('order_items').select('*', { count: 'exact', head: true }).eq('partner_id', partnerId).eq('status', 'pending'),
    supabase.from('order_items').select('*', { count: 'exact', head: true }).eq('partner_id', partnerId).eq('status', 'confirmed'),
    supabase.from('order_items').select('*', { count: 'exact', head: true }).eq('partner_id', partnerId).eq('status', 'completed'),
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

const METRIC_CARDS = [
  { key: 'totalBookings', label: 'การจองทั้งหมด', icon: '📋', color: 'blue' },
  { key: 'pendingBookings', label: 'รอดำเนินการ', icon: '⏳', color: 'amber' },
  { key: 'confirmedBookings', label: 'ยืนยันแล้ว', icon: '✅', color: 'emerald' },
  { key: 'completedBookings', label: 'เสร็จสิ้น', icon: '🎉', color: 'green' },
  { key: 'totalPackages', label: 'โปรแกรมทั้งหมด', icon: '📦', color: 'purple' },
  { key: 'publishedPackages', label: 'โปรแกรมที่เผยแพร่', icon: '🚀', color: 'indigo' },
];

export async function DashboardMetrics({
  partnerId,
}: {
  partnerId: string | null;
}) {
  const metrics = await getMetrics(partnerId);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {METRIC_CARDS.map((card) => (
        <div key={card.key} className="bg-white rounded-xl border border-slate-100 shadow-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-2xl">{card.icon}</span>
            <span className="text-2xl font-bold text-slate-900">
              {metrics[card.key as keyof typeof metrics] ?? 0}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{card.label}</p>
        </div>
      ))}
    </div>
  );
}