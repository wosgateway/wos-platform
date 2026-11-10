import { extractConcreteServiceEvidence, type ConcreteServiceEvidence } from './concrete-service-evidence';
import { confidenceLevel } from './understanding/orchestrator';
import type { Understanding } from './understanding/types';
import type { LegacyLookupSemantics } from './legacy-lookup-semantics';

export type LookupTurnOwner = 'none' | 'unresolved' | 'non-request' | 'rejection'
  | 'deterministic-state' | 'selection' | 'coverage-context';

export type ProgramLookupSource =
  | { kind: 'gate'; authority: 'authoritative'; understanding: Understanding }
  | { kind: 'deterministic'; semantics: LegacyLookupSemantics };

export type ProgramLookupInput = {
  message: string;
  /** Validated semantic output for this message, not a category inferred from service evidence. */
  /** `none` asserts prior owners were checked, including coverage even if province was omitted
   * by Understanding. If that cannot be established, pass `unresolved`, never `none`. */
  owner: LookupTurnOwner;
} & ({ understanding: Understanding | null; source?: never } | { source: ProgramLookupSource; understanding?: never });

export type ProgramLookupDecision =
  | { kind: 'lookup'; intent: 'PROGRAM_SEARCH' | 'PROGRAM_DISCOVERY'; serviceEvidence: ConcreteServiceEvidence }
  | { kind: 'not-lookup' }
  | { kind: 'owned'; owner: 'rejection' | 'deterministic-state' | 'selection' | 'coverage-context' | 'program-detail' | 'catalog-more' }
  | { kind: 'defer'; reason: 'unresolved-ownership' | 'insufficient-understanding' | 'insufficient-service-evidence' | 'conflicting-evidence' };

/** Pure prerequisite, not a raw-text intent classifier or executable search action.
 * The caller resolves rejection, selection, non-request and pending-state ownership
 * using their existing owners. Those results outrank even a hostile PROGRAM_SEARCH.
 * No state replay, province resolution, query choice, catalog I/O or model call occurs here.
 */
export function decideProgramLookup(input: ProgramLookupInput): ProgramLookupDecision {
  const { message, owner } = input;
  if (owner === 'unresolved') return { kind: 'defer', reason: 'unresolved-ownership' };
  if (owner === 'non-request') return { kind: 'not-lookup' };
  if (owner !== 'none') return { kind: 'owned', owner };

  if (input.source?.kind === 'deterministic') {
    const result = input.source.semantics;
    if (result.kind !== 'lookup') return result;
    return { kind: 'lookup', intent: result.intent, serviceEvidence: result.serviceEvidence };
  }
  const u = input.source?.kind === 'gate' ? input.source.understanding : input.understanding;

  if (!u || !Number.isFinite(u.confidence) || u.confidence > 1
    || confidenceLevel(u.confidence) !== 'high' || u.intent === 'UNKNOWN') {
    return { kind: 'defer', reason: 'insufficient-understanding' };
  }
  if (u.intent === 'PROGRAM_SELECTION') return { kind: 'owned', owner: 'selection' };
  if (u.intent === 'PROGRAM_DETAIL') return { kind: 'owned', owner: 'program-detail' };
  if (u.intent === 'PROGRAM_MORE') return { kind: 'owned', owner: 'catalog-more' };
  if (u.intent !== 'PROGRAM_SEARCH' && u.intent !== 'PROGRAM_DISCOVERY') return { kind: 'not-lookup' };

  // This phase cannot authorize a province/context-dependent catalog route.
  if (u.entities.province || u.uses_context) return { kind: 'owned', owner: 'coverage-context' };

  const serviceEvidence = extractConcreteServiceEvidence(message);
  if (u.intent === 'PROGRAM_SEARCH' && (!serviceEvidence || !u.entities.program_query?.trim())) {
    return { kind: 'defer', reason: 'insufficient-service-evidence' };
  }
  if (u.intent === 'PROGRAM_DISCOVERY' && serviceEvidence) {
    return { kind: 'defer', reason: 'conflicting-evidence' };
  }
  return { kind: 'lookup', intent: u.intent, serviceEvidence };
}
