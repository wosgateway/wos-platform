import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import type { Partner } from '@/lib/data';

export function PartnerCard({ partner }: { partner: Partner }) {
  const cover = (partner.cover_image_url as string) || '/images/hero/hero-main.webp';

  return (
    <Link
      href={`/partner/${partner.id}`}
      className="card-shadow flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white"
    >
      <div className="relative h-40 w-full">
        <Image src={cover} alt={partner.name} fill className="object-cover" sizes="33vw" />
      </div>
      <div className="p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="font-bold leading-snug text-slate-900">{partner.name}</h3>
        </div>
        <p className="mb-2 text-sm text-slate-500">
          📍 {(partner.province as string) || '-'}
        </p>
        <span className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-semibold text-primary">
          ⭐ {partner.rating ?? '-'}
        </span>
      </div>
    </Link>
  );
}
