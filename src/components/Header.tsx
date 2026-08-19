import { Link } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { LocaleSwitcher } from './LocaleSwitcher';

/**
 * STEP: Header nav restored.
 *
 * Previously this header had no nav links at all — nav.home/services/
 * partners/contact existed in every locale's messages file but were only
 * ever read by Breadcrumb, never rendered as an actual menu. Worst
 * consequence: /partners (the full partner directory, PartnerDirectory.tsx)
 * had zero inbound links anywhere on the site.
 *
 * Targets:
 *  - home      -> "/"
 *  - services  -> "/#categories" (same anchor pattern Footer.tsx already
 *                 uses for its "Explore" group — no dedicated /services
 *                 route exists)
 *  - partners  -> "/partners" (the directory page that was orphaned)
 *  - contact   -> "/#contact" (Footer's "Connect" column, now anchored)
 */
export function Header() {
  const locale = useLocale();
  const t = useTranslations('nav');
  const loginLabel = locale === 'th' ? 'เข้าสู่ระบบ' : 'Log in';

  const navLinks = [
    { href: '/' as const, label: t('home') },
    { href: '/#categories' as const, label: t('services') },
    { href: '/partners' as const, label: t('partners') },
    { href: '/#contact' as const, label: t('contact') },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-slate-100/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-1 text-2xl font-bold tracking-tight text-primary-dark"
        >
          WOS<span className="align-top text-base font-light text-accent-ink">.os</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-primary-dark"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href="/login"
            className="inline-flex items-center justify-center rounded-full border-2 border-primary px-4 py-1.5 text-sm font-semibold text-primary-dark transition-all duration-200 hover:bg-primary hover:text-white sm:px-5"
          >
            {loginLabel}
          </a>
          <LocaleSwitcher />
        </div>
      </div>

      {/* Mobile nav — icon-free horizontal scroll row under the main bar,
          since there's no hamburger/drawer component in this codebase yet
          to hang these links off of on small screens. */}
      <nav className="flex items-center gap-5 overflow-x-auto border-t border-slate-100 px-4 py-2 text-sm font-medium text-slate-600 sm:px-6 md:hidden">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="whitespace-nowrap transition-colors hover:text-primary-dark"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
