import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// GET /api/admin/mou/sign-requests
//
// Bulk version of "which organization does this partner map to, and
// what's the latest MOU sign request for that organization" â€” built
// for PartnersManager.tsx's list view, same reasoning as
// portal-accounts/route.ts's header comment (one query pass instead of
// a per-partner round trip). Read-only: nothing here authorizes a
// mutation, it only decides what an already-authorized admin sees.
//
// CORRECTION (was wrong in the first version of this route): an
// organization does NOT always carry partner_id directly. Same
// dual-linkage reality as portal-accounts/route.ts's own header
// comment â€” some orgs only have the link via their branch
// (branches.partner_id), for legacy rows that predate partner_id
// being backfilled onto organizations directly. Resolving via
// organizations.partner_id alone silently dropped every partner whose
// portal account was created under that older path (still has a
// working organization + login, just never got the direct column
// set) â€” this file now does the exact same two-pass resolution
// portal-accounts/route.ts does, just inverted (partnerId -> orgId
// instead of orgId -> partnerId list of accounts).

type OrgRow = { id: string; partner_id: string | null };
type BranchRow = { id: string; organization_id: string | null; partner_id: string | null };
type SignRequestRow = {
  id: string;
  organization_id: string;
  status: string;
  signer_name: string;
  signer_email: string | null;
  token_expires_at: string;
  sent_at: string | null;
  created_at: string;
};

export async function GET() {
  const cookieCarrier = new NextResponse();

  try {
    const auth = await requireAdmin(cookieCarrier);
    if (!auth.authorized) {
      return withRefreshedCookies(
        NextResponse.json({ error: auth.message }, { status: auth.status }),
        cookieCarrier
      );
    }

    const supabase = createServiceClient();

    const [
      { data: orgs, error: orgsErr },
      { data: branches, error: branchesErr },
      { data: requests, error: requestsErr },
    ] = await Promise.all([
      supabase.from('organizations').select('id, partner_id'),
      supabase.from('branches').select('id, organization_id, partner_id'),
      supabase
        .from('mou_sign_requests')
        .select('id, organization_id, status, signer_name, signer_email, token_expires_at, sent_at, created_at')
        .order('created_at', { ascending: false }),
    ]);
    if (orgsErr) throw new Error('organizations lookup failed: ' + orgsErr.message);
    if (branchesErr) throw new Error('branches lookup failed: ' + branchesErr.message);
    if (requestsErr) throw new Error('mou_sign_requests lookup failed: ' + requestsErr.message);

    const orgRows = (orgs as OrgRow[] | null) ?? [];
    const branchRows = (branches as BranchRow[] | null) ?? [];

    // Pass 1: every organization directly tagged with a partner_id.
    const partnerIdByOrgId = new Map<string, string>();
    orgRows.forEach((o) => {
      if (o.partner_id) partnerIdByOrgId.set(o.id, o.partner_id);
    });
    // Pass 2: a branch carrying partner_id also tells us its parent
    // organization's owner, for legacy orgs never backfilled directly.
    branchRows.forEach((b) => {
      if (b.partner_id && b.organization_id && !partnerIdByOrgId.has(b.organization_id)) {
        partnerIdByOrgId.set(b.organization_id, b.partner_id);
      }
    });

    // Invert to partnerId -> organizationId (what the client needs to
    // call create-sign-request with).
    const organizationIdByPartnerId: Record<string, string> = {};
    partnerIdByOrgId.forEach((partnerId, orgId) => {
      organizationIdByPartnerId[partnerId] = orgId;
    });

    // Rows already ordered newest-first, so the first one seen per
    // organization is its latest sign request.
    const latestByOrgId: Record<string, SignRequestRow> = {};
    (requests as SignRequestRow[] | null ?? []).forEach((r) => {
      if (!latestByOrgId[r.organization_id]) latestByOrgId[r.organization_id] = r;
    });

    return withRefreshedCookies(
      NextResponse.json({ organizationIdByPartnerId, latestSignRequestByOrgId: latestByOrgId }),
      cookieCarrier
    );
  } catch (error) {
    console.error('Error in /api/admin/mou/sign-requests:', error);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
      cookieCarrier
    );
  }
}
