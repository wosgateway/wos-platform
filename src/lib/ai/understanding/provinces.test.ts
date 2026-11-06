import { describe, expect, it } from 'vitest';
import { detectProvinceInText, matchProvince, resolveProvinceFromEvidence, type ProvinceRecord } from './provinces';

const provinces: ProvinceRecord[] = [
  { id: 'savannakhet', name_th: 'สะหวันนะเขต', name_en: 'Savannakhet', name_lo: 'ສະຫວັນນະເຂດ', aliases: ['Kaysone Phomvihane'] },
  { id: 'sakon-nakhon', name_th: 'สกลนคร', name_en: 'Sakon Nakhon', name_lo: 'ສະກົນນະຄອນ', aliases: [] },
  { id: 'udon', name_th: 'อุดรธานี', name_en: 'Udon Thani', name_lo: 'ອຸດອນທານີ', aliases: ['Udon'] },
];

describe('cross-border province matching', () => {
  it('matches Savannakhet exactly and does not confuse it with Sakon Nakhon', () => {
    expect(matchProvince('Savannakhet', provinces)?.id).toBe('savannakhet');
    expect(detectProvinceInText('Pickup in Savannakhet, Laos', provinces)?.id).toBe('savannakhet');
  });

  it('returns no province when the message explicitly names two different provinces', () => {
    expect(detectProvinceInText('Savannakhet or Sakon Nakhon', provinces)).toBeNull();
  });

  it('matches Lao province names', () => {
    expect(detectProvinceInText('ຂ້ອຍຢູ່ສະຫວັນນະເຂດ', provinces)?.id).toBe('savannakhet');
  });

  it('prefers the explicit customer place over an incorrect model extraction', () => {
    const result = resolveProvinceFromEvidence('Sakon Nakhon', 'Pickup in Savannakhet, Laos', provinces);
    expect(result.ambiguous).toBe(false);
    expect(result.province?.id).toBe('savannakhet');
  });

  it('refuses to select a province when multiple are explicitly mentioned', () => {
    const result = resolveProvinceFromEvidence('Sakon Nakhon', 'Savannakhet or Sakon Nakhon', provinces);
    expect(result.ambiguous).toBe(true);
    expect(result.province).toBeNull();
  });
});
