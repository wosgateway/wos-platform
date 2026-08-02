// src/app/[locale]/partner/page.tsx
//
// อยู่ระดับเดียวกับโฟลเดอร์ [id] (src/app/[locale]/partner/[id]/page.tsx)
// Next.js ให้ static segment (page.tsx ตรงนี้) กับ dynamic segment ([id]/page.tsx)
// อยู่ร่วมกันได้ปกติ — /partner จะ match ไฟล์นี้ก่อนเสมอ ไม่ไปชนกับ [id]
//
// ต่างจากหน้า category/[slug] ตรงที่หน้านี้ค้นหา "ข้ามทุกหมวดหมู่พร้อมกัน"
// (เรียก fetchPartners() แบบไม่ส่ง dbCategories argument เลย) สำหรับคนที่ยัง
// ไม่แน่ใจว่าอยากดูหมวดไหน ส่วน category page จะกรองมาให้แล้วตั้งแต่ query
import { getTranslations } from 'next-intl/server';
import { fetchPartners } from '@/lib/data';
import { PartnerDirectory } from '@/components/PartnerDirectory';

export default async function AllPartnersPage() {
  const t = await getTranslations('partnerDirectory');

  try {
    const partners = await fetchPartners();

    return (
      <main className="section-padding mx-auto max-w-6xl px-4">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">{t('title')}</h1>
          <p className="mt-2 text-slate-500">{t('subtitle')}</p>
        </div>

        <PartnerDirectory partners={partners} />
      </main>
    );
  } catch {
    // fetchPartners() throw ตรงๆ เมื่อ error (ดู data.ts) — ไม่ปล่อยให้พา
    // user ไปเจอ error page เต็มจอ แสดงข้อความสุภาพแทน ให้หน้ายังโหลดได้
    return (
      <main className="section-padding mx-auto max-w-3xl px-4 text-center">
        <p className="text-slate-500">{t('loadError')}</p>
      </main>
    );
  }
}
