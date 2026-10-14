// Trial case for the Overnight Agent: the Thai abbreviation marker "จ" written WITHOUT a dot
// (very common in chat: "ไปเที่ยว จ ตาก") must work like "จ.ตาก" for short province names,
// while ordinary words such as "เลย" must still never match.
import { describe, expect, it } from 'vitest';
import { detectProvinceInText, type ProvinceRecord } from './provinces';

const P = (id: string, th: string, en: string): ProvinceRecord => ({ id, name_th: th, name_en: en, name_lo: null, aliases: [] });
const provinces = [P('tak', 'ตาก', 'Tak'), P('loei', 'เลย', 'Loei'), P('udon-thani', 'อุดรธานี', 'Udon Thani')];

describe('province abbreviation marker without a dot', () => {
  it('"จ ตาก" and "จ เลย" resolve like "จ.ตาก"', () => {
    expect(detectProvinceInText('ไปเที่ยว จ ตาก', provinces)?.id).toBe('tak');
    expect(detectProvinceInText('\u0e08\u0e15\u0e32\u0e01', provinces)).toBeNull();
    expect(detectProvinceInText('อยากไป จ เลย', provinces)?.id).toBe('loei');
    expect(detectProvinceInText('จ.ตาก', provinces)?.id).toBe('tak');
  });
  it('ordinary words still never match short names', () => {
    expect(detectProvinceInText('ไม่มีเลยค่ะ', provinces)).toBeNull();
    expect(detectProvinceInText('ขอบคุณมากเลย', provinces)).toBeNull();
    expect(detectProvinceInText('อยากรู้จักตากล้อง', provinces)).toBeNull();
  });
});
