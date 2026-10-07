import { describe, expect, it } from 'vitest';
import { getSymptomSearchAliases } from './symptom-intent';

describe('symptom intent', () => {
  it('routes Lao knee pain to the verified knee catalog query', () => {
    expect(getSymptomSearchAliases('ຂ້ອຍປວດຫົວເຂົ່າ')).toEqual(['ตรวจเข่า']);
  });

  it('routes Lao knee check wording to the verified knee catalog query', () => {
    expect(getSymptomSearchAliases('ຂ້ອຍຢາກໄປກວດຫົວເຂົ່າ')).toEqual(['ตรวจเข่า']);
  });

  it('keeps Thai knee routing unchanged', () => {
    expect(getSymptomSearchAliases('ผมปวดเข่า')).toEqual(['ตรวจเข่า']);
  });
});
