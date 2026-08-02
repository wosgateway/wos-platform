// src/app/login/page.tsx
//
// ร่างเบื้องต้น: middleware.ts และ requirePartnerAuth() อ้างถึง '/login' อยู่แล้ว
// แต่ยังไม่มีไฟล์นี้ส่งมาในชุดที่ผ่านมาเลย จึงสร้างให้เป็น non-locale route
// (ตรงกับ PUBLIC_NON_LOCALE_ROUTES ใน middleware.ts) — ทำงานได้จริงแต่ยังเป็น
// UI เบื้องต้น ควรปรับดีไซน์/ข้อความให้ตรงกับ brand ก่อนใช้งานจริงกับลูกค้า
'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setLoading(false);
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
          : 'เข้าสู่ระบบไม่สำเร็จ: ' + signInError.message
      );
      return;
    }

    // ให้ server components (middleware/requirePartnerAuth) เห็น session ล่าสุด
    router.refresh();

    const redirectTo = searchParams.get('redirect') || '/dashboard';
    router.push(redirectTo);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-100 bg-white p-8 shadow-card">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-900">เข้าสู่ระบบพาร์ทเนอร์</h1>
          <p className="mt-1 text-sm text-slate-500">สำหรับผู้ให้บริการที่เข้าร่วมกับ WOS</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
              อีเมล
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="form-input"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
              รหัสผ่าน
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="form-input"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
