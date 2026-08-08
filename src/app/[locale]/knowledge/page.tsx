// src/app/[locale]/knowledge/page.tsx
// หน้ารวมบทความทั้งหมด — ปลายทางของปุ่ม "ดูบทความทั้งหมด →" จากการ์ดหน้าแรก
// (components/KnowledgeCenter.tsx) เนื้อหาการ์ดดึงจาก messages/*.json
// namespace `knowledge.articles.<slug>` (คนละ namespace กับ home.knowledge
// ที่ใช้บนหน้าแรก เพราะ teaser อาจอยากปรับให้ต่างกันได้ในอนาคต)

import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Breadcrumb } from '@/components/Breadcrumb';
import { KNOWLEDGE_ARTICLES } from '@/lib/knowledge';

interface ArticleCardText {
  title: string;
  teaser: string;
}

export default async function KnowledgeIndexPage() {
  const t = await getTranslations('knowledge');
  const articles = t.raw('articles') as Record<string, ArticleCardText>;

  return (
    <main>
      <Breadcrumb trail={[{ label: t('pageTitle') }]} />

      <section className="pb-16 pt-4">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t('pageTitle')}</h1>
          <p className="mt-2 max-w-xl text-slate-500">{t('pageSubtitle')}</p>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {KNOWLEDGE_ARTICLES.map(({ slug, icon, image }) => {
              const article = articles[slug];
              if (!article) return null;

              return (
                <Link
                  key={slug}
                  href={`/knowledge/${slug}`}
                  className="card-shadow group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white text-left transition hover:-translate-y-0.5"
                >
                  <div className="relative h-36 w-full overflow-hidden">
                    <Image
                      src={image}
                      alt={article.title}
                      fill
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                      sizes="(max-width: 768px) 100vw, 33vw"
                    />
                  </div>
                  <div className="flex flex-1 flex-col items-start p-6">
                    <span className="text-2xl" aria-hidden>
                      {icon}
                    </span>
                    <h2 className="mt-3 font-bold text-slate-900">{article.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">
                      {article.teaser}
                    </p>
                    <span className="mt-4 text-sm font-semibold text-primary">
                      {t('readMore')}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
