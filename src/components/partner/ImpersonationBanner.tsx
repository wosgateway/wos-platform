// src/components/partner/ImpersonationBanner.tsx
//
// Renders only when this tab reached the portal via
// /th/impersonate-consume (see that page — it sets the sessionStorage
// flag this reads). Reminds whoever is looking that they're signed in
// as the partner via admin impersonation, not as the admin, and gives
// a one-click way out that doesn't require remembering the partner's
// (nonexistent, since impersonation never asked for one) password.
//
// "ออกจากโหมดนี้" signs this tab's sb-wos-partner session out entirely
// and sends it to /login — it does NOT hand control back to any admin
// session, because there isn't one in this tab (impersonation is
// typically opened in a fresh tab, see PartnersManager.tsx). The admin
// keeps working in their original /admin tab the whole time.
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function ImpersonationBanner() {
  const [visible, setVisible] = useState(false);
  const [endingSession, setEndingSession] = useState(false);

  useEffect(() => {
    setVisible(sessionStorage.getItem('wos-impersonating') === '1');
  }, []);

  if (!visible) return null;

  async function handleEndImpersonation() {
    setEndingSession(true);
    const supabase = createClient('partner');
    await supabase.auth.signOut();
    sessionStorage.removeItem('wos-impersonating');
    window.location.href = '/login';
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-white">
      <span>🕵️ กำลังดูแทนพาร์ทเนอร์ (impersonation) — การกระทำใดๆ ในแท็บนี้จะถูกบันทึกเป็นของบัญชีพาร์ทเนอร์จริง</span>
      <button
        onClick={handleEndImpersonation}
        disabled={endingSession}
        className="shrink-0 rounded-lg bg-white/20 px-3 py-1 hover:bg-white/30 disabled:opacity-60"
      >
        {endingSession ? 'กำลังออก...' : 'ออกจากโหมดนี้'}
      </button>
    </div>
  );
}
