import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { CATEGORIES } from '@/lib/categories';
import { WHY_IMAGES } from '@/lib/why';
import { fetchFeaturedPackages } from '@/lib/data';
import { CategoryCard } from '@/components/CategoryCard';
import { WhyCard } from '@/components/WhyCard';
import { TrustBar } from '@/components/TrustBar';
import { PartnerLogos } from '@/components/PartnerLogos';
import { JourneyTimeline } from '@/components/JourneyTimeline';
import { FeaturedProgramsSlider } from '@/components/FeaturedProgramsSlider';
import { Testimonials } from '@/components/Testimonials';
import { FAQ } from '@/components/FAQ';
import { KnowledgeCenter } from '@/components/KnowledgeCenter';
import HeroSlider from '@/components/HeroSlider';

const HERO_SLIDES = [
  { src: '/images/hero/hero-1.webp', alt: 'โรงพยาบาลพันธมิตร WOS' },
  { src: '/images/hero/hero-2.webp', alt: 'ทีมแพทย์มืออาชีพ' },
  { src: '/images/hero/hero-3.webp', alt: 'บริการข้ามพรมแดนไทย-ลาว' },
];

export default async function HomePage() {
  const t = await getTranslations('home');
  const tCat = await getTranslations('categories');

  const whyItems = t.raw('why.items') as { title: string; desc: string }[];

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
      {/* ===== HERO ===== */}
      <section className="relative min-h-[70vh] flex items-center overflow-hidden">
        <HeroSlider slides={HERO_SLIDES} />

        <div className="relative z-10 mx-auto max-w-4xl px-4 text-center py-20">
          <span className="inline-block rounded-full bg-white/20 backdrop-blur-sm px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-white">
            {t('hero.badge')}
          </span>
          <h1 className="mt-5 text-3xl font-bold leading-tight text-white md:text-5xl drop-shadow-md">
            {t('hero.title')}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-white/90 drop-shadow-md md:text-lg">
            {t('hero.subtitle')}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a href="#categories" className="btn-primary">
              {t('hero.ctaPrimary')}
            </a>
            <Link
              href="/become-partner"
              className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-white px-8 py-[0.8rem] font-semibold text-white transition-all duration-200 hover:bg-white hover:text-primary"
            >
              {t('hero.ctaSecondary')}
            </Link>
          </div>

          {/* NEW: trust stats under the CTAs */}
          <TrustBar />
        </div>
      </section>

      {/* ===== PARTNER LOGOS (NEW) ===== */}
      <PartnerLogos />

      {/* ===== PATIENT JOURNEY (NEW) ===== */}
      <JourneyTimeline />

      {/* ===== WHY WOS ===== */}
      <section className="section-padding bg-white">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center text-2xl font-bold text-slate-900 md:text-3xl">
            {t('why.title')}
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {whyItems.map((item, i) => (
              <WhyCard
                key={i}
                image={WHY_IMAGES[i]?.image ?? '/images/hero/hero-main.webp'}
                alt={WHY_IMAGES[i]?.alt ?? item.title}
                title={item.title}
                desc={item.desc}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ===== CATEGORIES ===== */}
      <section id="categories" className="section-padding mx-auto max-w-5xl px-4">
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

      {/* ===== FEATURED PROGRAMS SLIDER (NEW) ===== */}
      <FeaturedProgramsSlider packages={featuredPackages} />

      {/* ===== KNOWLEDGE CENTER (replaces old HowItWorks 3-step block) ===== */}
      <KnowledgeCenter />

      {/* ===== TESTIMONIALS (NEW) ===== */}
      <Testimonials />

      {/* ===== FAQ (NEW) ===== */}
      <FAQ />
    </main>
  );
}
