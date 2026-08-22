// src/components/partner/DashboardSkeletons.tsx
//
// Skeleton fallback สำหรับ <Suspense> ที่ครอบ DashboardMetrics /
// BookingStatusDonut / RecentBookings ใน dashboard/page.tsx (และใช้ซ้ำ
// ใน loading.tsx สำหรับ initial hard navigation) โครง (grid columns,
// padding, ความสูงโดยประมาณ) mirror ของจริงให้ใกล้เคียงที่สุด ไม่งั้น
// ตอน swap จาก skeleton -> real content จะเกิด layout shift
//
// เป็น sync component ล้วนๆ ไม่มี 'use client', ไม่มี data fetching —
// React ต้อง render fallback ได้ทันทีตอน Suspense boundary suspend
export function MetricsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border border-slate-100 bg-white p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div className="h-9 w-9 rounded-lg bg-slate-100" />
            <div className="h-7 w-10 rounded bg-slate-100" />
          </div>
          <div className="mt-3 h-4 w-24 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function DonutSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-100 bg-white p-5 shadow-card">
      <div className="h-5 w-28 rounded bg-slate-100" />
      <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <div className="h-36 w-36 shrink-0 rounded-full bg-slate-100" />
        <div className="w-full space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 w-full rounded bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function RecentBookingsSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-100 bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="h-5 w-28 rounded bg-slate-100" />
        <div className="h-4 w-16 rounded bg-slate-100" />
      </div>
      <ul className="divide-y divide-slate-50">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="flex items-center justify-between gap-4 px-5 py-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-1/3 rounded bg-slate-100" />
              <div className="h-3 w-1/2 rounded bg-slate-100" />
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="h-4 w-14 rounded bg-slate-100" />
              <div className="h-6 w-16 rounded-full bg-slate-100" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
