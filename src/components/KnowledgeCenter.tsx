// src/components/KnowledgeCenter.tsx
// แทนที่ HowItWorks.tsx เดิม (บล็อก "3 ขั้นตอน" ที่ซ้ำกับ JourneyTimeline) ด้วย
// บล็อกให้ความรู้ก่อนตัดสินใจ — คำถามที่ผู้ใช้กลุ่มเป้าหมาย (คนลาวข้ามมารักษา
// ในไทย) มักมีก่อนเริ่มเดินทาง แต่ละการ์ดลิงก์ไปหน้าบทความจริงที่
// /knowledge/[slug] (ดูข้อความใน messages/*.json ภายใต้ home.knowledge)
//
// เป็น server component (ไม่ใช้ 'use client' เหมือนไฟล์เดิม) เพราะไม่มีส่วนที่
// ต้อง interactive ฝั่ง client เลย — ใช้ getTranslations แบบเดียวกับ page.tsx

import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getFeaturedKnowledgeArticles } from '@/lib/knowledge';

interface KnowledgeCardText {
  title: string;
  teaser: string;
}

export async function KnowledgeCenter() {
  const t = await getTranslations('home.knowledge');
  const cards = t.raw('articles') as Record<string, KnowledgeCardText>;
  const featuredArticles = getFeaturedKnowledgeArticles();

  return (
    <section className="bg-sand py-16 md:py-20">
      <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t('title')}</h2>
        <p className="mx-auto mt-3 max-w-xl text-slate-600">{t('subtitle')}</p>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {featuredArticles.map(({ slug, icon, image }) => {
            const card = cards[slug];
            if (!card) return null;

            return (
              <Link
                key={slug}
                href={`/knowledge/${slug}`}
                className="card-shadow group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white text-left transition hover:-translate-y-0.5"
              >
                <div className="relative h-36 w-full overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image}
                    alt={card.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </div>
                <div className="flex flex-1 flex-col items-start p-6">
                  <span className="text-2xl" aria-hidden>
                    {icon}
                  </span>
                  <h3 className="mt-3 font-bold text-slate-900">{card.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{card.teaser}</p>
                  <span className="mt-4 text-sm font-semibold text-primary">
                    {t('readMore')}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="mt-10">
          <Link
            href="/knowledge"
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            {t('viewAll')}
          </Link>
        </div>
      </div>
    </section>
  );
}
