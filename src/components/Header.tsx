import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { LocaleSwitcher } from './LocaleSwitcher';
import { ServicesNavMenu } from './ServicesNavMenu';
import { MobileNavDrawer } from './MobileNavDrawer';
import { WosLogo } from './WosLogo';

/**
 * STEP: Header hierarchy trimmed (2026-09), per review feedback on the
 * previous 6-link version (Home / Services / Knowledge / My Trip /
 * Partners / Contact + Log in + Language — too flat, everything reading
 * as equally important).
 *
 * Changes from that version:
 *  - Home removed from the nav row entirely — the logo already links to
 *    "/" (see the wrapping <Link> below), so a second "Home" text link
 *    was redundant.
 *  - Contact removed from the nav row — it's still reachable at
 *    "/#contact" from Footer's "Connect" column (unchanged), just no
 *    longer duplicated up here. The page's own hierarchy is now
 *    Hero = convert, Header = navigate, Footer = explore/contact.
 *  - A small "ปรึกษา WOS ฟรี" consultation CTA was added next to Log in,
 *    reusing home.heroV2.ctaConsultation's copy rather than a new key —
 *    same words as the Hero's primary CTA. It's styled as the primary
 *    action (solid) with Log in as secondary (outline), matching the
 *    Hero's own primary/secondary CTA pairing so the two don't compete
 *    for attention — this header CTA is small so it never outranks the
 *    Hero's, just gives header-level access to the same action.
 *  - Login label was `locale === 'th' ? 'เข้าสู่ระบบ' : 'Log in'`, which
 *    silently gave Lao the English label. Replaced with nav.login,
 *    translated in all three locale files, so every language is
 *    controlled from the translation system rather than an inline
 *    conditional that only checked for Thai.
 *
 * What's unchanged from the previous nav-restoration step:
 *  - services  -> ServicesNavMenu dropdown on desktop (still backed by
 *                 "/#categories" as the plain link on mobile, same
 *                 anchor Footer's "Explore" group uses)
 *  - knowledge -> "/knowledge"
 *  - myTrip    -> "/my-trip" (order-number lookup form)
 *  - partners  -> "/partners" (the directory page)
 *  - Mobile nav is still MobileNavDrawer.tsx; its own hardcoded "Home"
 *    entry was removed there too, for the same reason as above.
 */
export function Header() {
  const t = useTranslations('nav');
  const tHero = useTranslations('home.heroV2');

  const navLinks = [
    { href: '/#categories' as const, label: t('services') },
    { href: '/knowledge' as const, label: t('knowledge') },
    { href: '/my-trip' as const, label: t('myTrip') },
    { href: '/partners' as const, label: t('partners') },
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
        {/* Text wordmark ("WOS.os") replaced with the real logo asset —
            see WosLogo.tsx for sizing notes and public/logo/wos-mark.svg
            for the source file. This link is also the nav's "Home" now
            that the text link has been removed below. */}
        <Link href="/" className="flex items-center">
          <WosLogo />
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          <ServicesNavMenu />

          {desktopLinks.map((link) => (
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
          {/* Primary action — same copy as the Hero's consultation CTA,
              solid-filled so it reads as the default next step. Hidden
              below `sm` so it doesn't crowd the hamburger trigger on
              phones; the Hero's own CTA is still the primary path there. */}
          <Link
            href="/consultation?source=header"
            className="hidden items-center justify-center rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark sm:inline-flex sm:px-5"
          >
            {tHero('ctaConsultation')}
          </Link>
          {/* Secondary — outline, demoted below the consultation CTA. */}
          <a
            href="/login"
            className="inline-flex items-center justify-center rounded-full border-2 border-primary px-4 py-1.5 text-sm font-semibold text-primary-dark transition-all duration-200 hover:bg-primary hover:text-white sm:px-5"
          >
            {t('login')}
          </a>
          <LocaleSwitcher />

          {/* Mobile nav trigger — was previously a horizontal scroll row
              (overflow-x-auto) under the main bar, replaced now that
              MobileNavDrawer exists. Passes the trimmed navLinks; the
              drawer renders Services itself (as an accordion) and
              filters that one out of the plain-link list. */}
          <MobileNavDrawer links={navLinks} />
        </div>
      </div>
    </header>
  );
}
