import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatTHB } from '@/lib/format';
import { normalizeImageSrc } from '@/lib/image';
import type { Package } from '@/lib/data';
import { AddToJourneyButton } from '@/components/journey/AddToJourneyButton';

export function PackageCard({ pkg }: { pkg: Package }) {
  const t = useTranslations('common');

  return (
    <div className="card-shadow flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white p-4">
      <Link href={`/program/${pkg.id}`} className="flex flex-col gap-2">
        {pkg.image_url ? (
          <div className="relative -mt-1 h-32 w-full overflow-hidden rounded-xl">
            <Image
              src={normalizeImageSrc(pkg.image_url as string)}
              alt={pkg.title as string}
              fill
              className="object-cover"
              sizes="33vw"
            />
          </div>
        ) : null}
        {pkg.is_promotion ? (
          <span className="w-fit rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
            🔥 {t('promotion')}
          </span>
        ) : null}
        <h3 className="font-bold text-slate-900">{pkg.title as string}</h3>
        <p className="line-clamp-2 text-sm text-slate-500">{(pkg.description as string) || ''}</p>
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
        {pkg.duration ? (
          <span className="text-xs text-slate-400">⏱ {pkg.duration as string}</span>
        ) : null}
      </Link>

      {/* Deliberately outside the <Link>/<a> above — a <button> nested
          inside an anchor is invalid HTML and browsers can silently
          hoist it out of the DOM tree, breaking the click handler. */}
      <AddToJourneyButton pkg={pkg} variant="compact" />
    </div>
  );
}
