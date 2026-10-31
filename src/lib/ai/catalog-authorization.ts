import { matchProvince, type ProvinceRecord } from './understanding/provinces';
import { deriveLegacyLookupSemantics } from './legacy-lookup-semantics';
import { decideProgramLookup, type LookupTurnOwner } from './lookup-intent';
import { extractConcreteServiceEvidence } from './concrete-service-evidence';
import { normalizeCatalogInput, canonicalCatalogService, hasProvinceCoverageWording } from './catalog-query-normalization';
import { extractRejectedProgramTitle, hasNegativeRequestSemantics, isShortNegative, isThanksMessage } from './journey-state';
import type { Understanding } from './understanding/types';
import type { PendingService } from './understanding/state';

export interface CatalogAuthorization {
  allowed: boolean;
  kind: 'service' | 'pending' | 'catalog' | 'denied';
  service: { query: string; source: 'explicit-service' | 'symptom' } | null;
  operation?: 'search' | 'selection' | 'detail' | 'more' | 'coverage' | 'discovery';
  pendingExecution?: { id: string; query: string; provinceId: string };
}

/** The sole eligibility decision for both gate and legacy execution. No catalog I/O. */
export function authorizeCatalogTurn(input: {
  message: string;
  owner: LookupTurnOwner | 'province-continuation';
  provenance?: 'model' | 'deterministic';
  continuationProvince?: ProvinceRecord | null;
  history?: { role: 'user' | 'assistant'; content: string }[];
  understanding?: Understanding | null;
  pending?: PendingService | null;
  validProvince?: boolean;
  existingCatalogRequest?: boolean;
}): CatalogAuthorization {
  const deny: CatalogAuthorization = { allowed: false, kind: 'denied', service: null };
  if (input.owner === 'rejection' || input.owner === 'non-request' || input.owner === 'deterministic-state' || input.owner === 'unresolved'
    || isThanksMessage(input.message) || isShortNegative(input.message) || hasNegativeRequestSemantics(input.message)
    || extractRejectedProgramTitle(input.message, input.history ?? [])) return deny;

  if (input.owner === 'selection') return { allowed: true, kind: 'catalog', operation: 'selection', service: null };
  const continuation = input.continuationProvince;
  if (input.owner === 'province-continuation' && (!input.pending || !continuation)) return deny;
  // Classification is not affirmative request evidence. Deterministic SEARCH
  // must still satisfy the bounded request grammar below.
  if (input.provenance === 'deterministic' && input.understanding?.intent === 'PROGRAM_SEARCH') {
    input = { ...input, understanding: null };
  }
  const evidence = extractConcreteServiceEvidence(input.message);
  if (input.understanding && input.owner === 'none'
    && (!Number.isFinite(input.understanding.confidence) || input.understanding.confidence < 0.8 || input.understanding.confidence > 1
      || !['PROGRAM_SEARCH', 'PROGRAM_DISCOVERY', 'PROGRAM_SELECTION', 'PROGRAM_DETAIL', 'PROGRAM_MORE'].includes(input.understanding.intent))) return deny;
  // Explicit province-clause request grammar: the target must still be the shared
  // canonical service, not an arbitrary remainder with location words removed.
  const text = normalizeCatalogInput(input.message).trim();
  const scopedRequest = text.match(/^มี\s*(?:โปรแกรม|บริการ)?\s*(.+?)\s*(?:ใน|ที่)\s*(?:จังหวัด)?\s*.+?(?:ไหม|มั้ย)(?:ครับ|ค่ะ|คะ)?[?？]*$/u)
    ?? text.match(/^อยาก\s*(?:โปรแกรม|บริการ)?\s*(.+?)\s*(?:ใน|ที่)\s*(?:จังหวัด)?\s*.+$/u);
  const canonical = canonicalCatalogService(input.message);
  const scoped = !!evidence && !!canonical && scopedRequest?.[1].trim() === canonical;
  const deterministic = deriveLegacyLookupSemantics({ message: input.message, owner: 'none' });
  const beforeProvinceClause = text.match(/^(.+?)\s+(?:ใน|ที่)\s*จังหวัด\s*.+$/u)?.[1];
  const scopedSemantics = beforeProvinceClause
    ? deriveLegacyLookupSemantics({ message: beforeProvinceClause, owner: 'none' }) : null;
  if (scopedSemantics?.kind === 'lookup' && scopedSemantics.serviceEvidence && evidence
    && scopedSemantics.serviceEvidence.source === evidence.source) {
    return { allowed: true, kind: 'service', operation: 'search', service: { query: scopedSemantics.query, source: evidence.source } };
  }
  if (deterministic.kind === 'lookup' && deterministic.serviceEvidence) {
    return { allowed: true, kind: 'service', operation: 'search', service: { ...deterministic.serviceEvidence, query: deterministic.query } };
  }
  if (scoped && evidence) return { allowed: true, kind: 'service', operation: 'search', service: { ...evidence, query: canonical! } };
  if (input.understanding?.intent === 'PROGRAM_SEARCH' && input.understanding.confidence >= 0.8
    && evidence && input.understanding.entities.program_query) {
    return { allowed: true, kind: 'service', operation: 'search', service: { ...evidence, query: input.understanding.entities.program_query } };
  }
  if (input.pending && (input.validProvince || continuation) && !evidence) {
    return { allowed: true, kind: 'pending', operation: 'search', service: { query: input.pending.query, source: input.pending.source },
      ...(continuation ? { pendingExecution: { id: input.pending.id, query: input.pending.query, provinceId: continuation.id } } : {}) };
  }
  if (input.understanding && Number.isFinite(input.understanding.confidence) && input.understanding.confidence >= .8 && input.understanding.confidence <= 1
    && ['PROGRAM_MORE', 'PROGRAM_DETAIL', 'PROGRAM_SELECTION'].includes(input.understanding.intent)) {
    return { allowed: true, kind: 'catalog', service: null, operation: input.understanding.intent === 'PROGRAM_MORE' ? 'more' : input.understanding.intent === 'PROGRAM_DETAIL' ? 'detail' : 'selection' };
  }
  if (input.owner === 'coverage-context' && hasProvinceCoverageWording(text)) return { allowed: true, kind: 'catalog', operation: 'coverage', service: null };
  const decision = decideProgramLookup({ message: input.message, owner: input.owner === 'province-continuation' ? 'none' : input.owner,
    understanding: input.understanding ?? null });
  if (decision.kind === 'lookup') {
    return { allowed: true, kind: decision.serviceEvidence ? 'service' : 'catalog', operation: decision.intent === 'PROGRAM_SEARCH' ? 'search' : 'discovery', service: decision.serviceEvidence };
  }
  if (decision.kind === 'owned' && ['selection', 'coverage-context', 'program-detail', 'catalog-more'].includes(decision.owner)) {
    return { allowed: true, kind: 'catalog', operation: decision.owner === 'selection' ? 'selection' : decision.owner === 'program-detail' ? 'detail' : decision.owner === 'catalog-more' ? 'more' : 'discovery', service: null };
  }
  if (deterministic.kind === 'lookup' || input.existingCatalogRequest) return { allowed: true, kind: 'catalog', operation: 'discovery', service: null };
  return deny;
}

/** Only a bounded province answer may resume an existing request. */
export function provinceContinuation(message: string, provinces: ProvinceRecord[]): ProvinceRecord | null {
  const text = normalizeCatalogInput(message).trim().replace(/(?:ครับผม|ครับ|ค่ะ|คะ|ຄ່ະ|ຄະ)[.!?]*$/u, '').trim();
  return matchProvince(text, provinces);
}

export function pendingForExecution(a: CatalogAuthorization, action: { type: string; kind?: string; query?: string | null; province?: ProvinceRecord | null }): string | undefined {
  const pending = a.pendingExecution;
  return a.allowed && a.kind === 'pending' && pending && a.operation === 'search'
    && action.type === 'SEARCH' && action.kind === 'search'
    && action.query === pending.query && action.province?.id === pending.provinceId ? pending.id : undefined;
}
