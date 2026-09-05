// src/app/api/admin/audit-log/route.ts
//
// Read-only listing endpoint for public.audit_log (sql/073_audit_log.sql),
// backing the "Audit log" tab in the admin UI (AuditLogManager.tsx) so
// staff don't need to open the SQL editor to see who did what.
//
// Uses the service-role client rather than relying on audit_log's own
// "Platform admins can read audit_log" RLS policy + the browser's
// sb-wos-admin session — same reasoning as every other admin route in
// this codebase (requireAdmin() is the actual gate; service-role just
// avoids a second, redundant round-trip through RLS once that gate has
// already passed). This route only ever SELECTs — see 073's comment on
// why audit_log has no UPDATE/DELETE policy for anyone, admins
// included.

import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(NextResponse.json({ error: auth.message }, { status: auth.status }), cookieCarrier);
  }

  const url = new URL(request.url);
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
  const action = url.searchParams.get('action')?.trim();
  const entityType = url.searchParams.get('entityType')?.trim();
  const entityId = url.searchParams.get('entityId')?.trim();
  const actorEmail = url.searchParams.get('actorEmail')?.trim();

  const supabase = createServiceClient();

  let query = supabase
    .from('audit_log')
    .select('id, created_at, actor_user_id, actor_email, action, entity_type, entity_id, before, after, metadata', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  // action/entityType use partial match (e.g. filtering "partner" should
  // surface partner.suspend/partner.reactivate/partner.impersonate
  // together) — entityId is an exact UUID match, actorEmail is partial
  // for the same reason as action.
  if (action) query = query.ilike('action', `%${action}%`);
  if (entityType) query = query.eq('entity_type', entityType);
  if (entityId) query = query.eq('entity_id', entityId);
  if (actorEmail) query = query.ilike('actor_email', `%${actorEmail}%`);

  const { data, error, count } = await query;

  if (error) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'ดึงข้อมูล audit log ไม่สำเร็จ: ' + error.message }, { status: 500 }),
      cookieCarrier
    );
  }

  return withRefreshedCookies(
    NextResponse.json({
      rows: data ?? [],
      page,
      pageSize: PAGE_SIZE,
      total: count ?? 0,
    }),
    cookieCarrier
  );
}
