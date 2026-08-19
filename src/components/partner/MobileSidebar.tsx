// src/components/partner/MobileSidebar.tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
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

export function MobileSidebar({ user }: { user: PartnerUser }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const supabase = createClient();

  return (
    <>
      {/* Hamburger button */}
      <button
        onClick={() => setIsOpen(true)}
        className="md:hidden text-slate-500 p-2 -ml-2"
        aria-label="เปิดเมนู"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar drawer */}
      <div
        className={`
          fixed top-0 left-0 bottom-0 w-72 bg-white z-50 md:hidden
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <Link href="/dashboard" className="text-xl font-bold text-primary-dark">
            WOS<span className="text-accent-ink">.os</span>
            <span className="block text-xs font-normal text-slate-400">Partner Portal</span>
          </Link>
          <button
            onClick={() => setIsOpen(false)}
            className="text-slate-400 hover:text-slate-600 text-2xl"
          >
            ×
          </button>
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
        <nav className="p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
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
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-100 bg-white">
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = '/login';
            }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-red-500 hover:bg-red-50 w-full transition-colors"
          >
            <span>🚪</span>
            ออกจากระบบ
          </button>
        </div>
      </div>
    </>
  );
}
