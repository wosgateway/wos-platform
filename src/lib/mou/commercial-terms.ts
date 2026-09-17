// src/lib/mou/commercial-terms.ts
//
// mou_sign_requests only carries organization_id, never partner_id
// (see create-sign-request/route.ts's comment), but the % that needs
// to go on the MOU draft lives on partner_commercial_terms, which is
// keyed by partner_id. Same dual-linkage reality as
// /api/admin/mou/sign-requests/route.ts and
// /api/admin/partners/portal-accounts/route.ts already handle for
// their own lookups: an organization doesn't always carry partner_id
// directly — some only have the link via their branch
// (branches.partner_id), for legacy rows predating partner_id being
// backfilled onto organizations directly. This does the same two-pass
// resolution, just for a single organization instead of the bulk list
// those routes build.

import { createServiceClient } from '@/lib/supabase/service';

const DEFAULT_COMMERCIAL_FEE_RATE = 12.0; // MOU ข้อ 3 default — matches the trigger's COALESCE in 098

export async function resolvePartnerIdForOrganization(
  organizationId: string
): Promise<string | null> {
  const supabase = createServiceClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('partner_id')
    .eq('id', organizationId)
    .maybeSingle();
  if (org?.partner_id) return org.partner_id as string;

  // Fall back to a branch under this organization that carries
  // partner_id directly (legacy path — see the file header).
  const { data: branch } = await supabase
    .from('branches')
    .select('partner_id')
    .eq('organization_id', organizationId)
    .not('partner_id', 'is', null)
    .limit(1)
    .maybeSingle();

  return (branch?.partner_id as string | undefined) ?? null;
}

/**
 * The commercial_fee_rate to print on this organization's MOU draft.
 * Falls back to the MOU-default 12.00% if the organization can't be
 * resolved to a partner, or that partner has no
 * partner_commercial_terms row yet — same fail-soft behavior as the
 * calculate_order_item_commission() trigger (098), so a sign request
 * never blocks on missing terms data, it just uses the MOU default
 * until someone sets a negotiated rate.
 */
export async function resolveCommercialFeeRateForOrganization(
  organizationId: string
): Promise<number> {
  const partnerId = await resolvePartnerIdForOrganization(organizationId);
  if (!partnerId) return DEFAULT_COMMERCIAL_FEE_RATE;

  const supabase = createServiceClient();
  const { data: terms } = await supabase
    .from('partner_commercial_terms')
    .select('commercial_fee_rate')
    .eq('partner_id', partnerId)
    .maybeSingle();

  return (terms?.commercial_fee_rate as number | undefined) ?? DEFAULT_COMMERCIAL_FEE_RATE;
}
