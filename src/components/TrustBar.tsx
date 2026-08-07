import { useTranslations } from 'next-intl';

export function TrustBar() {
  const t = useTranslations('home.trustBar');
  const items = t.raw('items') as { value: string; label: string }[];

  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-white/10 bg-slate-900/80 px-5 py-3 text-center backdrop-blur-md sm:px-7"
        >
          <p className="text-2xl font-bold text-emerald-400 md:text-3xl">
            {item.value}
          </p>
          <p className="mt-0.5 whitespace-nowrap text-xs font-medium text-white">
            {item.label}
          </p>
        </div>
      ))}
    </div>
  );
}
