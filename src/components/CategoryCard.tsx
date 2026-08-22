import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import type { Category } from '@/lib/categories';

export function CategoryCard({ category, label }: { category: Category; label: string }) {
  return (
    <Link
      href={`/category/${category.slug}`}
      className="card-shadow group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white"
    >
      <div className="relative h-36 w-full overflow-hidden">
        <Image
          src={category.image}
          alt={label}
          fill
          className="object-cover transition-transform duration-300 group-hover:scale-105"
          sizes="(max-width: 768px) 100vw, 33vw"
        />
      </div>
      <div className="flex items-center gap-3 p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-medicalBlue/10 text-medicalBlue">
          <category.icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="text-lg font-bold text-slate-900">{label}</span>
      </div>
    </Link>
  );
}
