// src/lib/image.ts
//
// ข้อมูล cover_image_url/image_url บางแถวใน Supabase ยัง migrate มาจากเว็บ
// static เดิม เป็น relative path แบบ "images/services/xxx.webp" (ไม่มี "/"
// นำหน้า) ซึ่งใช้ได้ปกติกับ <img> ธรรมดา แต่ next/image บังคับให้ path
// ภายในต้องขึ้นต้นด้วย "/" หรือเป็น URL เต็ม (http/https) เท่านั้น —
// ฟังก์ชันนี้ normalize ให้ใช้ได้เสมอ ไม่ว่าข้อมูลจะมาแบบไหน
export function normalizeImageSrc(src?: string | null, fallback = '/images/hero/hero-main.webp'): string {
  if (!src) return fallback;
  const trimmed = src.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/')) {
    return trimmed;
  }
  return `/${trimmed}`;
}
