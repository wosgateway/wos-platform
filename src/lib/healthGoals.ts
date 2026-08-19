// รูปภาพประกอบ 4 tiles ของ "Find Your Health Goal" (Step 7)
// แยกจาก messages/*.json เพราะรูปไม่ได้แปลตามภาษา — เหมือน WHY_IMAGES ใน lib/why.ts
// ลำดับต้องตรงกับ home.healthGoals.items ใน messages/th.json, en.json, lo.json
//
// MOCK NOTE: ยังไม่มีรูปถ่ายจริงสำหรับ Prevent/Restore/Renew/Optimize ใน repo
// เลยยืมรูปที่มีอยู่แล้วมาก่อน (จาก lib/categories.ts) เพื่อให้ hover-expand
// ใช้งานได้จริงตอน preview — เปลี่ยน path เป็นรูปจริงทีหลังได้โดยไม่กระทบโครงสร้าง

export type HealthGoalSlug = 'prevent' | 'restore' | 'renew' | 'optimize';

export interface HealthGoalImage {
  slug: HealthGoalSlug;
  image: string;
  alt: string;
}

export const HEALTH_GOAL_IMAGES: HealthGoalImage[] = [
  { slug: 'prevent', image: '/images/clinic.webp', alt: 'Checkup & screening' },
  { slug: 'restore', image: '/images/hospital.webp', alt: 'Treatment & recovery' },
  { slug: 'renew', image: '/images/spa.webp', alt: 'Aesthetic & wellness' },
  { slug: 'optimize', image: '/images/wellness.webp', alt: 'Longevity & anti-aging' },
];
