import { useTranslations } from 'next-intl';

export function TrustBar() {
  const t = useTranslations('home.trustBar');
  const items = t.raw('items') as { value: string; label: string }[];

  return (
    <div className="mt-10 flex flex-wrap items-center justify-center">
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center">
          <div className="px-5 py-1 text-center sm:px-8">
            <p className="text-2xl font-bold text-primary md:text-3xl">{item.value}</p>
            <p className="mt-0.5 whitespace-nowrap text-xs text-slate-500">{item.label}</p>
          </div>
          {i < items.length - 1 && (
            <span className="hidden h-8 w-px bg-slate-200 sm:block" aria-hidden />
          )}
        </div>
      ))}
    </div>
  );
}
