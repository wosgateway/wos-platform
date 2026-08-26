// รูปภาพประกอบ 4 tiles ของ "Find Your Health Goal" (Step 7)
// แยกจาก messages/*.json เพราะรูปไม่ได้แปลตามภาษา — เหมือน WHY_IMAGES ใน lib/why.ts
// ลำดับต้องตรงกับ home.healthGoals.items ใน messages/th.json, en.json, lo.json
//
// MOCK NOTE: ยังไม่มีรูปถ่ายจริงสำหรับ Prevent/Restore/Renew/Optimize ใน repo
// เลยยืมรูปที่มีอยู่แล้วมาก่อน (จาก lib/categories.ts) เพื่อให้ hover-expand
// ใช้งานได้จริงตอน preview — เปลี่ยน path เป็นรูปจริงทีหลังได้โดยไม่กระทบโครงสร้าง

import type { CategorySlug } from '@/lib/categories';

export type HealthGoalSlug = 'prevent' | 'restore' | 'renew' | 'optimize';

export interface HealthGoalImage {
  slug: HealthGoalSlug;
  image: string;
  alt: string;
}

export const HEALTH_GOAL_IMAGES: HealthGoalImage[] = [
  { slug: 'prevent', image: '/images/Checkup.webp', alt: 'Checkup & screening' },
  { slug: 'restore', image: '/images/Treatment.webp', alt: 'Treatment & recovery' },
  { slug: 'renew', image: '/images/spa-1.webp', alt: 'Aesthetic & wellness' },
  { slug: 'optimize', image: '/images/Longevity.webp', alt: 'Longevity & anti-aging' },
];

export const HEALTH_GOAL_SLUGS: HealthGoalSlug[] = HEALTH_GOAL_IMAGES.map((g) => g.slug);

// Goal → Category mapping used by the "Explore" CTA to filter the
// Categories grid on the homepage. Based on what each goal actually means
// (see home.healthGoals.items[].desc) matched against each category's
// real-world purpose (see categories.<slug> labels in messages/*.json) —
// not the borrowed tile images above, which are unrelated to this mapping.
export const HEALTH_GOAL_CATEGORY_MAP: Record<HealthGoalSlug, CategorySlug[]> = {
  prevent: ['hospital', 'clinic'], // Checkup & Screening
  restore: ['hospital', 'dental'], // Treatment & Recovery
  renew: ['clinic', 'spa'], // Aesthetic & Wellness
  optimize: ['wellness'], // Longevity & Anti-aging
};

export function isHealthGoalSlug(value: string | undefined): value is HealthGoalSlug {
  return !!value && (HEALTH_GOAL_SLUGS as string[]).includes(value);
}
