import { getTranslations } from 'next-intl/server';
import { getCategoryBySlug } from '@/lib/categories';
import { fetchPartners } from '@/lib/data';
import { PartnersSearchGrid } from '@/components/PartnersSearchGrid';
import { Breadcrumb } from '@/components/Breadcrumb';
import { notFound } from 'next/navigation';

export default async function CategoryPage({
  params: { slug },
}: {
  params: { slug: string };
}) {
  const category = getCategoryBySlug(slug);
  if (!category) notFound();

  const tCat = await getTranslations('categories');
  const t = await getTranslations('common');
  const label = tCat(category.slug);
  const partners = await fetchPartners(category.dbCategories);

  return (
    <main>
      <Breadcrumb trail={[{ label }]} />

      <section className="pb-6 pt-4">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 sm:px-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-light text-3xl text-primary-dark">
            {category.icon}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{label}</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {t('partnersCount', { count: partners.length })}
            </p>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* ค้นหา/กรองเฉพาะฝั่งลูกค้า — ไม่ใช้กับ /admin หรือ partner portal
              (ดูสรุปเหตุผลใน README ส่วน consumer-facing vs B2B) */}
          <PartnersSearchGrid partners={partners} />
        </div>
      </section>

      <section className="pb-12 text-center">
        {/* เดิมชี้ไป /services ซึ่งไม่มี route นี้อยู่จริงในโปรเจกต์ (ไม่เคยสร้าง) —
            เปลี่ยนเป็นลิงก์ LINE OA แทน เพราะความหมายเดิมของ helpLink คือ
            "ไม่แน่ใจจะเลือกที่ไหนดี? ให้ทีมช่วยแนะนำ" ซึ่งคือการคุยกับคนจริง
            ไม่ใช่หน้าเว็บ — ใช้ <a> ธรรมดาเพราะเป็นลิงก์ภายนอก ไม่ใช่ next-intl Link */}
        <a
          href="https://line.me/ti/p/@vlf9996z"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-slate-500 transition hover:text-primary-dark"
        >
          {t('helpLink')}
        </a>
      </section>
    </main>
  );
}
