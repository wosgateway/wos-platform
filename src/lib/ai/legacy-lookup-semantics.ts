import { extractConcreteServiceEvidence, type ConcreteServiceEvidence } from './concrete-service-evidence';
import type { LookupTurnOwner, ProgramLookupDecision } from './lookup-intent';
import { normalizeSelectionInput, SELECTION_SERVICE_ALIASES } from './selection-lexical';
import { SYMPTOM_SEARCH_ALIASES } from './symptom-intent';
import { normalizeCatalogInput } from './catalog-query-normalization';

export type LegacyLookupSemantics = Exclude<ProgramLookupDecision, { kind: 'lookup' }>
  | { kind: 'lookup'; intent: 'PROGRAM_SEARCH'; serviceEvidence: NonNullable<ConcreteServiceEvidence>; query: string }
  | { kind: 'lookup'; intent: 'PROGRAM_DISCOVERY'; serviceEvidence: null; query: null };

/** Bounded request grammar, not general Understanding. `none` has the same
 * caller-resolved ownership precondition as decideProgramLookup, including coverage.
 * Unknown request forms fail closed. No gate mode, state, I/O or inferred identity. */
export function deriveLegacyLookupSemantics({ message, owner }: { message: string; owner: LookupTurnOwner }): LegacyLookupSemantics {
  if (owner === 'unresolved') return { kind: 'defer', reason: 'unresolved-ownership' };
  if (owner === 'non-request') return { kind: 'not-lookup' };
  if (owner !== 'none') return { kind: 'owned', owner };

  const text = normalizeCatalogInput(normalizeSelectionInput(message)).trim();
  const serviceEvidence = extractConcreteServiceEvidence(message);
  // Request operators bind the whole turn and an exact shared service identity.
  // A bare title, quoted/negated mention or extra location clause is not enough.
  const request = text.match(/^อยาก\s*(?:โปรแกรม|บริการ)?\s*(.+?)(?:ครับ|ค่ะ|คะ)?[.!?？]*$/u)
    ?? text.match(/^มี\s*(?:โปรแกรม|บริการ)?\s*(.+?)\s*(?:บ้าง)?(?:ไหม|มั้ย)(?:ครับ|ค่ะ|คะ)?[?？]*$/u);
  if (request && serviceEvidence) {
    const target = request[1].trim();
    const query = SELECTION_SERVICE_ALIASES.map(([, canonical]) => canonical).find(canonical => canonical === target);
    if (query) return { kind: 'lookup', intent: 'PROGRAM_SEARCH', serviceEvidence, query };
    return { kind: 'defer', reason: 'conflicting-evidence' };
  }

  // The existing symptom fixture has a complaint followed by an explicit
  // program question. Require the complaint to start with a shared symptom;
  // finding a symptom inside a denial/quotation does not establish a request.
  const symptomRequest = text.match(/^(.+?)\s+มี(?:โปรแกรม|บริการ)อะไร(?:ที่เกี่ยวข้อง)?ไหม(?:ครับ|ค่ะ|คะ)?[?？]*$/u);
  if (symptomRequest && serviceEvidence?.source === 'symptom') {
    const complaint = symptomRequest[1].replace(/^ช่วงนี้\s*/u, '');
    if (SYMPTOM_SEARCH_ALIASES.some(([alias]) => complaint.startsWith(alias))) {
      return { kind: 'lookup', intent: 'PROGRAM_SEARCH', serviceEvidence, query: serviceEvidence.query };
    }
  }

  // Bounded unscoped forms from the committed program-overview contract.
  // No concrete service is broadened into discovery and no province is removed.
  if (!serviceEvidence && /^(?:(?:สนใจ|ขอดู|ดู|อยากดู|อยากทราบ)\s*(?:โปรแกรม|บริการ)|มี\s*(?:โปรแกรม|บริการ)\s*อะไร(?:บ้าง)?)(?:ครับ|ค่ะ|คะ)?[?？]*$/u.test(text)) {
    return { kind: 'lookup', intent: 'PROGRAM_DISCOVERY', serviceEvidence: null, query: null };
  }
  return { kind: 'not-lookup' };
}
