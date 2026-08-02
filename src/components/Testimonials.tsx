import { useTranslations } from 'next-intl';

/**
 * PLACEHOLDER CONTENT: the quotes in messages/th.json are sample copy,
 * not real patients. Do not launch with these — swap in real reviews
 * only after getting explicit consent (this is health-related personal
 * data, PDPA applies). Consider a short name + region instead of a
 * full name if the patient prefers privacy.
 */
export function Testimonials() {
  const t = useTranslations('home.testimonials');
  const items = t.raw('items') as { quote: string; name: string; meta: string }[];

  return (
    <section className="section-padding bg-white">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="text-center text-2xl font-bold text-slate-900 md:text-3xl">
          {t('title')}
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
          {items.map((item) => (
            <figure
              key={item.name}
              className="card-shadow flex flex-col rounded-2xl border border-slate-100 bg-white p-6"
            >
              <span className="text-3xl leading-none text-primary/20" aria-hidden>
                “
              </span>
              <blockquote className="-mt-2 flex-1 text-sm leading-relaxed text-slate-600">
                {item.quote}
              </blockquote>
              <figcaption className="mt-4 border-t border-slate-100 pt-3 text-sm">
                <span className="font-semibold text-slate-900">{item.name}</span>
                <span className="ml-1.5 text-slate-400">· {item.meta}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
