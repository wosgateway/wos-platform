// src/lib/partner/auth.ts
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import type { NextResponse } from 'next/server';

export interface PartnerUser {
  id: string;
  organization_id: string;
  branch_id: string | null;
  email: string;
  full_name: string;
  role: 'admin' | 'manager' | 'staff';
  permissions: string[];
  organization: {
    id: string;
    name: string;
    slug: string;
    tier: string;
    logo_url?: string;
  };
  // null เมื่อ user ยังไม่ถูกผูกกับสาขาไหน หรือสาขานั้นยังไม่ถูกผูกกับ
  // partner listing บนเว็บสาธารณะ (แอดมินยังไม่ได้เชื่อมให้) — หน้า
  // /packages ต้องเช็ค branch?.partner_id ก่อนอนุญาตให้สร้างโปรแกรม
  branch: {
    id: string;
    name: string;
    partner_id: string | null;
  } | null;
}

// OPTIONAL `response` ("cookie carrier"): pass a NextResponse from a
// Route Handler — auth.getSession()/getUser() below can trigger a
// Supabase token refresh, and without a carrier the refreshed cookie
// only lives for this one request, causing intermittent 401s later.
// See createClient()'s comment in src/lib/supabase/server.ts. Server
// Component callers (page.tsx files via requirePartnerAuth) have no
// response to pass — that's fine, middleware handles refresh there.
export async function getPartnerSession(
  response?: NextResponse
): Promise<{ user: PartnerUser | null; session: Session | null }> {
  const supabase = createClient(response, 'partner');
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return { user: null, session: null };
  }

  const { data: { user: verifiedUser }, error: verifyError } = await supabase.auth.getUser();

  if (verifyError || !verifiedUser) {
    return { user: null, session: null };
  }

  const { data: userData, error } = await supabase
    .from('users')
    .select(`
      id,
      email,
      full_name,
      role,
      permissions,
      organization_id,
      branch_id,
      organizations (
        id,
        name,
        slug,
        tier,
        logo_url
      ),
      branches (
        id,
        name,
        partner_id
      )
    `)
    .eq('supabase_user_id', verifiedUser.id)
    .single();

  if (error || !userData) {
    return { user: null, session };
  }

  return {
    session,
    user: {
      id: userData.id,
      organization_id: userData.organization_id,
      branch_id: userData.branch_id,
      email: userData.email,
      full_name: userData.full_name,
      role: userData.role,
      permissions: userData.permissions || [],
      // หมายเหตุเดิม: postgrest-js เดา type ของ embedded relation เป็น array
      // แม้ runtime จะคืน object เดียวเสมอ (many-to-one) จึง cast ให้ตรงจริง
      organization: userData.organizations as unknown as PartnerUser['organization'],
      branch: (userData.branches as unknown as PartnerUser['branch']) ?? null,
    },
  };
}

export async function requirePartnerAuth() {
  const { user, session } = await getPartnerSession();
  if (!user || !session) {
    redirect('/login');
  }
  return { user, session };
}

export function hasPermission(user: PartnerUser, permission: string): boolean {
  if (user.role === 'admin') return true;
  return user.permissions?.includes(permission) || false;
}