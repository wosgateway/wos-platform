import { getTranslations } from 'next-intl/server';
import { CATEGORIES } from '@/lib/categories';
import { fetchFeaturedPackages } from '@/lib/data';
import { CategoryCard } from '@/components/CategoryCard';
import { PartnerLogos } from '@/components/PartnerLogos';
import { JourneyTimelineV2 } from '@/components/JourneyTimelineV2';
import { WhyWosV2 } from '@/components/WhyWosV2';
// HealthGoalFinder disabled — duplicated the Categories section title/subtitle
// right below it. Keeping the import/component/translations in place in case
// we want to bring it back later (e.g. once Explore is wired to real filters).
// import { HealthGoalFinder } from '@/components/HealthGoalFinder';
import { FeaturedProgramsSliderV2 } from '@/components/FeaturedProgramsSliderV2';
import { TestimonialsV2 } from '@/components/TestimonialsV2';
import { FAQ } from '@/components/FAQ';
import { KnowledgeCenter } from '@/components/KnowledgeCenter';
import HeroV2 from '@/components/HeroV2';

export default async function HomePage() {
  const t = await getTranslations('home');
  const tCat = await getTranslations('categories');

  const whyItems = t.raw('why.items') as { title: string; desc: string }[];
  // const goalItems = t.raw('healthGoals.items') as { label: string; desc: string }[]; // HealthGoalFinder disabled
  const testimonialItemsV2 = t.raw('testimonialsV2.items') as {
    quote: string;
    name: string;
    route: string;
    service: string;
    rating: number;
  }[];

  // ดึงแพ็กเกจโปรโมชันมาแสดงเป็นสไลด์ "โปรแกรมแนะนำ" — กันพังทั้งหน้า
  // ถ้า query ล้มเหลว (เช่น ยังไม่มีแพ็กเกจติด is_promotion) ให้ fallback เป็น [] เฉยๆ
  let featuredPackages: Awaited<ReturnType<typeof fetchFeaturedPackages>> = [];
  try {
    featuredPackages = await fetchFeaturedPackages();
  } catch (err) {
    console.error('fetchFeaturedPackages failed', err);
  }

  return (
    <main>
      {/* ===== HERO (WOS.os rebrand, network diagram slotted in) ===== */}
      <HeroV2 image={{ src: '/images/hero/hero-1.webp', alt: 'WOS.os cross-border health journey' }} />

      {/* ===== PARTNER LOGOS ===== */}
      <PartnerLogos />

      {/* ===== PATIENT JOURNEY ===== */}
      <JourneyTimelineV2 />

      {/* ===== WHY WOS ===== */}
      <WhyWosV2 title={t('why.title')} items={whyItems} />

      {/* ===== HEALTH GOAL FINDER (disabled) =====
          Duplicated the Categories title/subtitle right below it, and its
          Explore buttons are still presentation-only stubs. Removed from the
          page for now; component + translations left untouched to re-enable
          later.
      <HealthGoalFinder
        eyebrow={t('healthGoals.eyebrow')}
        title={t('healthGoals.title')}
        subtitle={t('healthGoals.subtitle')}
        viewAllCta={t('healthGoals.viewAllCta')}
        exploreCta={t('healthGoals.exploreCta')}
        items={goalItems}
      />
      */}

      {/* ===== CATEGORIES ===== */}
      <section id="categories" className="section-padding mx-auto max-w-5xl scroll-mt-16 px-4">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">{t('categoriesTitle')}</h2>
          <p className="mt-2 text-slate-500">{t('categoriesSubtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((category) => (
            <CategoryCard key={category.slug} category={category} label={tCat(category.slug)} />
          ))}
        </div>
      </section>

      {/* ===== FEATURED PROGRAMS =====
          Uses the real AddToJourneyButton / lib/journey/context — adding an
          item here actually shows up in the JourneyCartBar, same as
          anywhere else on the site. Not a mock. */}
      <FeaturedProgramsSliderV2 packages={featuredPackages} />

      {/* ===== KNOWLEDGE CENTER (replaces old HowItWorks 3-step block) ===== */}
      <KnowledgeCenter />

      {/* ===== TESTIMONIALS ("Real Journeys") =====
          Initials avatars, not photos — no consented patient photos exist
          yet (PDPA). Quotes are still placeholder copy either way. */}
      <TestimonialsV2 title={t('testimonialsV2.title')} items={testimonialItemsV2} />

      {/* ===== FAQ ===== */}
      <FAQ />
    </main>
  );
}
