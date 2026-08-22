// src/app/[locale]/(partner-portal)/dashboard/loading.tsx
//
// Next.js route-level loading UI — โชว์ตอน hard navigation เข้า
// /dashboard ครั้งแรก (ก่อนที่ page.tsx จะ resolve searchParams/auth
// ด้วยซ้ำ) จึงไม่มี partnerId/range ให้ใช้ตรงนี้ — เป็นแค่โครง static
// ล้วนๆ mirror ของ page.tsx (รวม header + range select ปลอมๆ) เพื่อไม่
// ให้กระตุกตอน real content โหลดเสร็จ ส่วน <Suspense> ราย-widget ใน
// page.tsx เอง handle การสลับ ?range= (soft navigation) แยกต่างหาก —
// ไฟล์นี้ทำงานแค่รอบแรกที่เข้าหน้าเท่านั้น
import { MetricsSkeleton, DonutSkeleton, RecentBookingsSkeleton } from '@/components/partner/DashboardSkeletons';

export default function DashboardLoading() {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-7 w-32 animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-4 w-48 animate-pulse rounded bg-slate-100" />
        </div>
        <div className="h-8 w-36 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <MetricsSkeleton />
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <DonutSkeleton />
        </div>
        <div className="lg:col-span-2">
          <RecentBookingsSkeleton />
        </div>
      </div>
    </div>
  );
}
