// src/lib/mou/tokens.ts
//
// Token issuance + resolution for the MOU e-signature sign-link
// (`/partner/mou-sign/[token]`). Mirrors
// src/lib/trips/resolve-partner-trip-token.ts on purpose: same
// hash-at-rest, timing-safe-compare, expiry/revocation-before-trust
// sequence, because the threat model is identical (a long-lived link
// mailed/LINE'd to someone who isn't a logged-in Partner Portal user).
//
// Never log the raw token. Never return it in any response body beyond
// the single admin API call that issues it.

import { createServiceClient } from '@/lib/supabase/service';
import crypto from 'crypto';

export const SIGN_LINK_TTL_DAYS = 14;

export function generateSignToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

export interface ResolvedSignRequest {
  id: string;
  organizationId: string;
  organizationName: string;
  templateVersion: string;
  // Path in the mou-documents Storage bucket of the per-request PDF
  // with this partner's name + commercial_fee_rate filled in (see
  // 111_mou_sign_requests_dynamic_draft.sql). null for sign requests
  // created before dynamic draft generation shipped — callers fall
  // back to the blank on-disk template via loadMouBaseDocument().
  draftStoragePath: string | null;
  status: 'pending' | 'signed' | 'expired' | 'cancelled';
  signerName: string;
  signerEmail: string | null;
  signerPhone: string | null;
}

export type ResolveSignTokenError =
  | 'invalid_token'
  | 'lookup_failed'
  | 'not_found'
  | 'expired'
  | 'already_signed'
  | 'cancelled';

/**
 * Resolves a raw sign-link token to its mou_sign_requests row. Callers
 * MUST treat 'expired'/'already_signed'/'cancelled' as terminal states
 * to show the signer (not silently retry) — a link that already
 * produced a signature must never let a second signature attach to it
 * (see the unique index on mou_signatures.sign_request_id, which is the
 * hard backstop for this at the DB level; this check is the friendly
 * front door for it).
 */
export async function resolveSignToken(
  token: string
): Promise<{ request: ResolvedSignRequest | null; error: ResolveSignTokenError | null }> {
  if (!token || typeof token !== 'string') {
    return { request: null, error: 'invalid_token' };
  }

  const supabase = createServiceClient();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const { data: match, error } = await supabase
    .from('mou_sign_requests')
    .select(
      `
      id, organization_id, template_version, draft_storage_path, status,
      signer_name, signer_email, signer_phone,
      token_expires_at,
      organizations ( name )
    `
    )
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) {
    return { request: null, error: 'lookup_failed' };
  }

  if (!match) {
    return { request: null, error: 'not_found' };
  }

  if (match.status === 'signed') {
    return { request: null, error: 'already_signed' };
  }

  if (match.status === 'cancelled') {
    return { request: null, error: 'cancelled' };
  }

  if (match.status === 'expired' || new Date(match.token_expires_at) < new Date()) {
    return { request: null, error: 'expired' };
  }

  // organizations comes back as an array or object depending on the
  // PostgREST version — normalize defensively rather than assume.
  const org = Array.isArray(match.organizations) ? match.organizations[0] : match.organizations;

  return {
    request: {
      id: match.id as string,
      organizationId: match.organization_id as string,
      organizationName: (org as { name?: string } | null)?.name ?? '',
      templateVersion: match.template_version as string,
      draftStoragePath: (match.draft_storage_path as string | null) ?? null,
      status: match.status as ResolvedSignRequest['status'],
      signerName: match.signer_name as string,
      signerEmail: match.signer_email as string | null,
      signerPhone: match.signer_phone as string | null,
    },
    error: null,
  };
}
