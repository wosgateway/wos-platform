import { normalizeSelectionInput, SELECTION_SERVICE_ALIASES } from './selection-lexical';
import { getSymptomSearchAliases } from './symptom-intent';

export type ConcreteServiceEvidence = {
  query: string;
  source: 'explicit-service' | 'symptom';
} | null;

const canonicalTargets = [...new Set(SELECTION_SERVICE_ALIASES.map(([, service]) => service))];

function isForbiddenAdjacent(character: string): boolean {
  // Thai/Lao letters permit natural concatenation; other Unicode letters,
  // including supplementary ones, must not embed a service in a word.
  return /[\p{N}_]/u.test(character)
    || (/\p{L}/u.test(character) && !/[\p{Script=Thai}\p{Script=Lao}]/u.test(character));
}

/** Explicit recognition is limited to canonical targets in the committed lexical
 * aliases; not arbitrary catalog titles, membership, an ontology, or booking/affirmative intent. */
export function extractConcreteServiceEvidence(message: string): ConcreteServiceEvidence {
  const symptom = getSymptomSearchAliases(message)[0];
  if (symptom) return { query: symptom, source: 'symptom' };

  const query = normalizeSelectionInput(message);
  const explicit = canonicalTargets.some(service => {
    let index = query.indexOf(service);
    while (index !== -1) {
      const before = query.slice(0, index).match(/[\s\S]$/u)?.[0] ?? '';
      const after = query.slice(index + service.length).match(/^[\s\S]/u)?.[0] ?? '';
      // Unicode-mode matches inspect complete code points on both sides.
      // A trailing mark cannot extend the canonical service spelling.
      if (!isForbiddenAdjacent(before)
        && !isForbiddenAdjacent(after) && !/\p{M}/u.test(after)) return true;
      index = query.indexOf(service, index + service.length);
    }
    return false;
  });
  return explicit ? { query, source: 'explicit-service' } : null;
}
