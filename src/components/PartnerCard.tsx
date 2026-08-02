import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { normalizeImageSrc } from '@/lib/image';
import type { Partner } from '@/lib/data';

export function PartnerCard({ partner }: { partner: Partner }) {
  const t = useTranslations('common');
  const cover = normalizeImageSrc(partner.cover_image_url as string | null);
  const reviewCount = partner.review_count as number | null | undefined;

  return (
    <Link
      href={`/partner/${partner.id}`}
      className="card-shadow group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white"
    >
      <div className="relative h-40 w-full">
        <Image src={cover} alt={partner.name} fill className="object-cover" sizes="33vw" />
        {/* ที่อยู่ ย้ายมาเป็น badge ทับรูปมุมขวาบน แทนบรรทัดข้อความใต้ชื่อ */}
        <span className="absolute right-3 top-3 rounded-md bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-md">
          📍 {(partner.province as string) || '-'}
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-between p-4">
        <h3 className="font-bold leading-snug text-slate-900 group-hover:text-primary">
          {partner.name}
        </h3>

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-xs font-semibold text-amber-600">
            ⭐ {partner.rating ?? '-'}
            {reviewCount ? ` (${reviewCount}+ ${t('reviewsSuffix')})` : ''}
          </span>
          {/* ปุ่ม CTA แยกเป็น visual element ชัดเจน แม้ทั้งการ์ดจะคลิกได้อยู่แล้ว
              (span แทน <a> ซ้อนใน <Link> เพื่อไม่ให้ nested-anchor ผิด HTML spec) */}
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary transition group-hover:gap-1.5">
            {t('viewPackagesAndBook')} →
          </span>
        </div>
      </div>
    </Link>
  );
}
