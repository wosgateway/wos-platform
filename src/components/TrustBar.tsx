import { useTranslations } from 'next-intl';

export function TrustBar() {
  const t = useTranslations('home.trustBar');
  const items = t.raw('items') as { value: string; label: string }[];

  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-white/15 bg-slate-950/35 px-5 py-3 text-center backdrop-blur-md sm:px-7"
        >
          <p className="text-2xl font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)] md:text-3xl">
            {item.value}
          </p>
          <p className="mt-0.5 whitespace-nowrap text-xs font-medium text-white/85 drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
            {item.label}
          </p>
        </div>
      ))}
    </div>
  );
}
