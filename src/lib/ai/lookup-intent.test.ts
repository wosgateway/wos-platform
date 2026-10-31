import { describe, expect, it } from 'vitest';
import { extractConcreteServiceEvidence } from './concrete-service-evidence';
import { deriveWosJourneyState, extractExplicitProgramTitle, extractRejectedProgramTitle } from './journey-state';
import { decideProgramLookup, type ProgramLookupInput } from './lookup-intent';
import type { Understanding } from './understanding/types';

// Semantic fixtures represent the Understanding owner's output, not a text classifier.
const semantic = (intent: Understanding['intent'], query: string | null = null): Understanding => ({
  intent, confidence: 0.99, language: 'th', uses_context: false,
  entities: { province: null, program_query: query, selection_index: null, detail_field: null },
});
const input = (message: string, understanding: Understanding | null): ProgramLookupInput => ({
  message, understanding, owner: 'none',
});
const search = (message: string) => input(message, semantic('PROGRAM_SEARCH', 'ตรวจเข่า'));
const history = [
  { role: 'user' as const, content: 'เลือกตรวจเข่า' },
  { role: 'assistant' as const, content: 'ได้เลยค่ะ 😊 ขอชื่อสำหรับลงข้อมูลให้ทีม WOS ประสานงานต่อด้วยนะคะ' },
  { role: 'user' as const, content: 'สมชาย' },
  { role: 'assistant' as const, content: 'รับทราบค่ะ 😊 สนใจรถรับส่งด้วยไหมคะ?' },
];

