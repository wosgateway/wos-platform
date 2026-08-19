// src/app/[locale]/become-partner/page.tsx
//
// เดิมหน้านี้คือฟอร์ม B2B ("สมัครเป็นพันธมิตรธุรกิจ") แต่ตอนนี้ /partner
// (ดู src/app/[locale]/partner/page.tsx) ทำหน้าที่เดียวกันแบบครบกว่า —
// เก็บ route นี้ไว้เป็น redirect เฉย ๆ กัน bookmark/ลิงก์เก่าที่ยังอ้างมาที่นี่
// (เช่นจาก external ที่เคย index หน้านี้ไว้) พังไปเลย
import { redirect } from '@/i18n/navigation';

export default function BecomePartnerPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/partner', locale: params.locale });
}
