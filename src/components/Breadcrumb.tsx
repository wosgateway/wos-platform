import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export function Breadcrumb({ trail }: { trail: { href?: string; label: ReactNode }[] }) {
  const t = useTranslations('nav');

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
      <nav className="text-sm text-slate-400">
        <Link href="/" className="hover:text-primary">
          {t('home')}
        </Link>
        {trail.map((item, i) => (
          <span key={i}>
            <span className="mx-1">/</span>
            {item.href ? (
              <Link href={item.href} className="hover:text-primary">
                {item.label}
              </Link>
            ) : (
              <span className="font-medium text-slate-800">{item.label}</span>
            )}
          </span>
        ))}
      </nav>
    </div>
  );
}
