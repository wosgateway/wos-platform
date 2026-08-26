'use client';

// src/components/ServicesNavMenu.tsx
//
// Replaces the plain "Services" -> "/#categories" anchor link in
// Header.tsx's desktop nav. Previously clicking "Services" jumped to the
// #categories section on the homepage and the user still had to scroll to
// find hospital/dental/wellness/etc — 2 actions to reach a category.
// This drops it to 1: hover/click "Services", click the category directly,
// land on category/[slug] (already filtered to that category's partners).
//
// CATEGORIES comes straight from lib/categories.ts — adding a category
// there is enough to have it show up here too, no separate list to
// maintain in this file.

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { CATEGORIES } from '@/lib/categories';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ServicesNavMenu() {
  const tNav = useTranslations('nav');
  const tCat = useTranslations('categories');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group/services flex items-center gap-1 text-sm font-medium text-slate-600 outline-none transition-colors hover:text-primary-dark aria-expanded:text-primary-dark">
        {tNav('services')}
        <ChevronDown
          className="h-3.5 w-3.5 transition-transform group-aria-expanded/services:rotate-180"
          strokeWidth={2}
          aria-hidden
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-[15rem]">
        {CATEGORIES.map((category) => (
          <DropdownMenuItem key={category.slug} asChild>
            <Link href={`/category/${category.slug}`}>
              <category.icon className="h-4 w-4 shrink-0 text-primary-dark" strokeWidth={1.75} aria-hidden />
              {tCat(category.slug)}
            </Link>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/#categories" className="text-slate-500">
            {tNav('viewAllServices')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
