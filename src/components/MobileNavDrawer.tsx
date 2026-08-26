'use client';

// src/components/MobileNavDrawer.tsx
//
// Replaces the old mobile nav — a horizontal overflow-x-auto scroll row
// under the header bar — with a hamburger-triggered side drawer. That row
// existed only because there was no drawer component in the codebase yet
// (see Header.tsx's old comment); now that ui/dialog.tsx is in place, this
// builds directly on DialogPrimitive rather than the pre-styled
// DialogContent, since a drawer needs to slide in from an edge and take a
// fixed side column instead of appearing centered as a small modal card.
//
// Services becomes an accordion here instead of the desktop hover
// dropdown (ServicesNavMenu.tsx) — same CATEGORIES data and /category/[slug]
// links, just inline-expanding instead of hover/floating, since drawers on
// touch don't have a natural "hover to peek a submenu" gesture.

import { useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { ChevronDown, Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { CATEGORIES } from '@/lib/categories';
import { cn } from '@/lib/utils';

type NavLink = { href: string; label: string };

interface MobileNavDrawerProps {
  /** Plain nav links, excluding Services (rendered as its own accordion below). */
  links: NavLink[];
}

export function MobileNavDrawer({ links }: MobileNavDrawerProps) {
  const [open, setOpen] = useState(false);
  const [servicesExpanded, setServicesExpanded] = useState(false);
  const tNav = useTranslations('nav');
  const tCat = useTranslations('categories');

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-primary-dark md:hidden"
        aria-label={tNav('openMenu')}
      >
        <Menu className="h-5 w-5" strokeWidth={2} aria-hidden />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />

        <DialogPrimitive.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex h-full w-[80%] max-w-xs flex-col overflow-y-auto bg-white shadow-xl outline-none duration-200',
            'data-open:animate-in data-open:slide-in-from-right',
            'data-closed:animate-out data-closed:slide-out-to-right'
          )}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
            <DialogPrimitive.Title className="text-lg font-bold tracking-tight text-primary-dark">
              WOS<span className="align-top text-sm font-light text-accent-ink">.os</span>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-primary-dark"
              aria-label={tNav('closeMenu')}
            >
              <X className="h-5 w-5" strokeWidth={2} aria-hidden />
            </DialogPrimitive.Close>
          </div>

          <nav className="flex flex-1 flex-col gap-1 px-2 py-3 text-base font-medium text-slate-700">
            {/* Home is always first — same ordering as desktop nav */}
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-50 hover:text-primary-dark"
            >
              {tNav('home')}
            </Link>

            {/* Services accordion — mirrors ServicesNavMenu's CATEGORIES list
                and /#categories view-all link, expand/collapse instead of
                hover since this is a touch surface. */}
            <div>
              <button
                type="button"
                onClick={() => setServicesExpanded((v) => !v)}
                aria-expanded={servicesExpanded}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-slate-50 hover:text-primary-dark"
              >
                {tNav('services')}
                <ChevronDown
                  className={cn('h-4 w-4 shrink-0 transition-transform', servicesExpanded && 'rotate-180')}
                  strokeWidth={2}
                  aria-hidden
                />
              </button>

              {servicesExpanded && (
                <div className="ml-3 flex flex-col gap-0.5 border-l border-slate-100 pl-3">
                  {CATEGORIES.map((category) => (
                    <Link
                      key={category.slug}
                      href={`/category/${category.slug}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-primary-dark"
                    >
                      <category.icon className="h-4 w-4 shrink-0 text-primary-dark" strokeWidth={1.75} aria-hidden />
                      {tCat(category.slug)}
                    </Link>
                  ))}
                  <Link
                    href="/#categories"
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-50 hover:text-primary-dark"
                  >
                    {tNav('viewAllServices')}
                  </Link>
                </div>
              )}
            </div>

            {/* Remaining plain links: knowledge, myTrip, partners, contact —
                same order as Header.tsx's navLinks (minus home/services,
                already handled above). */}
            {links
              .filter((link) => link.href !== '/' && link.href !== '/#categories')
              .map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-50 hover:text-primary-dark"
                >
                  {link.label}
                </Link>
              ))}
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
