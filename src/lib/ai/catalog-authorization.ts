import { normalizeCatalogInput, hasProvinceCoverageWording } from './catalog-query-normalization';
import { deriveLegacyLookupSemantics } from './legacy-lookup-semantics';
import { decideProgramLookup, type LookupTurnOwner } from './lookup-intent';
import { extractRejectedProgramTitle, isShortNegative, isThanksMessage } from './journey-state';
import { matchProvince, type ProvinceRecord } from './understanding/provinces';
import type { PendingService } from './understanding/state';
import type { Understanding } from './understanding/types';

export type CatalogOperation = 'search' | 'selection' | 'detail' | 'more' | 'coverage' | 'discovery';
export type ClassificationProvenance = 'model' | 'deterministic';
export type CatalogTurnOwner = LookupTurnOwner | 'province-continuation';
export interface CatalogAuthorization {
  allowed: boolean;
  kind: 'service' | 'pending' | 'catalog' | 'denied';
  operation?: CatalogOperation;
  service: { query: string; source: 'explicit-service' | 'symptom' } | null;
  pendingExecution?: { id: string; query: string; provinceId: string };
}
export const DENIED: CatalogAuthorization = { allowed: false, kind: 'denied', service: null };

/** Only bounded province answers qualify; detecting a place inside arbitrary text is insufficient. */
export function provinceContinuation(message: string, provinces: ProvinceRecord[]): ProvinceRecord | null {
  const text = normalizeCatalogInput(message).trim().replace(/(?:ครับผม|ครับ|ค่ะ|คะ|ຄ່ະ|ຄະ)[.!?]*$/u, '').trim();
  return matchProvince(text, provinces);
}

export function authorizeCatalogTurn(input: {
  message: string; owner: CatalogTurnOwner; history?: { role: 'user' | 'assistant'; content: string }[];
  understanding?: Understanding | null; provenance?: ClassificationProvenance;
  pending?: PendingService | null; continuationProvince?: ProvinceRecord | null;
  provinces?: ProvinceRecord[];
  existingCatalogRequest?: boolean;
}): CatalogAuthorization {
  const { message, owner } = input;
  if (isThanksMessage(message) || isShortNegative(message) || extractRejectedProgramTitle(message, input.history ?? [])) return DENIED;
  if (['rejection', 'non-request', 'deterministic-state', 'unresolved'].includes(owner)) return DENIED;
  if (owner === 'selection') return { allowed: true, kind: 'catalog', operation: 'selection', service: null };
  if (owner === 'province-continuation') {
    if (!input.pending || !input.continuationProvince) return DENIED;
    return { allowed: true, kind: 'pending', operation: 'search', service: { query: input.pending.query, source: input.pending.source },
      pendingExecution: { id: input.pending.id, query: input.pending.query, provinceId: input.continuationProvince.id } };
  }
  const u = input.understanding;
  if (u && input.provenance === 'model') {
    // Validated model intent may be used only after prior ownership has been resolved.
    const decision = decideProgramLookup({ message, owner, understanding: u });
    if (decision.kind === 'lookup') return { allowed: true, kind: decision.serviceEvidence ? 'service' : 'catalog',
      operation: decision.intent === 'PROGRAM_SEARCH' ? 'search' : 'discovery', service: decision.serviceEvidence ? { ...decision.serviceEvidence, query: u.entities.program_query! } : null };
    if (decision.kind === 'owned' && ['program-detail', 'catalog-more', 'selection'].includes(decision.owner)) return {
      allowed: true, kind: 'catalog', operation: decision.owner === 'program-detail' ? 'detail' : decision.owner === 'catalog-more' ? 'more' : 'selection', service: null };
    if (owner === 'none') return DENIED;
  }
  const text = normalizeCatalogInput(message).trim();
  // Split only a syntactically explicit province clause, then delegate request grammar to B.
  let requestText = text;
  let hasLocationClause = false;
  const clause = text.match(/^(.*?)\s*(?:ใน|ที่)\s*จังหวัด\s*.+$/u);
  if (clause) {
    requestText = clause[1].trim();
    hasLocationClause = true;
  } else if (input.provinces?.length) {
    // Without an explicit province marker, accept only an exact canonical/alias
    // suffix through the existing province matcher; do not broaden detection.
    for (const delimiter of ['ใน', 'ที่']) {
      const index = text.lastIndexOf(delimiter);
      if (index < 0) continue;
      const suffix = text.slice(index + delimiter.length).trim()
        .replace(/(?:ไหม|มั้ย)(?:ครับ|ค่ะ|คะ)?[?？]*$/u, '').trim();
      if (provinceContinuation(suffix, input.provinces)) {
        requestText = text.slice(0, index).trim();
        hasLocationClause = true;
        break;
      }
    }
  }
  const direct = deriveLegacyLookupSemantics({ message: requestText, owner: 'none' });
  // Availability questions may place their final request particle after the province clause.
  const scoped = hasLocationClause && /(?:ไหม|มั้ย)(?:ครับ|ค่ะ|คะ)?[?？]*$/u.test(text)
    ? deriveLegacyLookupSemantics({ message: requestText + 'ไหม', owner: 'none' }) : direct;
  const semantics = direct.kind === 'lookup' ? direct : scoped;
  if (semantics.kind === 'lookup') return { allowed: true, kind: semantics.serviceEvidence ? 'service' : 'catalog',
    operation: semantics.intent === 'PROGRAM_SEARCH' ? 'search' : 'discovery',
    service: semantics.serviceEvidence ? { query: semantics.query!, source: semantics.serviceEvidence.source } : null };
  if (owner === 'coverage-context' && hasProvinceCoverageWording(text)) return { allowed: true, kind: 'catalog', operation: 'coverage', service: null };
  if (input.existingCatalogRequest && !u) return { allowed: true, kind: 'catalog', operation: 'discovery', service: null };
  // Deterministic detail/MORE classification is operation evidence, not service request evidence.
  if (u && Number.isFinite(u.confidence) && u.confidence >= .8 && u.confidence <= 1) {
    if (u.intent === 'PROGRAM_MORE' || u.intent === 'PROGRAM_DETAIL' || u.intent === 'PROGRAM_SELECTION') return { allowed: true, kind: 'catalog',
      operation: u.intent === 'PROGRAM_MORE' ? 'more' : u.intent === 'PROGRAM_DETAIL' ? 'detail' : 'selection', service: null };
  }
  return DENIED;
}

export function pendingForExecution(a: CatalogAuthorization, action: { type: string; kind?: string; query?: string | null; province?: ProvinceRecord | null }): string | undefined {
  const p = a.pendingExecution;
  return p && a.operation === 'search' && action.type === 'SEARCH' && action.kind === 'search'
    && action.query === p.query && action.province?.id === p.provinceId ? p.id : undefined;
}
