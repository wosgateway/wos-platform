import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatTHB } from '@/lib/format';
import { normalizeImageSrc } from '@/lib/image';
import type { Package } from '@/lib/data';
import { AddToJourneyButton } from '@/components/journey/AddToJourneyButton';

/**
 * STEP 8 — Program Card, redesigned.
 *
 * Parallel to the existing PackageCard.tsx (not a replacement — swap in on
 * the pages that render it only after approval).
 *
 * New on the card, per the brief:
 *  - Verified badge — every partner shown on WOS is already filtered to
 *    status === 'active' at the query level (see fetchPartners in
 *    lib/data.ts), so "on the platform" already means "vetted." The badge
 *    just makes that visible instead of implicit.
 *  - Duration — promoted from a small footer line to a proper metadata
 *    row next to the rating, so it reads at a glance instead of after
 *    the description.
 *  - ★ rating — pulled from pkg.partners.rating / review_count, which
 *    already exist on the Partner type and are already used elsewhere
 *    (see reviewsSuffix in common.json). Hidden gracefully if a partner
 *    has no rating yet.
 *  - "+ Add to My Journey" button — the brief calls for a UI placeholder
 *    here since My Journey state (Step 9) was assumed not built yet. It
 *    already is (lib/journey/context + AddToJourneyButton), so this card
 *    just reuses the real, working button instead of faking one.
 */
export function ProgramCardV2({ pkg }: { pkg: Package }) {
  const t = useTranslations('common');

  const rating = pkg.partners?.rating as number | null | undefined;
  const reviewCount = pkg.partners?.review_count as number | null | undefined;
  const duration = pkg.duration as string | undefined;

  return (
    <div className="card-shadow flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white transition-transform duration-300 ease-out hover:scale-[1.02]">
      <Link href={`/program/${pkg.id}`} className="flex flex-1 flex-col">
        <div className="relative h-36 w-full overflow-hidden bg-slate-100">
          {pkg.image_url ? (
            <Image
              src={normalizeImageSrc(pkg.image_url as string)}
              alt={pkg.title as string}
              fill
              className="object-cover"
              sizes="33vw"
            />
          ) : null}

          <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2">
            <span className="flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[11px] font-semibold text-primary shadow-sm backdrop-blur-sm">
              ✓ {t('verifiedPartner')}
            </span>
            {pkg.is_promotion ? (
              <span className="rounded-full bg-accent px-2 py-1 text-[11px] font-semibold text-white shadow-sm">
                🔥 {t('promotion')}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="font-bold leading-snug text-slate-900">{pkg.title as string}</h3>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {rating ? (
              <span className="flex items-center gap-1 font-medium text-slate-700">
                <span className="text-amber-400">★</span>
                {rating.toFixed(1)}
                {reviewCount ? (
                  <span className="font-normal text-slate-400">
                    ({reviewCount} {t('reviewsSuffix')})
                  </span>
                ) : null}
              </span>
            ) : null}
            {duration ? (
              <span className="flex items-center gap-1">
                <span aria-hidden>⏱</span>
                {duration}
              </span>
            ) : null}
          </div>

          <p className="line-clamp-2 text-sm text-slate-500">
            {(pkg.description as string) || ''}
          </p>

          <div className="mt-auto flex items-end gap-2 pt-2">
            {pkg.special_price ? (
              <span className="text-sm text-slate-400 line-through">
                {formatTHB(pkg.original_price as number)}
              </span>
            ) : null}
            <span className="text-lg font-bold text-primary">
              {formatTHB((pkg.special_price as number) || (pkg.original_price as number))}
            </span>
          </div>
        </div>
      </Link>

      {/* Deliberately outside the <Link>/<a> above — a <button> nested
          inside an anchor is invalid HTML and browsers can silently
          hoist it out of the DOM tree, breaking the click handler. */}
      <div className="px-4 pb-4">
        <AddToJourneyButton pkg={pkg} variant="compact" />
      </div>
    </div>
  );
}
