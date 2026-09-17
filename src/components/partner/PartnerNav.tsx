// components/partner/PartnerNav.tsx
//
// Sticky in-page nav for /partner. On desktop: section anchors + one CTA.
// On mobile it collapses to "WOS Partner | Apply" so the CTA is always
// one tap away — no JS, no drawer.

import { Link } from "@/i18n/navigation";
import type { PartnerNavContent } from "@/content/partner/types";

export function PartnerNav({ nav }: { nav: PartnerNavContent }) {
  return (
    <nav className="wos-nav" aria-label="Partner page">
      <div className="wos-shell wos-nav-inner">
        <a href="#top" className="wos-nav-brand">
          <span className="wos-nav-brand-full">{nav.brand}</span>
          <span className="wos-nav-brand-short">{nav.mobileBrand}</span>
        </a>

        <ul className="wos-nav-links">
          {nav.links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>

        <Link href={nav.cta.href} className="wos-nav-cta">
          <span className="wos-nav-cta-full">{nav.cta.label}</span>
          <span className="wos-nav-cta-short">{nav.mobileCtaLabel}</span>
        </Link>
      </div>
    </nav>
  );
}
