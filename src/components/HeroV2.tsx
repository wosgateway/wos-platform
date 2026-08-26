import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import WOSNetworkDiagram from '@/components/WOSNetworkDiagram';
import { TrustBar } from '@/components/TrustBar';
import { fetchActivePartnerCount } from '@/lib/data';

/**
 * HeroV2 — WOS.os rebrand hero.
 *
 * Background photo sits on the right-hand side (desktop only), faded into
 * navy on its left edge so the copy panel on the left stays readable.
 *
 * Image requirements (see also the comment on the <Image> below):
 * - Subject should be centered horizontally (x ≈ 50%) in the source file,
 *   and already facing/leaning LEFT (into the copy panel) — no mirror
 *   transform is applied, so the source file is used exactly as-is.
 * - Recommended size: same aspect ratio as hero-2-centered.webp (1900x1536,
 *   ~1.24:1) or taller/narrower. Minimum ~1200px wide, ~1536px tall so it
 *   still looks sharp on large desktop screens.
 * - Format: .webp (or .jpg/.png, but .webp is smallest for this much detail).
 *
 * Copy (eyebrow/title/subtitle/CTAs) lives entirely in home.heroV2.* per
 * locale (th/en/lo) — no hardcoded text in this component.
 */
export default async function HeroV2({ image }: { image: { src: string; alt: string } }) {
  const t = await getTranslations('home.heroV2');

  // Live partner count for the trust bar — see TrustBar.tsx and
  // fetchActivePartnerCount in src/lib/data.ts. Same defensive pattern as
  // fetchFeaturedPackages in page.tsx: never let this query break the
  // whole hero section, just fall back to no count (TrustBar renders the
  // plain noun without a number in that case).
  let partnerCount: number | undefined;
  try {
    partnerCount = await fetchActivePartnerCount();
  } catch (err) {
    console.error('fetchActivePartnerCount failed', err);
  }

  return (
    <section className="relative overflow-hidden bg-navy">
      {/* Background photo. object-[50%_23%] keeps the subject's head centered
          horizontally and anchored near the top third vertically — adjust the
          y value if a new source photo frames the subject higher/lower.
          Gradient: solid navy 0–22%, fading to fully transparent by 58%,
          left-to-right, so the photo reads clearly on the right while the
          copy panel on the left stays legible. */}
      <div className="absolute inset-y-0 right-0 hidden w-[55%] lg:block">
        <Image
          src={image.src}
          alt={image.alt}
          fill
          priority
          className="object-cover object-[78%_18%]"
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
        {/* ===== Mobile/tablet photo card =====
            Below `lg` the absolute full-bleed background photo above is
            hidden entirely, so this card is the only hero image shown on
            phones/tablets — matches the novapersona reference (photo as a
            rounded card with a floating stat badge on its corner) without
            touching the existing desktop treatment. `mb-6` on the wrapper
            leaves room for the badge, which overhangs the bottom edge. */}
        <div className="relative mx-auto mb-6 w-full max-w-md lg:hidden">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl shadow-xl shadow-black/30">
            <Image
              src={image.src}
              alt={image.alt}
              fill
              priority
              className="object-cover object-[78%_18%]"
              sizes="(max-width: 1023px) 100vw, 0vw"
            />
          </div>
          {partnerCount !== undefined && (
            <div className="absolute -bottom-5 left-5 flex items-center gap-2 rounded-2xl border border-gold/20 bg-navy px-4 py-3 shadow-lg">
              <span className="text-h4 font-bold text-gold">{partnerCount}+</span>
              <span className="max-w-[7rem] text-xs leading-tight text-white/70">{t('badge')}</span>
            </div>
          )}
        </div>

        {/* ===== Left: copy ===== */}
        <div className="min-w-0 max-w-xl">
          <span className="inline-block break-words rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-gold">
            {t('eyebrow')}
          </span>

          <h1 className="mt-6 break-words text-h1 text-white">{t('title')}</h1>

          <p className="mt-5 max-w-lg break-words text-body-lg text-white/80">{t('subtitle')}</p>

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

          <TrustBar align="left" partnerCount={partnerCount} />
        </div>

        {/* ===== Right: WOS network diagram =====
            Gentle float on the whole diagram — motion-safe only (skipped
            automatically under prefers-reduced-motion) — layered on top of
            the diagram's own internal pulse/line-flow motion. Positioned
            (mt-10) so it sits clear of the subject's head in the photo
            behind it. */}
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
