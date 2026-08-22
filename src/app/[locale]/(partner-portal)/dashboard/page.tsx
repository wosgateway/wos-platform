// src/app/(partner-portal)/dashboard/page.tsx
//
// 2026-08 (design pass): ตัด emoji ทักทายออก, เพิ่ม eyebrow label เล็กๆ
// เหนือ heading ให้มี typographic hierarchy ชัดขึ้น. logic/data ไม่แตะ
//
// 2026-08 (design pass, รอบ 2): เพิ่ม BookingStatusDonut วางข้าง
// RecentBookings แบบ 2 คอลัมน์ (donut คอลัมน์แคบ, รายการคอลัมน์กว้าง)
// ตาม layout ใน PEAK reference — เป็นจุดเด่นเชิงภาพจุดเดียวของหน้านี้
// แทนที่ trend bar ที่ถอดออกจาก DashboardMetrics.tsx แล้ว
//
// 2026-08 (design pass, รอบ 3):
// 1) ตัวกรองช่วงเวลา — อ่าน ?range= จาก searchParams (Next.js ส่งเป็น
//    prop ตรงๆ ให้ page component ไม่ต้องใช้ hook) แปลงผ่าน
//    parseDashboardRange() แล้วส่งลง DashboardMetrics/BookingStatusDonut
//    ทั้งคู่ ตัว dropdown เองอยู่ใน DashboardRangeSelect.tsx ('use client'
//    เพราะต้องเขียน URL) วางไว้ข้าง heading มุมขวา
//    หมายเหตุ: RecentBookings ไม่ผูกกับ range โดยเจตนา — "การจองล่าสุด"
//    ควรโชว์รายการล่าสุดจริงๆ เสมอ ไม่ใช่ล่าสุดภายในหน้าต่างเวลาที่เลือก
// 2) Loading states — ครอบทั้ง 3 widget ด้วย <Suspense> แยกกัน (ไม่ใช่
//    boundary เดียวรวม) ให้แต่ละส่วนขึ้น skeleton ของตัวเองอิสระตอน
//    stream เข้ามา ทั้งตอน hard navigation ครั้งแรก (ร่วมกับ loading.tsx
//    ที่โฟลเดอร์เดียวกัน) และตอนเปลี่ยน ?range= (soft navigation)
import { Suspense } from 'react';
import { requirePartnerAuth } from '@/lib/partner/auth';
import { DashboardMetrics } from '@/components/partner/DashboardMetrics';
import { BookingStatusDonut } from '@/components/partner/BookingStatusDonut';
import { RecentBookings } from '@/components/partner/RecentBookings';
import { DashboardRangeSelect } from '@/components/partner/DashboardRangeSelect';
import { MetricsSkeleton, DonutSkeleton, RecentBookingsSkeleton } from '@/components/partner/DashboardSkeletons';
import { parseDashboardRange } from '@/lib/partner/dashboard-range';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const { user } = await requirePartnerAuth();
  const partnerId = user.branch?.partner_id ?? null;
  const range = parseDashboardRange(searchParams.range);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-dark">แดชบอร์ด</p>
          <h1 className="text-2xl font-bold text-slate-900">ภาพรวม</h1>
          <p className="text-sm text-slate-500">ยินดีต้อนรับกลับ, {user.full_name}</p>
        </div>
        <DashboardRangeSelect value={range} />
      </div>
      <Suspense key={`metrics-${range}`} fallback={<MetricsSkeleton />}>
        <DashboardMetrics partnerId={partnerId} range={range} />
      </Suspense>
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Suspense key={`donut-${range}`} fallback={<DonutSkeleton />}>
            <BookingStatusDonut partnerId={partnerId} range={range} />
          </Suspense>
        </div>
        <div className="lg:col-span-2">
          <Suspense fallback={<RecentBookingsSkeleton />}>
            <RecentBookings partnerId={partnerId} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
