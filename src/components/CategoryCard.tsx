import { Link } from '@/i18n/navigation';
import type { Category } from '@/lib/categories';
import { CategoryCardImage } from './CategoryCardImage';

/**
 * CategoryCard — server component (no 'use client' here).
 *
 * `category.icon` is a lucide-react component reference — it has to stay
 * on the server side of the tree, since function/class values can't be
 * passed as props into a Client Component. Only the image needs the
 * hover/scroll zoom interactivity, so that part alone is split out into
 * CategoryCardImage ('use client'), which receives just plain strings.
 * See that file's header for the full explanation.
 */
export function CategoryCard({ category, label }: { category: Category; label: string }) {
  return (
    <Link
      href={`/category/${category.slug}`}
      className="card-shadow group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white"
    >
      <CategoryCardImage src={category.image} alt={label} />
      <div className="flex items-center gap-3 p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-medicalBlue/10 text-medicalBlue">
          <category.icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="text-lg font-bold text-slate-900">{label}</span>
      </div>
    </Link>
  );
}