describe('shared program lookup prerequisite: evidence is not request intent', () => {
  it('accepts deterministic semantics without a fabricated Understanding', () => {
    const message = 'อยากตรวจเข่า';
    const serviceEvidence = extractConcreteServiceEvidence(message)!;
    expect(decideProgramLookup({ message, owner: 'none', source: { kind: 'deterministic', semantics: { kind: 'lookup', intent: 'PROGRAM_SEARCH', serviceEvidence, query: 'ตรวจเข่า' } } })).toEqual({ kind: 'lookup', intent: 'PROGRAM_SEARCH', serviceEvidence });
  });
  it('preserves a deterministic non-lookup decision', () => {
    expect(decideProgramLookup({ message: 'ไม่ได้ถามเรื่องตรวจเข่า', owner: 'none', source: { kind: 'deterministic', semantics: { kind: 'not-lookup' } } })).toEqual({ kind: 'not-lookup' });
  });
  it('does not let a positive source override a prior owner', () => {
    expect(decideProgramLookup({ message: 'เลือกตรวจสุขภาพ', owner: 'selection', source: { kind: 'gate', authority: 'authoritative', understanding: semantic('PROGRAM_SEARCH', 'ตรวจสุขภาพ') } })).toEqual({ kind: 'owned', owner: 'selection' });
  });
  it('authoritative non-search is not replaced with deterministic intent', () => {
    expect(decideProgramLookup({ message: 'อยากตรวจเข่า', owner: 'none', source: { kind: 'gate', authority: 'authoritative', understanding: semantic('GENERAL_QUESTION') } })).toEqual({ kind: 'not-lookup' });
  });
  it.each([
    'อยากตรวจเข่า',
    'ปวดเข่า มีโปรแกรมอะไรที่เกี่ยวข้องไหม',
    'มีตรวจเข่าไหม',
    'ຢາກກວດເຂົ່າ',
  ])('allows a semantically established positive service request: %s', message => {
    expect(decideProgramLookup(search(message))).toEqual({
      kind: 'lookup', intent: 'PROGRAM_SEARCH', serviceEvidence: extractConcreteServiceEvidence(message),
    });
  });

  it('supports broad program discovery without inventing concrete service evidence', () => {
    const message = 'มีโปรแกรมสุขภาพอะไรบ้าง';
    expect(extractConcreteServiceEvidence(message)).toBeNull();
    expect(decideProgramLookup(input(message, semantic('PROGRAM_DISCOVERY')))).toEqual({
      kind: 'lookup', intent: 'PROGRAM_DISCOVERY', serviceEvidence: null,
    });
  });

  it('keeps independently identified named rejection ahead of a hostile search classification', () => {
    const message = 'ไม่เอาตรวจเข่า';
    expect(extractRejectedProgramTitle(message, history)).toBe('ตรวจเข่า');
    expect(extractConcreteServiceEvidence(message)).not.toBeNull();
    expect(decideProgramLookup({ ...search(message), owner: 'rejection' })).toEqual({ kind: 'owned', owner: 'rejection' });
  });

  it('does not promote non-request service evidence into lookup', () => {
    const message = 'ไม่ได้ถามเรื่องตรวจเข่า';
    expect(extractConcreteServiceEvidence(message)).not.toBeNull();
    expect(decideProgramLookup(input(message, semantic('GENERAL_QUESTION')))).toEqual({ kind: 'not-lookup' });
    expect(decideProgramLookup({ ...search(message), owner: 'non-request' })).toEqual({ kind: 'not-lookup' });
  });

  it('preserves caller-resolved pending concierge ownership without replaying state inside the helper', () => {
    const message = 'ไม่ ขอบคุณครับ';
    const state = deriveWosJourneyState(history, message);
    expect(state).toMatchObject({ selectedProgram: 'ตรวจเข่า', activePendingQuestion: 'transport', transportNeeded: false, answeredQuestion: 'transport' });
    expect(decideProgramLookup({ ...search(message), owner: 'deterministic-state' })).toEqual({ kind: 'owned', owner: 'deterministic-state' });
  });

  it('keeps explicit replacement with the selection owner, even if Understanding says search', () => {
    const message = 'เลือกตรวจสุขภาพ';
    expect(extractExplicitProgramTitle(message)).toBe('ตรวจสุขภาพ');
    expect(extractConcreteServiceEvidence(message)).not.toBeNull();
    expect(decideProgramLookup({ ...search(message), owner: 'selection' })).toEqual({ kind: 'owned', owner: 'selection' });
    expect(decideProgramLookup(input(message, semantic('PROGRAM_SELECTION')))).toEqual({ kind: 'owned', owner: 'selection' });
  });

  it('leaves service + province coverage separately owned even when the classifier omitted province', () => {
    const message = 'มีโปรแกรมตรวจสุขภาพในจังหวัดอุดรธานีไหม';
    expect(extractConcreteServiceEvidence(message)).not.toBeNull();
    expect(decideProgramLookup({ ...input(message, semantic('PROGRAM_SEARCH', message)), owner: 'coverage-context' })).toEqual({ kind: 'owned', owner: 'coverage-context' });
  });

  it('defers a province-only turn without sufficient context', () => {
    expect(extractConcreteServiceEvidence('อุดร')).toBeNull();
    expect(decideProgramLookup({ ...input('อุดร', null), owner: 'unresolved' })).toEqual({ kind: 'defer', reason: 'unresolved-ownership' });
  });

  it('keeps thanks-only outside lookup', () => {
    expect(decideProgramLookup(input('ขอบคุณ', semantic('SMALLTALK')))).toEqual({ kind: 'not-lookup' });
  });

  it.each(['PROGRAM_DETAIL', 'PROGRAM_MORE'] as const)('preserves the distinct catalog operation %s', intent => {
    expect(decideProgramLookup(input('ขอรายละเอียดเพิ่มเติม', semantic(intent)))).toEqual({
      kind: 'owned', owner: intent === 'PROGRAM_DETAIL' ? 'program-detail' : 'catalog-more',
    });
  });

  it('requires resolved ownership even when service evidence and a positive category exist', () => {
    expect(decideProgramLookup({ ...search('อยากตรวจเข่า'), owner: 'unresolved' })).toEqual({ kind: 'defer', reason: 'unresolved-ownership' });
  });

  it.each([null, semantic('UNKNOWN'), { ...semantic('PROGRAM_SEARCH', 'ตรวจเข่า'), confidence: 0.79 }])('does not invent missing/high-confidence intent', understanding => {
    expect(decideProgramLookup(input('อยากตรวจเข่า', understanding))).toEqual({ kind: 'defer', reason: 'insufficient-understanding' });
  });

  it('does not treat a known symptom alone as proof of a positive request', () => {
    const message = 'ปวดเข่า';
    expect(extractConcreteServiceEvidence(message)).toEqual({ query: 'ตรวจเข่า', source: 'symptom' });
    expect(decideProgramLookup(input(message, null))).toEqual({ kind: 'defer', reason: 'insufficient-understanding' });
  });

  it('leaves province and context-dependent catalog decisions to their separate owner', () => {
    for (const understanding of [
      { ...semantic('PROGRAM_SEARCH', 'ตรวจเข่า'), entities: { ...semantic('PROGRAM_SEARCH').entities, province: 'อุดรธานี', program_query: 'ตรวจเข่า' } },
      { ...semantic('PROGRAM_SEARCH', 'ตรวจเข่า'), uses_context: true },
    ]) expect(decideProgramLookup(input('แล้วตรวจเข่าล่ะ', understanding))).toEqual({ kind: 'owned', owner: 'coverage-context' });
  });

  it('does not infer an unsupported service or search target from the category alone', () => {
    expect(decideProgramLookup(input('มีบริการที่แต่งขึ้นไหม', semantic('PROGRAM_SEARCH', 'บริการที่แต่งขึ้น')))).toEqual({ kind: 'defer', reason: 'insufficient-service-evidence' });
    expect(decideProgramLookup(input('อยากตรวจเข่า', semantic('PROGRAM_SEARCH')))).toEqual({ kind: 'defer', reason: 'insufficient-service-evidence' });
  });

  it('does not broaden a concrete service mention into discovery when semantic evidence conflicts', () => {
    expect(decideProgramLookup(input('มีตรวจเข่าไหม', semantic('PROGRAM_DISCOVERY')))).toEqual({ kind: 'defer', reason: 'conflicting-evidence' });
  });
});
