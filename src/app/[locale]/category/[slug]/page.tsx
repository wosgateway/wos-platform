import { getTranslations } from 'next-intl/server';
import { getCategoryBySlug } from '@/lib/categories';
import { fetchPartners } from '@/lib/data';
import { PartnerCard } from '@/components/PartnerCard';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Link } from '@/i18n/navigation';
import { notFound } from 'next/navigation';

export default async function CategoryPage({
  params: { slug },
}: {
  params: { slug: string };
}) {
  const category = getCategoryBySlug(slug);
  if (!category) notFound();

  const tCat = await getTranslations('categories');
  const t = await getTranslations('common');
  const label = tCat(category.slug);
  const partners = await fetchPartners(category.dbCategories);

  return (
    <main>
      <Breadcrumb trail={[{ label }]} />

      <section className="pb-6 pt-4">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 sm:px-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-light text-3xl text-primary">
            {category.icon}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{label}</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {t('partnersCount', { count: partners.length })}
            </p>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {partners.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-400">
              <span className="text-3xl">🔍</span>
              <p className="mt-2">{t('noPartners')}</p>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {partners.map((partner) => (
                <PartnerCard key={partner.id} partner={partner} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="pb-12 text-center">
        <Link href="/services" className="text-sm text-slate-500 transition hover:text-primary">
          {t('helpLink')}
        </Link>
      </section>
    </main>
  );
}
