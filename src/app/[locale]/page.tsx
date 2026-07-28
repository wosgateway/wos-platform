import { useTranslations } from 'next-intl';
import { CATEGORIES } from '@/lib/categories';
import { CategoryCard } from '@/components/CategoryCard';

export default function HomePage() {
  const t = useTranslations('home');
  const tCat = useTranslations('categories');

  return (
    <main className="section-padding mx-auto max-w-5xl px-4">
      <div className="mb-10 text-center">
        <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">{t('heroTitle')}</h1>
        <p className="mt-2 text-slate-500">{t('heroSubtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((category) => (
          <CategoryCard key={category.slug} category={category} label={tCat(category.slug)} />
        ))}
      </div>
    </main>
  );
}
