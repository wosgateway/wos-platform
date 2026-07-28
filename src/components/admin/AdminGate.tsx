'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

// Real Supabase Auth session gate. Team accounts must be created ahead of
// time in the Supabase Dashboard (Authentication > Users) — this only
// signs them in, it never creates accounts. Same approach already shipped
// in the static admin.html password-gate fix.
export function AdminGate({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) setError('เข้าสู่ระบบไม่สำเร็จ: ' + signInError.message);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  // Still resolving the session on first load.
  if (session === undefined) {
    return <div className="p-8 text-center text-sm text-slate-400">กำลังตรวจสอบสิทธิ์...</div>;
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <form onSubmit={handleLogin} className="card-shadow space-y-4 rounded-2xl border border-slate-100 bg-white p-6">
          <h1 className="text-lg font-bold text-slate-900">🔒 WOS Admin</h1>
          <p className="text-xs text-slate-400">
            ล็อกอินผ่าน Supabase Auth — บัญชีทีมงานต้องสร้างไว้ล่วงหน้าใน Supabase Dashboard
          </p>
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </div>
          ) : null}
          <div>
            <label className="form-label">อีเมล</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="form-label">รหัสผ่าน</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center disabled:opacity-60">
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <span className="text-sm text-slate-500">เข้าสู่ระบบเป็น {session.user.email}</span>
        <button onClick={handleLogout} className="text-sm font-medium text-slate-500 hover:text-red-600">
          ออกจากระบบ
        </button>
      </div>
      {children}
    </div>
  );
}
