import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { fetchPartnerById, fetchPackagesByPartner } from '@/lib/data';
import { CATEGORIES } from '@/lib/categories';
import { Breadcrumb } from '@/components/Breadcrumb';
import { PartnerGallery } from '@/components/PartnerGallery';
import { PackagesGrid } from '@/components/PackagesGrid';

export default async function PartnerDetailPage({
  params: { id },
}: {
  params: { id: string };
}) {
  const t = await getTranslations('common');
  const tCat = await getTranslations('categories');

  let partner;
  try {
    partner = await fetchPartnerById(id);
  } catch {
    notFound();
  }
  if (!partner) notFound();

  const packages = await fetchPackagesByPartner(id);

  const images = [
    partner.cover_image_url,
    ...(((partner.gallery_urls as string[]) || [])),
  ].filter(Boolean) as string[];
  if (images.length === 0) images.push('/images/hero/hero-main.webp');

  const category = CATEGORIES.find((c) => c.dbCategories.includes(partner.category));
  const categoryLabel = category ? tCat(category.slug) : partner.category;

  return (
    <main>
      <Breadcrumb
        trail={[
          ...(category
            ? [{ href: `/category/${category.slug}`, label: categoryLabel }]
            : []),
          { label: partner.name },
        ]}
      />

      <section className="pt-6">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <PartnerGallery images={images} alt={partner.name} />

          <div className="mb-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-primary-dark">
                {categoryLabel}
              </span>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">
                {partner.name}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                📍 {(partner.province as string) || '-'}
              </p>
            </div>
            <span className="rounded-full bg-primary-light px-3 py-1 text-base font-semibold text-primary-dark">
              ⭐ {partner.rating ?? '-'}
            </span>
          </div>
          <p className="mt-3 max-w-3xl leading-relaxed text-slate-600">
            {(partner.description as string) || ''}
          </p>
        </div>
      </section>

      <section className="section-padding !pt-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <PackagesGrid packages={packages} />

          <div className="mt-10 text-center">
            {/* เดิมชี้ไป /services (ไม่มี route นี้จริง) — เปลี่ยนเป็น LINE OA
                ให้ตรงกับที่แก้ไว้แล้วในหน้า category/[slug]/page.tsx */}
            <a
              href="https://line.me/ti/p/@vlf9996z"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm text-slate-500 transition hover:text-primary-dark"
            >
              {t('helpLink')}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
