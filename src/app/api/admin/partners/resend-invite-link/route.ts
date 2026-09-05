// src/app/api/admin/partners/resend-invite-link/route.ts
//
// Re-mints a copyable set-password link for a partner contact who was
// already provisioned (see /api/admin/partners/provision/route.ts) but
// never finished setting a password — e.g. the original invite email
// bounced, landed in spam, or the admin simply wants to hand the link
// over directly (LINE, WhatsApp) instead of waiting on email delivery.
//
// Scoped to a `public.users` row that already exists for the given
// email, rather than accepting an arbitrary address: this route mints a
// real Supabase 'recovery' link (which, same as the invite link, lets
// the holder set a session and a new password — see set-password/page.tsx),
// so it must not become a way to generate a working login link for an
// email that was never actually invited as a partner contact.
import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(NextResponse.json({ error: auth.message }, { status: auth.status }), cookieCarrier);
  }

  const fail = (message: string, status = 400) =>
    withRefreshedCookies(NextResponse.json({ error: message }, { status }), cookieCarrier);

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return fail('invalid JSON body');
  }

  const email = body.email?.trim();
  if (!email || !email.includes('@')) return fail('ต้องระบุอีเมลที่ถูกต้อง');

  const supabase = createServiceClient();

  // Confirm this email actually belongs to a provisioned partner contact
  // (created by the provision route's step 6) before minting anything.
  const { data: portalUser, error: userErr } = await supabase
    .from('users')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();

  if (userErr) {
    console.error('resend-invite-link: users lookup failed', userErr);
    return fail('ค้นหาบัญชีผู้ใช้ไม่สำเร็จ: ' + userErr.message, 500);
  }
  if (!portalUser) {
    return fail('ไม่พบบัญชีพันธมิตรของอีเมลนี้ในระบบ (ต้องแปลงเป็นพันธมิตรก่อน)', 404);
  }

  const redirectTo = `${new URL(req.url).origin}/th/set-password`;
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    console.error('resend-invite-link: generateLink failed', linkErr);
    return fail('สร้างลิงก์ไม่สำเร็จ: ' + (linkErr?.message ?? 'unknown error'), 500);
  }

  return withRefreshedCookies(NextResponse.json({ ok: true, inviteLink: linkData.properties.action_link }), cookieCarrier);
}
