import { useTranslations } from 'next-intl';

/**
 * PLACEHOLDER TREATMENT: showing partner names as text badges, not logos.
 * Swap each <span> for an <Image src={logo} /> once you have written
 * permission from each hospital/hotel to display their brand mark.
 * Keep the same wrapper layout (flex-wrap, gap-3) so the swap is a
 * one-line change per item.
 */
export function PartnerLogos() {
  const t = useTranslations('home.partners');
  const names = t.raw('names') as string[];

  return (
    <section className="border-y border-slate-100 bg-slate-50/60 py-8">
      <div className="mx-auto max-w-5xl px-4">
        <p className="text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
          {t('label')}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {names.map((name) => (
            <span
              key={name}
              className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:border-primary/30 hover:text-primary"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
