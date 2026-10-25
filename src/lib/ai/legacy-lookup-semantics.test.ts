import { describe, expect, it } from 'vitest';
import { extractConcreteServiceEvidence } from './concrete-service-evidence';
import { deriveLegacyLookupSemantics } from './legacy-lookup-semantics';
import type { LookupTurnOwner } from './lookup-intent';

const decide = (message: string, owner: LookupTurnOwner = 'none') => deriveLegacyLookupSemantics({ message, owner });
describe('deterministic ordinary lookup semantics, without execution or Understanding fabrication', () => {
  it.each([
    ['อยากตรวจเข่า', 'ตรวจเข่า'],
    ['อยากตรวจสุขภาพครับ', 'ตรวจสุขภาพ'],
    ['มีตรวจเข่าไหม', 'ตรวจเข่า'],
    ['มีโปรแกรมตรวจสุขภาพไหมคะ?', 'ตรวจสุขภาพ'],
    ['อยากກວດເຂົ່າ', 'ตรวจเข่า'],
  ])('requires positive request syntax and shared identity: %s', (message, query) => {
    expect(decide(message)).toEqual({ kind: 'lookup', intent: 'PROGRAM_SEARCH', serviceEvidence: extractConcreteServiceEvidence(message), query });
  });
  it('reuses the existing symptom fixture and mapped query', () => {
    const message = 'ช่วงนี้ปวดเข่าเวลาเดินขึ้นบันได มีโปรแกรมอะไรที่เกี่ยวข้องไหม';
    expect(decide(message)).toEqual({ kind: 'lookup', intent: 'PROGRAM_SEARCH', serviceEvidence: { query: 'ตรวจเข่า', source: 'symptom' }, query: 'ตรวจเข่า' });
  });
  it.each(['สนใจโปรแกรม', 'ขอดูโปรแกรม', 'มีโปรแกรมอะไรบ้าง'])('supports bounded existing discovery wording: %s', message => {
    expect(decide(message)).toEqual({ kind: 'lookup', intent: 'PROGRAM_DISCOVERY', serviceEvidence: null, query: null });
  });
  it.each(['ไม่ได้ถามเรื่องตรวจเข่า', 'ขอบคุณ', 'ตรวจเข่า', 'ກວດເຂົ່າ', 'ปวดเข่า', 'วันนี้อากาศดีไหม', 'อยากบริการที่แต่งขึ้น', 'มีบริการที่แต่งขึ้นไหม'])('does not promote a mention or unrelated question: %s', message => {
    expect(decide(message)).toEqual({ kind: 'not-lookup' });
  });
  it('keeps service evidence separate from intent', () => {
    expect(extractConcreteServiceEvidence('ไม่ได้ถามเรื่องตรวจเข่า')).not.toBeNull();
    expect(decide('ไม่ได้ถามเรื่องตรวจเข่า').kind).toBe('not-lookup');
  });
  it.each([
    ['ไม่เอาตรวจเข่า', 'rejection'],
    ['เลือกตรวจสุขภาพ', 'selection'],
    ['ไม่ ขอบคุณครับ', 'deterministic-state'],
    ['มีโปรแกรมตรวจสุขภาพในจังหวัดอุดรธานีไหม', 'coverage-context'],
    ['อยากตรวจเข่า', 'selection'],
  ] as const)('preserves resolved owner for %s', (message, owner) => {
    expect(decide(message, owner)).toEqual({ kind: 'owned', owner });
  });
  it('requires explicit ownership resolution for province-only/context turns', () => {
    expect(decide('อุดร', 'unresolved')).toEqual({ kind: 'defer', reason: 'unresolved-ownership' });
    expect(decide('อยากตรวจเข่า', 'unresolved')).toEqual({ kind: 'defer', reason: 'unresolved-ownership' });
  });
  it('does not turn named rejection into lookup even with an unclaimed owner', () => {
    expect(decide('ไม่เอาตรวจเข่า')).toEqual({ kind: 'not-lookup' });
  });
  it('cannot authorize a service/province sentence through the ordinary request grammar', () => {
    expect(decide('มีโปรแกรมตรวจสุขภาพในจังหวัดอุดรธานีไหม')).toEqual({ kind: 'defer', reason: 'conflicting-evidence' });
  });
  it('respects a caller-established non-request even if its surface looks positive', () => {
    expect(decide('อยากตรวจเข่า', 'non-request')).toEqual({ kind: 'not-lookup' });
  });
  it('is mode independent, repeatable, and does not mutate its input', () => {
    const input = Object.freeze({ message: 'อยากตรวจเข่า', owner: 'none' as const });
    expect(deriveLegacyLookupSemantics(input)).toEqual(deriveLegacyLookupSemantics(input));
    expect(input).toEqual({ message: 'อยากตรวจเข่า', owner: 'none' });
  });
});
