import { Link } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { LocaleSwitcher } from './LocaleSwitcher';
import { ServicesNavMenu } from './ServicesNavMenu';
import { MobileNavDrawer } from './MobileNavDrawer';

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
 *  - services  -> "/#categories" as a plain link on mobile (desktop swaps
 *                 this for the ServicesNavMenu dropdown, see below);
 *                 same anchor Footer.tsx already uses for its "Explore"
 *                 group — no dedicated /services route exists
 *  - knowledge -> "/knowledge" (article/guide listing). Still also linked
 *                 from Footer's "Explore" group (see Footer.tsx); added
 *                 here too now that mobile has MobileNavDrawer instead of
 *                 the old horizontal scroll row, so an extra row costs
 *                 nothing on mobile and is just one more text link on
 *                 desktop
 *  - myTrip    -> "/my-trip" (order-number lookup page, see
 *                 app/[locale]/my-trip/page.tsx — the actual trip detail
 *                 lives at /my-trip/[orderNumber] which requires an order
 *                 number, so this nav entry points at the new lookup form
 *                 rather than the dynamic route directly)
 *  - partners  -> "/partners" (the directory page that was orphaned)
 *  - contact   -> "/#contact" (Footer's "Connect" column, now anchored)
 *
 * Desktop nav swaps the plain "services" link for ServicesNavMenu.tsx, a
 * dropdown listing every CATEGORIES entry directly (1 click to a category
 * instead of 2: click Services, then scroll to find it on the homepage).
 *
 * Mobile nav is MobileNavDrawer.tsx, a hamburger-triggered side drawer
 * built on the Dialog primitive — replacing the old horizontal
 * overflow-x-auto scroll row this header used before that component
 * existed. Its Services entry is an accordion built from the same
 * CATEGORIES data as ServicesNavMenu, since a drawer has no hover gesture
 * for a floating submenu.
 */
export function Header() {
  const locale = useLocale();
  const t = useTranslations('nav');
  const loginLabel = locale === 'th' ? 'เข้าสู่ระบบ' : 'Log in';

  const navLinks = [
    { href: '/' as const, label: t('home') },
    { href: '/#categories' as const, label: t('services') },
    { href: '/knowledge' as const, label: t('knowledge') },
    { href: '/my-trip' as const, label: t('myTrip') },
    { href: '/partners' as const, label: t('partners') },
    { href: '/#contact' as const, label: t('contact') },
  ];

  // Desktop nav renders Services as the ServicesNavMenu dropdown instead of
  // a plain link, so it's filtered out of this list and inserted manually
  // below. MobileNavDrawer gets the unfiltered navLinks and does its own
  // equivalent filtering internally (it renders Services as an accordion
  // built from the same CATEGORIES data, not this plain anchor).
  const desktopLinks = navLinks.filter((link) => link.href !== '/#categories');

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
          <Link
            href="/"
            className="text-sm font-medium text-slate-600 transition-colors hover:text-primary-dark"
          >
            {t('home')}
          </Link>

          <ServicesNavMenu />

          {desktopLinks
            .filter((link) => link.href !== '/')
            .map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-slate-600 transition-colors hover:text-primary-dark"
              >
                {link.label}
              </Link>
            ))}
        </nav>

        <div className="flex items-center gap-1 sm:gap-3">
          <a
            href="/login"
            className="inline-flex items-center justify-center rounded-full border-2 border-primary px-4 py-1.5 text-sm font-semibold text-primary-dark transition-all duration-200 hover:bg-primary hover:text-white sm:px-5"
          >
            {loginLabel}
          </a>
          <LocaleSwitcher />

          {/* Mobile nav trigger — was previously a horizontal scroll row
              (overflow-x-auto) under the main bar, replaced now that
              MobileNavDrawer exists. Passes the full navLinks; the drawer
              renders Home and Services itself (Services as an accordion)
              and filters those two out of the plain-link list. */}
          <MobileNavDrawer links={navLinks} />
        </div>
      </div>
    </header>
  );
}
