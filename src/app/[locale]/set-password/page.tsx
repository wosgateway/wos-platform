// src/app/[locale]/set-password/page.tsx
//
// Landing page for the "set your password" email sent by
// supabase.auth.admin.inviteUserByEmail() in
// /api/admin/partners/provision/route.ts (redirectTo points here).
//
// How the session gets here: GoTrue's invite-link verify endpoint
// redirects the browser to this URL with `#access_token=...&refresh_
// token=...&type=invite` in the hash fragment. That's the *implicit*-flow
// link format, which is all admin.inviteUserByEmail()/generateLink() ever
// produce. createClient() (browser client, @supabase/ssr) defaults to
// flowType 'pkce', under which detectSessionInUrl only recognizes a
// `?code=` query param — it never looks at this hash at all, silently.
// So the tokens are parsed out and passed to setSession() by hand below
// instead of relying on auto-detection.
//
// IMPORTANT: this route is listed in PUBLIC_LOCALE_ROUTE_SEGMENTS in
// middleware.ts. The hash fragment above is never sent to the server, so
// on the very first request middleware sees no session at all — if this
// page were gated as a portal route, that first request would redirect
// to /login before the client JS below ever got a chance to run.
//
// Thai-only, unstyled through next-intl, matching src/app/login/page.tsx
// (the partner portal is intentionally Thai-only — see middleware.ts).
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type SessionState = 'checking' | 'ready' | 'invalid';

const MIN_PASSWORD_LENGTH = 8;

export default function SetPasswordPage() {
  const router = useRouter();
  // Memoized so React 18 StrictMode's double-invoke of the component body
  // (dev mode only) doesn't create two GoTrueClient instances racing to
  // read/clear the #access_token hash in the URL (same fix as
  // impersonate-consume/page.tsx, which shares this exact pattern).
  const [supabase] = useState(() => createClient('partner'));

  const [sessionState, setSessionState] = useState<SessionState>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkSession(attempt: number) {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (data.session) {
        setSessionState('ready');
        return;
      }

      if (attempt >= 10) {
        // ~3s of polling with no session — link is expired, already
        // used, or was opened without its hash fragment intact.
        setSessionState('invalid');
        return;
      }

      setTimeout(() => checkSession(attempt + 1), 300);
    }

    // See file header comment: detectSessionInUrl won't pick this hash up
    // under the client's default 'pkce' flowType, so pull the tokens out
    // and set the session explicitly instead of assuming auto-detection
    // handled it.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');

    async function establish() {
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        // Strip the tokens from the address bar either way — they're
        // single-use and shouldn't sit in browser history/referrers.
        window.history.replaceState(null, '', window.location.pathname);
        if (cancelled) return;
      }
      checkSession(0);
    }

    establish();

    // Also listen directly in case the hash-based session lands between
    // polls — avoids a up-to-300ms extra wait once it's actually ready.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (session) setSessionState('ready');
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`);
      return;
    }
    if (password !== confirmPassword) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError('ตั้งรหัสผ่านไม่สำเร็จ: ' + updateError.message);
      return;
    }

    setDone(true);
    router.refresh();
    // Real route is src/app/[locale]/(partner-portal)/dashboard/page.tsx
    // -> URL /th/dashboard (partner portal is Thai-only, see
    // middleware.ts). A bare '/dashboard' push would still resolve via
    // next-intl's own redirect, but goes straight there instead.
    setTimeout(() => router.push('/th/dashboard'), 1200);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-100 bg-white p-8 shadow-card">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-900">ตั้งรหัสผ่านพาร์ทเนอร์</h1>
          <p className="mt-1 text-sm text-slate-500">ยินดีต้อนรับสู่ระบบพาร์ทเนอร์ WOS</p>
        </div>

        {sessionState === 'checking' ? (
          <div className="py-8 text-center text-sm text-slate-400">🔄 กำลังตรวจสอบลิงก์คำเชิญ...</div>
        ) : sessionState === 'invalid' ? (
          <div className="space-y-4 text-center">
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              ลิงก์คำเชิญหมดอายุ ถูกใช้ไปแล้ว หรือไม่ถูกต้อง
            </div>
            <a href="/login" className="text-sm font-medium text-primary-dark hover:underline">
              กลับไปหน้าเข้าสู่ระบบ
            </a>
          </div>
        ) : done ? (
          <div className="rounded-xl bg-emerald-50 p-3 text-center text-sm font-medium text-emerald-700">
            ✅ ตั้งรหัสผ่านสำเร็จ กำลังพาไปหน้าแดชบอร์ด...
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
                รหัสผ่านใหม่
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-input"
                placeholder={`อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-slate-700">
                ยืนยันรหัสผ่าน
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="form-input"
              />
            </div>

            {error ? <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full justify-center text-base disabled:opacity-60"
            >
              {submitting ? 'กำลังบันทึก...' : 'ตั้งรหัสผ่านและเข้าสู่ระบบ'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
