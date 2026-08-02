import { useTranslations } from 'next-intl';

/**
 * Signature element of the redesign: the patient's route is drawn as a
 * dashed line (borrowed from a map/route line, since WOS is literally
 * about crossing a border) connecting numbered stops. This is a real
 * sequence — order carries meaning here — so numbering is justified.
 */
export function JourneyTimeline() {
  const t = useTranslations('home.journey');
  const steps = t.raw('steps') as { icon: string; title: string; desc: string }[];

  return (
    <section className="section-padding bg-primary-light/40">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">{t('title')}</h2>
          <p className="mt-2 text-slate-500">{t('subtitle')}</p>
        </div>

        <div className="relative mt-14">
          {/* route line, desktop only */}
          <div
            className="pointer-events-none absolute left-0 right-0 top-6 hidden h-px bg-[repeating-linear-gradient(90deg,#0d7c66_0_8px,transparent_8px_16px)] opacity-40 md:block"
            aria-hidden
          />
          <ol className="relative grid grid-cols-1 gap-y-10 md:grid-cols-6 md:gap-x-2 md:gap-y-0">
            {steps.map((step, i) => (
              <li key={step.title} className="relative flex flex-col items-center text-center">
                <div className="z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-white text-lg">
                  <span aria-hidden>{step.icon}</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-900">{step.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{step.desc}</p>
                {i < steps.length - 1 && (
                  <span className="mt-3 block h-6 w-px bg-primary/30 md:hidden" aria-hidden />
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
