import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import WOSNetworkDiagram from '@/components/WOSNetworkDiagram';
import { TrustBar } from '@/components/TrustBar';

/**
 * HeroV2 — WOS.os rebrand hero (Step 2 of the homepage rebuild).
 *
 * Parallel component: built alongside the existing <HeroSlider> + hero markup
 * in page.tsx so both can be compared side by side via /[locale]/_preview/hero-v2
 * before anything gets swapped into the real homepage. Does not replace or
 * modify HeroSlider.tsx or the current hero section in page.tsx.
 *
 * Uses the Step 1 design tokens (navy / medicalBlue / gold, text-h1/h2/h3/body-lg)
 * defined in tailwind.config.ts. Copy comes from home.heroV2.* in the message
 * files (th/en/lo) — separate namespace from home.hero.* so the current hero's
 * copy is untouched.
 *
 * v3: primary CTA arrow switched from a literal "→" text glyph to the
 * lucide-react ArrowRight icon (font-fallback mojibake fix).
 *
 * v4: float-animation wrapper around <WOSNetworkDiagram /> given h-full w-full
 * so it doesn't shrink-to-fit and collapse the diagram.
 *
 * v5: Hero repositioning per the "WOS HOMEPAGE — HERO REPOSITIONING v1.0" brief.
 * Copy (eyebrow/title/subtitle/CTAs) now lives entirely in home.heroV2.* per
 * locale — no hardcoded text here. Secondary CTA changed from "Explore
 * Programs" (-> /category, which 404s — there's no /category index route,
 * only /category/[slug]) to "Become a Partner" (-> /partner/apply), matching
 * the brief's repositioned CTA pair: primary = find care, secondary = partner
 * signup. ASSUMPTION: /partner/apply is the correct destination, same as the
 * partner page's own CTA — flag if that's wrong.
 *
 * v6: <TrustBar /> re-attached under the CTAs. It used to live inside the
 * old <HeroSlider>, which never got swapped out for HeroV2 on the homepage
 * — so the stat row (patients/month, verified partners, support hours,
 * countries, count-up animation and all) silently disappeared from the
 * live site even though its copy (home.trustBar.*) was still fully wired
 * in every locale. No translation changes needed, just re-plugging it in.
 *
 * v8: secondary CTA now goes to /partner instead of /partner/apply.
 * Resolves the v5 ASSUMPTION flag above — going straight to the form
 * skipped the actual partner landing page (why-partner, partner types,
 * how-it-works, terms, etc. — see app/[locale]/partner/page.tsx), which
 * is where its own CTA already sends people to /partner/apply from.
 */
export default function HeroV2({ image }: { image: { src: string; alt: string } }) {
  const t = useTranslations('home.heroV2');

  return (
    <section className="relative overflow-hidden bg-navy">
      {/* Background photo, right-hand side only, faded into navy so text stays readable
          v7: hero repositioning fixes —
          1) object-[85%_15%] anchors the crop toward the top-right of the frame — pulls the
             subject's head up out of the crop area instead of the previous object-right,
             which only fixed the X axis and left the default (center) Y crop. Nudge the Y
             value down further (e.g. 20%, 25%) if the head is still tight to the top edge
             once checked against the real image.
          2) gradient stops narrowed further — solid navy only to 22%, fully transparent by
             58% (was 35% / 70%) — to open up more of the photo on the right. */}
      <div className="absolute inset-y-0 right-0 hidden w-[55%] lg:block">
        <Image
          src={image.src}
          alt={image.alt}
          fill
          priority
          className="object-cover object-[85%_15%]"
          sizes="55vw"
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, #0B1E3D 0%, #0B1E3D 22%, rgba(11,30,61,0.8) 38%, rgba(11,30,61,0) 58%)',
          }}
        />
      </div>
      {/* Subtle navy wash on mobile/tablet where there's no side photo */}
      <div className="absolute inset-0 bg-gradient-to-b from-navy via-navy to-navy-dark lg:hidden" />

      <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-12 px-4 py-20 md:py-28 lg:grid-cols-2 lg:items-center">
        {/* ===== Left: copy ===== */}
        <div className="max-w-xl">
          <span className="inline-block rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-gold">
            {t('eyebrow')}
          </span>

          <h1 className="mt-6 text-h1 text-white">{t('title')}</h1>

          <p className="mt-5 max-w-lg text-body-lg text-white/80">{t('subtitle')}</p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <a
              href="#categories"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-gold px-8 py-[0.85rem] font-semibold text-navy-dark transition-all duration-200 hover:bg-gold-dark hover:scale-[1.01]"
            >
              {t('ctaPrimary')}
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 ease-out group-hover:translate-x-1"
                strokeWidth={2.25}
                aria-hidden="true"
              />
            </a>
            <Link
              href="/partner"
              className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-white/70 px-8 py-[0.8rem] font-semibold text-white transition-all duration-200 hover:bg-white hover:text-navy"
            >
              {t('ctaSecondary')}
            </Link>
          </div>

          <TrustBar align="left" />
        </div>

        {/* ===== Right: WOS network diagram (Step 4) =====
            STEP 11: gentle float on the whole diagram — motion-safe: only
            (skipped automatically under prefers-reduced-motion), on top of
            the diagram's own internal pulse/line-flow motion.
            v7: since the photo now anchors the subject's head near the TOP of the frame
            (object-[85%_15%] above), shifted this block down (mt-10) so the diagram's
            circle sits lower, clear of the head, and tightened the float amplitude
            (-14px -> -8px) so it doesn't drift back up into that area on each cycle. */}
        <div
          data-network-slot
          className="relative mx-auto mt-10 hidden w-full max-w-md items-center justify-center lg:flex"
          style={{ aspectRatio: '1 / 1' }}
        >
          <style>{`
            @keyframes wos-hero-float {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-8px); }
            }
          `}</style>
          <div className="h-full w-full motion-safe:animate-[wos-hero-float_6s_ease-in-out_infinite]">
            <WOSNetworkDiagram centerSubLabel={t('badge')} />
          </div>
        </div>
      </div>
    </section>
  );
}