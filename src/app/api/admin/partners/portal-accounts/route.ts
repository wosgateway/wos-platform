import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// GET /api/admin/partners/portal-accounts
//
// Bulk version of the per-partner lookup that already exists inline in
// hard-delete/route.ts's resolveEntanglement() (and duplicated again in
// spirit by portal-access/route.ts's existingBranchEmail check). Built
// for PartnersManager.tsx's list view: with 100+ partners, calling a
// per-partner endpoint once per row would mean 100+ round trips just to
// render a table. This does the whole thing in 3 queries total and
// returns a partnerId -> accounts[] map the client can look up in O(1)
// per row.
//
// Same dual-linkage reality as hard-delete's resolveEntanglement: a
// partner can be reached via branches.partner_id (072) or
// organizations.partner_id (010), and older rows may only have the
// organization linked while newer branches under that org don't carry
// partner_id themselves — so this mirrors that two-pass resolution,
// just batched across every partner at once instead of one at a time.
//
// Read-only, so unlike hard-delete's version this intentionally does
// NOT need to be re-verified server-side elsewhere — nothing here
// authorizes a mutation, it only decides what an already-authorized
// admin sees in a list.

type BranchRow = { id: string; organization_id: string | null; partner_id: string | null };
type OrgRow = { id: string; partner_id: string | null };
type UserRow = {
  id: string;
  email: string;
  organization_id: string | null;
  branch_id: string | null;
  status: string | null;
  is_platform_admin: boolean | null;
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

    const [{ data: branches, error: branchesErr }, { data: orgs, error: orgsErr }] = await Promise.all([
      supabase.from('branches').select('id, organization_id, partner_id'),
      supabase.from('organizations').select('id, partner_id'),
    ]);
    if (branchesErr) throw new Error('branches lookup failed: ' + branchesErr.message);
    if (orgsErr) throw new Error('organizations lookup failed: ' + orgsErr.message);

    const branchRows = (branches ?? []) as BranchRow[];
    const orgRows = (orgs ?? []) as OrgRow[];

    // Pass 1: every organization directly tagged with a partner_id.
    const orgIdToPartnerId = new Map<string, string>();
    orgRows.forEach((o) => {
      if (o.partner_id) orgIdToPartnerId.set(o.id, o.partner_id);
    });
    // A branch carrying partner_id also tells us its organization's
    // owner, for legacy orgs that never got partner_id backfilled
    // directly (same reasoning as hard-delete's route).
    branchRows.forEach((b) => {
      if (b.partner_id && b.organization_id && !orgIdToPartnerId.has(b.organization_id)) {
        orgIdToPartnerId.set(b.organization_id, b.partner_id);
      }
    });

    // Pass 2: resolve every branch to a partner — directly via its own
    // partner_id, or via its parent organization's resolved owner.
    const branchIdToPartnerId = new Map<string, string>();
    branchRows.forEach((b) => {
      const owner = b.partner_id ?? (b.organization_id ? orgIdToPartnerId.get(b.organization_id) : undefined);
      if (owner) branchIdToPartnerId.set(b.id, owner);
    });

    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, email, organization_id, branch_id, status, is_platform_admin');
    if (usersErr) throw new Error('users lookup failed: ' + usersErr.message);

    const accountsByPartnerId = new Map<string, { email: string; status: string | null }[]>();
    (users as UserRow[] | null ?? []).forEach((u) => {
      // Platform admins (WOS staff) are never a "partner login" —
      // exclude them so an org like WOS Internal never shows up
      // attached to a partner's row.
      if (u.is_platform_admin) return;

      const partnerId =
        (u.branch_id ? branchIdToPartnerId.get(u.branch_id) : undefined) ??
        (u.organization_id ? orgIdToPartnerId.get(u.organization_id) : undefined);
      if (!partnerId) return;

      const list = accountsByPartnerId.get(partnerId) ?? [];
      list.push({ email: u.email, status: u.status });
      accountsByPartnerId.set(partnerId, list);
    });

    const result: Record<string, { email: string; status: string | null }[]> = {};
    accountsByPartnerId.forEach((list, partnerId) => {
      result[partnerId] = list;
    });

    return withRefreshedCookies(NextResponse.json({ accounts: result }), cookieCarrier);
  } catch (error) {
    console.error('Error in /api/admin/partners/portal-accounts:', error);
    return withRefreshedCookies(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
      cookieCarrier
    );
  }
}
