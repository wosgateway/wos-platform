import { describe, expect, it } from 'vitest';
import { extractConcreteServiceEvidence } from './concrete-service-evidence';

describe('concrete service evidence, not affirmative intent', () => {
  it.each([
  "มีโปรแกรมตรวจสุขภาพในจังหวัดอุดรธานีไหม",
  "มีโปรแกรมตรวจสุขภาพในจังหวัดอุดรธานีอะไรบ้าง",
  "ตรวจสุขภาพที่อุดรมีไหม",
  "อยากตรวจสุขภาพที่อุดรธานี",
  "มีโปรแกรมตรวจสุขภาพไหม",
  "อยากตรวจเข่า",
  "ตรวจสุขภาพ",
  "ตรวจเข่า",
  "ไม่เอาตรวจสุขภาพ",
  "ไม่ได้ถามเรื่องตรวจเข่า",
  "ไม่มีตรวจสุขภาพใช่ไหม",
  "อยากตรวจสุขภาพและตรวจเข่า"
])('preserves full explicit message: %s', message => {
    expect(extractConcreteServiceEvidence(message)).toEqual({ query: message, source: 'explicit-service' });
  });
  it.each([
  "มีจังหวัดไหนบ้าง",
  "ให้บริการจังหวัดอะไรบ้าง",
  "ครอบคลุมจังหวัดไหนบ้าง",
  "มีบริการในจังหวัดไหนบ้าง",
  "มีโปรแกรมอะไรบ้าง",
  "มีบริการอะไรบ้าง",
  "มีโปรแกรมสุขภาพอะไรบ้าง",
  "อุดรธานีมีบริการอะไรบ้าง",
  "อุดรธานีมีโปรแกรมอะไรบ้าง",
  "พื้นที่ให้บริการมีที่ไหนบ้าง",
  "ปวดท้อง",
  "สุขภาพ",
  "โปรแกรมสุขภาพ",
  "โปรแกรม",
  "บริการ",
  "จังหวัด",
  "ครอบคลุมจังหวัด",
  "พื้น",
  "อุดรธานี",
  "abcตรวจสุขภาพ",
  "ตรวจเข่า123",
  "ตรวจสุขภาพั"
])('does not infer evidence: %s', message => {
    expect(extractConcreteServiceEvidence(message)).toBeNull();
  });
  it.each([
    'abcตรวจสุขภาพ',
    'ตรวจสุขภาพabc',
    '1ตรวจสุขภาพ',
    'ตรวจสุขภาพ1',
    '_ตรวจสุขภาพ',
    'ตรวจสุขภาพ_',
    '𝟙ตรวจสุขภาพ',
    'ตรวจสุขภาพ𝟙',
    '𝐀ตรวจสุขภาพ',
    'ตรวจสุขภาพ𝐀',
    'ตรวจสุขภาพ\u0301',
  ])('rejects word-like boundaries by code point: %s', message => {
    expect(extractConcreteServiceEvidence(message)).toBeNull();
  });
  it.each([
    'อยากตรวจสุขภาพครับ',
    'ຢາກກວດສຸຂະພາບ',
    '(ตรวจสุขภาพ)',
    'ตรวจสุขภาพ,ตรวจเข่า',
    'abcตรวจสุขภาพ ตรวจสุขภาพ',
    'ตรวจสุขภาพตรวจเข่า',
  ])('allows natural text, punctuation, or a later valid occurrence: %s', message => {
    expect(extractConcreteServiceEvidence(message)).toEqual({
      query: message.replace('ກວດສຸຂະພາບ', 'ตรวจสุขภาพ'), source: 'explicit-service',
    });
  });
  it.each([
    ['ກວດສຸຂະພາບ', 'ตรวจสุขภาพ'],
    ['ກວດເຂົ່າ', 'ตรวจเข่า'],
  ])('uses committed lexical aliases: %s', (message, query) => {
    expect(extractConcreteServiceEvidence(message)).toEqual({ query, source: 'explicit-service' });
  });
  it.each(['ปวดเข่า', 'ตรวจสุขภาพและปวดเข่า'])('preserves baseline symptom precedence: %s', message => {
    expect(extractConcreteServiceEvidence(message)).toEqual({ query: 'ตรวจเข่า', source: 'symptom' });
  });
});
