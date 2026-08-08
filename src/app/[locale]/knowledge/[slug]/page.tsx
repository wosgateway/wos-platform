// src/app/[locale]/knowledge/[slug]/page.tsx
// หน้าบทความเดี่ยว — ปลายทางของ "อ่านต่อ →" ทั้งจากหน้าแรกและหน้ารวมบทความ
// slug ที่รู้จักมาจาก lib/knowledge.ts (icon เท่านั้น ไม่ใช่ข้อความ), ส่วน
// เนื้อหาเต็มดึงจาก messages/*.json namespace `knowledge.articles.<slug>`
// เหมือนแพทเทิร์นของ app/[locale]/category/[slug]/page.tsx (notFound() ถ้า
// slug ไม่รู้จัก หรือไม่มีเนื้อหาแปลไว้)

import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/Breadcrumb';
import { getKnowledgeMeta } from '@/lib/knowledge';

interface ArticleSection {
  heading: string;
  body: string;
}

interface ArticleContent {
  title: string;
  teaser: string;
  sections: ArticleSection[];
}

export default async function KnowledgeArticlePage({
  params: { slug },
}: {
  params: { slug: string };
}) {
  const meta = getKnowledgeMeta(slug);
  if (!meta) notFound();

  const t = await getTranslations('knowledge');
  const articles = t.raw('articles') as Record<string, ArticleContent>;
  const article = articles[slug];
  if (!article) notFound();

  return (
    <main>
      <Breadcrumb
        trail={[
          { label: t('pageTitle'), href: '/knowledge' },
          { label: article.title },
        ]}
      />

      <article className="pb-16 pt-4">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <div className="relative h-48 w-full overflow-hidden rounded-2xl sm:h-64">
            <Image
              src={meta.image}
              alt={article.title}
              fill
              priority
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 672px"
            />
          </div>

          <span className="mt-6 block text-3xl" aria-hidden>
            {meta.icon}
          </span>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
            {article.title}
          </h1>

          <div className="mt-8 space-y-8">
            {article.sections.map((section, i) => (
              <section key={i}>
                <h2 className="text-lg font-bold text-slate-900">{section.heading}</h2>
                <p className="mt-2 leading-relaxed text-slate-600">{section.body}</p>
              </section>
            ))}
          </div>

          {/* หมายเหตุมาตรฐาน — เนื้อหาเป็นข้อมูลทั่วไป ไม่ใช่คำแนะนำทางการแพทย์/
              กฎหมาย/ประกันที่ผูกพัน ควรตรวจสอบกับหน่วยงาน/บริษัทจริงอีกครั้ง */}
          <div className="mt-12 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-700">
            {t('disclaimer')}
          </div>
        </div>
      </article>
    </main>
  );
}
