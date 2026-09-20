import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import HeroBackgroundSlideshow, { type HeroImage } from '@/components/HeroBackgroundSlideshow';
import { TrustBar } from '@/components/TrustBar';
import { fetchActivePartnerCount } from '@/lib/data';

/**
 * HeroV2 — WOS.os rebrand hero.
 *
 * Background photo sits on the right-hand side (desktop only), faded into
 * navy on its left edge so the copy panel on the left stays readable. Pass
 * 2–3 images to `images` and they crossfade automatically (see
 * HeroBackgroundSlideshow) — pass a single-item array to keep one static
 * photo.
 *
 * Image requirements (see also the comment on the <Image> below):
 * - Subject should be centered horizontally (x ≈ 50%) in the source file,
 *   and already facing/leaning LEFT (into the copy panel) — no mirror
 *   transform is applied, so the source file is used exactly as-is.
 * - Recommended size: same aspect ratio as hero-2-centered.webp (1900x1536,
 *   ~1.24:1) or taller/narrower. Minimum ~1200px wide, ~1536px tall so it
 *   still looks sharp on large desktop screens.
 * - Format: .webp (or .jpg/.png, but .webp is smallest for this much detail).
 * - All images in the set should share roughly the same subject framing
 *   (same crop convention below) since they're shown with one shared
 *   `objectPosition`.
 *
 * Copy (eyebrow/title/subtitle/CTAs) lives entirely in home.heroV2.* per
 * locale (th/en/lo) — no hardcoded text in this component.
 *
 * FINAL (2026-09) — this is the version to ship. Replaces the older
 * src/components/HeroV2.tsx that rendered <WOSNetworkDiagram /> in a
 * right-hand grid column: that diagram was explicitly dropped per the
 * TrustBar Step 12/13 review ("ไม่ต้องใส่ diagram กลับมาแล้วครับ" — Hero
 * structure agreed as photo → short copy → CTA → trust signal, nothing
 * else). CTA row here is a 2-button pairing (consultation = solid
 * primary, browse-programs = outline secondary) matching the pairing
 * Header.tsx's own consultation CTA comment describes, instead of the
 * old 3-button row. All t() keys used below (including `ctaHint`) exist
 * in th/en/lo.json home.heroV2 — verified against the live message
 * files before this was finalized.
 */
export default async function HeroV2({ images }: { images: HeroImage[] }) {
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
      {/* Background photo (crossfades through `images` if more than one is
          passed). object-[78%_18%] keeps the subject anchored near the top
          third, leaning right — adjust if a new source photo frames the
          subject elsewhere; all images in the set share this crop.
          Gradient: solid navy through ~20%, then a smooth multi-stop taper
          (rather than one abrupt fade) down to fully transparent by ~72%,
          left-to-right, so the photo reads clearly on the right while the
          copy panel on the left stays legible. */}
      <div className="absolute inset-y-0 right-0 hidden w-[55%] lg:block">
        <HeroBackgroundSlideshow images={images} objectPosition="78% 18%" sizes="55vw" priority />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, #0B1E3D 0%, #0B1E3D 20%, rgba(11,30,61,0.9) 32%, rgba(11,30,61,0.68) 42%, rgba(11,30,61,0.42) 52%, rgba(11,30,61,0.2) 62%, rgba(11,30,61,0.06) 70%, rgba(11,30,61,0) 78%)',
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
            <HeroBackgroundSlideshow
              images={images}
              objectPosition="78% 18%"
              sizes="(max-width: 1023px) 100vw, 0vw"
              priority
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
          <div className="flex items-center gap-3.5">
            <span aria-hidden="true" className="h-px w-11 shrink-0 bg-gold/75" />
            <span className="break-words text-xs font-semibold uppercase tracking-[0.22em] text-gold">
              {t('eyebrow')}
            </span>
          </div>

          <h1 className="mt-6 break-words text-h1 text-white">{t('title')}</h1>

          <p className="mt-5 max-w-lg break-words text-body-lg text-white/80">{t('subtitle')}</p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            {/* Primary CTA — promoted to solid gold (2026-09 redesign) so the
                consultation path reads as the default next step, not a
                footnote. Same route/query as before (?source=homepage_hero
                still matches the SOURCES allowlist in
                src/app/api/consultation/route.ts), just re-ranked visually. */}
            <Link
              href="/consultation?source=homepage_hero"
              className="inline-flex items-center justify-center rounded-full bg-gold px-8 py-[0.85rem] font-semibold text-navy-dark transition-all duration-200 hover:bg-gold-dark hover:-translate-y-px"
            >
              {t('ctaConsultation')}
            </Link>
            {/* Secondary CTA — demoted to outline; still the "browse programs
                yourself" path for people who don't want to talk to anyone
                first. Copy comes from home.heroV2.ctaPrimary (unchanged). */}
            <a
              href="#categories"
              className="inline-flex items-center justify-center rounded-full border-2 border-white/70 px-8 py-[0.8rem] font-semibold text-white transition-all duration-200 hover:bg-white hover:text-navy"
            >
              {t('ctaPrimary')}
            </a>
          </div>

          {/* Small reassurance line under the CTA row, nudging undecided
              visitors toward the (now-primary) consultation CTA above. */}
          <p className="mt-3 text-sm text-white/60">{t('ctaHint')}</p>

          {/* Partner CTA — demoted from a full-size pill to a small inline
              text link (brief: de-emphasize, don't remove or change href). */}
          <Link
            href="/partner"
            className="mt-2 inline-block text-sm font-medium text-white/70 underline decoration-white/30 underline-offset-4 transition-colors hover:text-gold hover:decoration-gold/60"
          >
            {t('ctaSecondary')}
          </Link>

          <TrustBar align="left" partnerCount={partnerCount} />
        </div>
        {/* No right-column element on desktop anymore — the background
            photo (absolutely positioned above) fills that half of the
            section on its own. The grid's second track is intentionally
            left empty so the copy column keeps its half-width measure. */}
      </div>
    </section>
  );
}
