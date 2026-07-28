import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from './LocaleSwitcher';

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-100/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-1 text-2xl font-bold tracking-tight text-primary"
        >
          WOS<span className="align-top text-base font-light text-accent">.os</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}
