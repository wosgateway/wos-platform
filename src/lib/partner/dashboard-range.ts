// src/lib/partner/dashboard-range.ts
//
// ตัวกรองช่วงเวลาของ dashboard (?range=7d|30d|90d|all) — ใช้ร่วมกัน
// ทั้ง DashboardMetrics.tsx และ BookingStatusDonut.tsx เพื่อไม่ให้
// สองที่คำนวณ startDate ไม่ตรงกัน (เช่น one-off rounding ต่างกัน
// ทำให้ยอดรวมในการ์ด vs. ยอดใน donut ไม่ match)
//
// ค่า default คือ 'all' (ไม่ filter) เพื่อให้พฤติกรรมเดิมก่อนมี
// ตัวกรองยังคงเดิมสำหรับคนที่ยังไม่เคยกดเปลี่ยน — ไม่ทำให้ตัวเลขที่
// เคยเห็นเปลี่ยนไปเงียบๆ โดยไม่ได้ตั้งใจ
export type DashboardRange = '7d' | '30d' | '90d' | 'all';

export const DASHBOARD_RANGES: { value: DashboardRange; label: string }[] = [
  { value: '7d', label: '7 วันที่ผ่านมา' },
  { value: '30d', label: '30 วันที่ผ่านมา' },
  { value: '90d', label: '90 วันที่ผ่านมา' },
  { value: 'all', label: 'ทั้งหมด' },
];

const RANGE_DAYS: Record<Exclude<DashboardRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

// รับค่าดิบจาก searchParams (Next.js ส่งเป็น string | string[] | undefined
// แล้วแต่ว่ามี query ซ้ำ key กันไหม) — ค่าที่ไม่รู้จักหรือไม่มีเลย fallback
// เป็น 'all' เสมอ ไม่ throw
export function parseDashboardRange(value: string | string[] | undefined): DashboardRange {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === '7d' || v === '30d' || v === '90d') return v;
  return 'all';
}

// คืน ISO string ของจุดเริ่มต้นช่วง หรือ null ถ้าเป็น 'all' (ไม่ต้อง
// filter เลย) — ตัวเรียกใช้ conditionally .gte('created_at', start)
// เฉพาะตอนไม่ null
export function rangeStartDate(range: DashboardRange): string | null {
  if (range === 'all') return null;
  const d = new Date();
  d.setDate(d.getDate() - RANGE_DAYS[range]);
  return d.toISOString();
}
