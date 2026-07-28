import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { fetchPackageById } from '@/lib/data';
import { formatTHB } from '@/lib/format';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Link } from '@/i18n/navigation';

export default async function ProgramDetailPage({
  params: { id },
}: {
  params: { id: string };
}) {
  const t = await getTranslations('common');

  let pkg;
  try {
    pkg = await fetchPackageById(id);
  } catch {
    notFound();
  }
  if (!pkg) notFound();

  const partner = pkg.partners;
  const image = (pkg.image_url as string) || partner?.cover_image_url || '/images/hero/hero-main.webp';

  return (
    <main>
      <Breadcrumb
        trail={[
          ...(partner ? [{ href: `/partner/${partner.id}`, label: partner.name }] : []),
          { label: pkg.title as string },
        ]}
      />

      <section className="pt-6">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="relative mb-6 h-64 w-full overflow-hidden rounded-3xl shadow-xl card-shadow sm:h-80">
            <Image src={image} alt={pkg.title as string} fill className="object-cover" priority sizes="100vw" />
          </div>

          <div className="mb-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              {partner ? (
                <Link
                  href={`/partner/${partner.id}`}
                  className="text-sm font-semibold text-primary hover:text-primary-dark"
                >
                  {partner.name}
                </Link>
              ) : null}
              <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
                {pkg.title as string}
              </h1>
            </div>
            {pkg.is_promotion ? (
              <span className="rounded-full bg-accent/10 px-3 py-1 text-sm font-semibold text-accent">
                🔥 {t('promotion')}
              </span>
            ) : null}
          </div>

          <p className="mt-3 max-w-2xl leading-relaxed text-slate-600">
            {(pkg.description as string) || ''}
          </p>

          <div className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-100 bg-white p-5 card-shadow">
            <div>
              {pkg.special_price ? (
                <span className="block text-sm text-slate-400 line-through">
                  {formatTHB(pkg.original_price as number)}
                </span>
              ) : null}
              <span className="text-2xl font-bold text-primary">
                {formatTHB((pkg.special_price as number) || (pkg.original_price as number))}
              </span>
            </div>
            {pkg.duration ? (
              <span className="ml-auto text-sm text-slate-400">⏱ {pkg.duration as string}</span>
            ) : null}
          </div>

          <div className="mt-8">
            <Link
              href={`/booking/${pkg.id}`}
              className="btn-primary w-full justify-center text-base sm:w-auto"
            >
              {t('bookNow')}
            </Link>
          </div>

          <div className="mt-10 text-center">
            <Link
              href="/services"
              className="inline-block text-sm text-slate-500 transition hover:text-primary"
            >
              {t('helpLink')}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
