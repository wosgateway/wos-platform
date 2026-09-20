import { getTranslations } from 'next-intl/server';
import { ArrowRight, Stethoscope } from 'lucide-react';
import { Link } from '@/i18n/navigation';

/**
 * ConsultationCTA — bottom-of-homepage banner for the free consultation
 * form (Phase 3 of "ปรึกษา WOS ฟรี", see src/app/[locale]/consultation).
 *
 * Sibling to HeroV2's third CTA link (top of page, ?source=homepage_hero):
 * this is the ?source=homepage_bottom counterpart — a visitor who scrolled
 * through the whole homepage without converting on a category/package
 * still gets one more, low-friction "just talk to someone" option before
 * they leave.
 *
 * Copy reuses the `consultation` message namespace (shared with the form
 * page itself) rather than a separate `home.*` key, so the banner's
 * headline/subtext and the form page's headline/subtext can't drift out
 * of sync — bannerTitle/bannerDescription/cta are the only keys unique to
 * this component; everything else about the feature's wording lives in
 * one place.
 */
export async function ConsultationCTA() {
  const t = await getTranslations('consultation');

  return (
    <section className="section-padding bg-navy">
      <div className="mx-auto max-w-4xl px-4 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold/10 border border-gold/30">
          <Stethoscope className="h-6 w-6 text-gold" strokeWidth={1.75} aria-hidden="true" />
        </span>

        <span className="mt-6 inline-block text-xs font-semibold uppercase tracking-wider text-gold">
          {t('bannerEyebrow')}
        </span>
        <h2 className="mt-3 text-h2 text-white">{t('bannerTitle')}</h2>
        <p className="mx-auto mt-3 max-w-xl text-body-lg text-white/70">{t('bannerDescription')}</p>

        <Link
          href="/consultation?source=homepage_bottom"
          className="group mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-gold px-8 py-[0.85rem] font-semibold text-navy-dark transition-all duration-200 hover:bg-gold-dark hover:scale-[1.01]"
        >
          {t('cta')}
          <ArrowRight
            className="h-4 w-4 transition-transform duration-200 ease-out group-hover:translate-x-1"
            strokeWidth={2.25}
            aria-hidden="true"
          />
        </Link>
      </div>
    </section>
  );
}
