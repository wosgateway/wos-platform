import { getTranslations } from 'next-intl/server';
import { CATEGORIES } from '@/lib/categories';
import { fetchFeaturedPackages } from '@/lib/data';
import { CategoryCard } from '@/components/CategoryCard';
import { PartnerLogos } from '@/components/PartnerLogos';
import { WOSHealthJourney } from '@/components/WOSHealthJourney';
import { WhyWosV2 } from '@/components/WhyWosV2';
import { HealthGoalFinder } from '@/components/HealthGoalFinder';
import {
  HEALTH_GOAL_CATEGORY_MAP,
  HEALTH_GOAL_IMAGES,
  isHealthGoalSlug,
} from '@/lib/healthGoals';
import { Link } from '@/i18n/navigation';
import { FeaturedProgramsSliderV2 } from '@/components/FeaturedProgramsSliderV2';
import { TestimonialsV2 } from '@/components/TestimonialsV2';
import { FAQ } from '@/components/FAQ';
import { KnowledgeCenter } from '@/components/KnowledgeCenter';
import HeroV2 from '@/components/HeroV2';

export default async function HomePage({
  searchParams,
}: {
  searchParams: { goal?: string };
}) {
  const t = await getTranslations('home');
  const tCat = await getTranslations('categories');

  const whyItems = t.raw('why.items') as { title: string; desc: string }[];
  const goalItems = t.raw('healthGoals.items') as { label: string; desc: string }[];
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

  // "Find Your Health Goal" → Categories wiring: ?goal=<slug> from the
  // HealthGoalFinder "Explore" CTA narrows the Categories grid down to the
  // categories mapped in HEALTH_GOAL_CATEGORY_MAP, instead of showing all 6.
  const activeGoal = isHealthGoalSlug(searchParams.goal) ? searchParams.goal : null;
  const displayedCategories = activeGoal
    ? CATEGORIES.filter((c) => HEALTH_GOAL_CATEGORY_MAP[activeGoal].includes(c.slug))
    : CATEGORIES;
  const activeGoalIndex = activeGoal
    ? HEALTH_GOAL_IMAGES.findIndex((g) => g.slug === activeGoal)
    : -1;
  const activeGoalLabel = activeGoalIndex >= 0 ? goalItems[activeGoalIndex]?.label : null;
  // Reuse the goal's own one-line description (already shown on its tile in
  // HealthGoalFinder, e.g. "รักษาและฟื้นฟู") as the Categories subtitle when
  // filtered — ties the two sections together instead of repeating a
  // generic "choose your goal" line right under a "find your goal" section.
  const activeGoalDesc = activeGoalIndex >= 0 ? goalItems[activeGoalIndex]?.desc : null;

  return (
    <main>
      {/* ===== HERO (WOS.os rebrand, network diagram slotted in) =====
          Pass 2–3 images to crossfade automatically (see
          HeroBackgroundSlideshow). All images should share the same
          78%/18% subject framing used below. Drop hero-2.webp / hero-3.webp
          into public/images/hero/ and list them here to add them to the
          rotation — or trim back to a single-item array to disable it. */}
      <HeroV2
        images={[
          {
            src: '/images/hero/hero-1.webp',
            alt: 'Guest relaxing at a WOS-affiliated wellness retreat overlooking the river',
          },
          {
            src: '/images/hero/hero-2.webp',
            alt: 'Guest relaxing at a WOS-affiliated wellness retreat overlooking the river',
          },
          {
            src: '/images/hero/hero-3.webp',
            alt: 'Guest relaxing at a WOS-affiliated wellness retreat overlooking the river',
          },
        ]}
      />

      {/* ===== PARTNER LOGOS ===== */}
      <PartnerLogos />

      {/* ===== PATIENT JOURNEY ===== */}
      <WOSHealthJourney />

      {/* ===== WHY WOS ===== */}
      <WhyWosV2 title={t('why.title')} items={whyItems} />

      {/* ===== HEALTH GOAL FINDER =====
          Explore links to /?goal=<slug>#categories, which the Categories
          section below reads to narrow itself to the matching categories. */}
      <HealthGoalFinder
        eyebrow={t('healthGoals.eyebrow')}
        title={t('healthGoals.title')}
        subtitle={t('healthGoals.subtitle')}
        viewAllCta={t('healthGoals.viewAllCta')}
        exploreCta={t('healthGoals.exploreCta')}
        items={goalItems}
      />

      {/* ===== CATEGORIES =====
          Title/subtitle switch when a goal filter is active (see
          categoriesTitleFiltered + activeGoalDesc above) so this reads as
          "here are the results for what you picked" rather than a second,
          near-identical "choose your goal" prompt right under
          HealthGoalFinder. */}
      <section id="categories" className="section-padding mx-auto max-w-5xl scroll-mt-16 px-4">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">
            {activeGoal && activeGoalLabel
              ? t('categoriesTitleFiltered', { goal: activeGoalLabel })
              : t('categoriesTitle')}
          </h2>
          <p className="mt-2 text-slate-500">
            {activeGoal && activeGoalDesc ? activeGoalDesc : t('categoriesSubtitle')}
          </p>
          {activeGoal && (
            <Link
              href="/#categories"
              className="mt-3 inline-block text-sm text-slate-500 underline hover:text-navy"
            >
              {t('healthGoals.clearFilter')}
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {displayedCategories.map((category) => (
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
