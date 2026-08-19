// src/components/partner/PartnerHeader.tsx
'use client';

import { useState, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PartnerUser } from '@/lib/partner/auth';
import { MobileSidebar } from './MobileSidebar';

export function PartnerHeader({
  user,
  children,
}: {
  user: PartnerUser;
  children?: ReactNode;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const supabase = createClient();

  return (
    <header className="bg-white border-b border-slate-100 px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-30">
      {/* Mobile menu toggle - อยู่ที่ Header อย่างเดียว */}
      <div className="md:hidden">
        <MobileSidebar user={user} />
      </div>

      {/* Title (desktop) */}
      <div className="hidden md:block" />

      {/* Right side */}
      <div className="flex items-center gap-3">
        {children}

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-primary-light text-primary-dark flex items-center justify-center text-sm font-bold">
              {user.full_name.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm font-medium text-slate-700 hidden sm:inline">
              {user.full_name}
            </span>
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-card border border-slate-100 py-1 z-20">
              <div className="px-4 py-2 border-b border-slate-100">
                <p className="text-sm font-medium text-slate-800">{user.full_name}</p>
                <p className="text-xs text-slate-400">{user.email}</p>
              </div>
              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.href = '/login';
                }}
                className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                🚪 ออกจากระบบ
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
