import { describe, expect, it } from 'vitest';
import { normalizeSelectionInput } from './selection-lexical';

describe('shared selection lexical normalization', () => {
  it.each([
    ['เลือกตรวจเข่า', 'เลือกตรวจเข่า'],
    ['เลือกตรวจสุขภาพ', 'เลือกตรวจสุขภาพ'],
    ['ເລືອກ', 'เลือก'],
    ['ກວດເຂົ່າ', 'ตรวจเข่า'],
    ['ກວດສຸຂະພາບ', 'ตรวจสุขภาพ'],
    ['ເລືອກກວດເຂົ່າ', 'เลือกตรวจเข่า'],
    ['ເລືອກກວດສຸຂະພາບ', 'เลือกตรวจสุขภาพ'],
    ['เลือกກວດເຂົ່າ', 'เลือกตรวจเข่า'],
  ])('%s becomes %s', (input, expected) => {
    expect(normalizeSelectionInput(input)).toBe(expected);
    expect(normalizeSelectionInput(expected)).toBe(expected);
  });

  it('normalizes Unicode to NFC', () => {
    expect(normalizeSelectionInput('Cafe\u0301')).toBe('Café');
  });

  it('removes exactly the existing zero-width characters', () => {
    expect(normalizeSelectionInput('ເລືອກ\u200bກວດ\u200cເຂົ່າ\u200d\ufeff')).toBe('เลือกตรวจเข่า');
  });

  it.each(['วันนี้อากาศดี', 'ມີໂປຣແກຣມຢູ່ແຂວງອຸດອນບໍ', 'unknown service 99', '  hello  ', ''])('does not interpret unrelated text: %s', input => {
    expect(normalizeSelectionInput(input)).toBe(input);
  });
});
