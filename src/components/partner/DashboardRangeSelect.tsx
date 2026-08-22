// src/components/partner/DashboardRangeSelect.tsx
//
// Dropdown ตัวกรองช่วงเวลา มุมขวาบนของ dashboard — 'use client' เพราะ
// ต้องอ่าน/เขียน URL search params (useRouter/usePathname/useSearchParams
// จาก next/navigation) ตัว component นี้เองไม่ query ข้อมูลใดๆ แค่
// เปลี่ยน URL แล้วปล่อยให้ dashboard/page.tsx (server component) เป็น
// คน resolve range ใหม่และส่งลงไปยัง DashboardMetrics/BookingStatusDonut
//
// router.push ไปที่ path เดิม (pathname มาจาก next/navigation ซึ่งคืน
// path ที่ resolve แล้วรวม locale prefix จาก [locale] segment อยู่แล้ว
// ไม่ต้องต่อ locale เอง) แค่เปลี่ยน query string — Next.js จะ re-render
// เฉพาะ Server Component ที่อยู่ใต้ Suspense boundary ที่เกี่ยวข้อง
'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { DASHBOARD_RANGES, type DashboardRange } from '@/lib/partner/dashboard-range';

export function DashboardRangeSelect({ value }: { value: DashboardRange }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(next: DashboardRange) {
    const params = new URLSearchParams(searchParams.toString());
    // 'all' คือ default อยู่แล้ว ไม่ต้องใส่ลง URL ให้ query string
    // สะอาด (เช่น /dashboard แทน /dashboard?range=all)
    if (next === 'all') {
      params.delete('range');
    } else {
      params.set('range', next);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <select
      value={value}
      onChange={(e) => handleChange(e.target.value as DashboardRange)}
      aria-label="ช่วงเวลาของ dashboard"
      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
    >
      {DASHBOARD_RANGES.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label}
        </option>
      ))}
    </select>
  );
}
