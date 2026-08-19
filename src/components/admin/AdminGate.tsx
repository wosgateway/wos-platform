'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

// Real Supabase Auth session gate. Team accounts must be created ahead of
// time in the Supabase Dashboard (Authentication > Users) — this only
// signs them in, it never creates accounts. Same approach already shipped
// in the static admin.html password-gate fix.
//
// เดิม gate นี้เช็คแค่ "มี session ไหม" — ใครก็ตามที่ล็อกอินผ่าน Supabase Auth
// pool เดียวกันได้ (รวมถึง staff ของพาร์ทเนอร์เอง ที่ล็อกอินผ่าน
// (partner-portal), ดู src/lib/partner/auth.ts) ก็เข้าหน้า /admin UI shell
// นี้ได้ทั้งที่ RLS ของ public.packages/public.partners คุมด้วย
// is_platform_admin() อยู่แล้ว (ดู 031_fix_admin_rls_cases_and_partner_applications.sql
// สำหรับ public.cases/partner_applications ที่แก้ให้ตรงกัน)
// เพิ่มเช็ค is_platform_admin() ตรงนี้ด้วย เป็น defense-in-depth ระดับ UI —
// ไม่ใช่ตัวคุมความปลอดภัยจริง (RLS ยังเป็นตัวคุมจริงเสมอ) แค่กันไม่ให้
// org-admin ของพาร์ทเนอร์เห็นหน้า UI ที่ query จะว่างเปล่าอยู่แล้ว
// เรียกผ่าน .rpc() ได้ตรงจาก client เพราะฟังก์ชันเป็น SECURITY DEFINER
// อยู่แล้ว ไม่ต้องเปิด table เพิ่ม
export function AdminGate({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function checkAdmin(s: Session | null) {
      if (!s) {
        setIsPlatformAdmin(false);
        return;
      }
      const { data, error: rpcError } = await supabase.rpc('is_platform_admin');
      setIsPlatformAdmin(!rpcError && data === true);
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      checkAdmin(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      checkAdmin(s);
    });
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

  // มี session แล้ว แต่ยังเช็ค is_platform_admin() ไม่เสร็จ
  if (isPlatformAdmin === undefined) {
    return <div className="p-8 text-center text-sm text-slate-400">กำลังตรวจสอบสิทธิ์...</div>;
  }

  // มี session แต่ไม่ใช่ platform admin (เช่น org-admin ของพาร์ทเนอร์ที่ล็อกอิน
  // ผ่าน pool เดียวกัน) — RLS ของ cases/partner_applications/packages/partners
  // จะกัน query ไว้อยู่แล้ว แต่ปิดหน้า UI shell ตรงนี้ด้วยเพื่อไม่ให้เห็นแม้แต่
  // โครง UI ที่ query จะว่างเปล่า
  if (!isPlatformAdmin) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 text-center">
        <div className="card-shadow space-y-3 rounded-2xl border border-slate-100 bg-white p-6">
          <h1 className="text-lg font-bold text-slate-900">🔒 ไม่มีสิทธิ์เข้าถึง</h1>
          <p className="text-sm text-slate-500">
            บัญชี {session.user.email} ไม่มีสิทธิ์ WOS platform admin
          </p>
          <button onClick={handleLogout} className="btn-primary w-full justify-center">
            ออกจากระบบ
          </button>
        </div>
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
