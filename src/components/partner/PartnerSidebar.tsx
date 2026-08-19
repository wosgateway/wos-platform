// src/components/partner/PartnerSidebar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PartnerUser } from '@/lib/partner/auth';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'ภาพรวม', icon: '📊' },
  { href: '/analytics', label: 'สรุปข้อมูล', icon: '📈' },
  { href: '/bookings', label: 'การจอง', icon: '📋' },
  { href: '/packages', label: 'โปรแกรม', icon: '📦' },
  { href: '/company', label: 'ข้อมูลบริษัท', icon: '🏢' },
  { href: '/documents', label: 'เอกสาร', icon: '📄' },
  { href: '/billing', label: 'บิล & ระบบสมาชิก', icon: '💳' },
];

export function PartnerSidebar({ user }: { user: PartnerUser }) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col bg-white border-r border-slate-100 min-h-screen sticky top-0">
      {/* Logo */}
      <div className="p-4 border-b border-slate-100">
        <Link href="/dashboard" className="text-xl font-bold text-primary-dark">
          WOS<span className="text-accent-ink">.os</span>
          <span className="block text-xs font-normal text-slate-400">Partner Portal</span>
        </Link>
      </div>

      {/* Org info */}
      <div className="px-4 py-3 border-b border-slate-100">
        <p className="text-sm font-medium text-slate-800 truncate">
          {user.organization.name}
        </p>
        <p className="text-xs text-slate-400">
          {user.role} · {user.organization.tier}
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors
                ${isActive
                  ? 'bg-primary-light text-primary-dark'
                  : 'text-slate-600 hover:bg-slate-50'
                }
              `}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-slate-100">
        <button
          onClick={async () => {
            const { createClient } = await import('@/lib/supabase/client');
            const supabase = createClient();
            await supabase.auth.signOut();
            window.location.href = '/login';
          }}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-red-500 hover:bg-red-50 w-full transition-colors"
        >
          <span>🚪</span>
          ออกจากระบบ
        </button>
      </div>
    </aside>
  );
}
