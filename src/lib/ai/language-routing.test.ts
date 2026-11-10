import { describe, expect, it } from 'vitest';
import { resolveWosLanguageProfile } from './language-routing';

describe('resolveWosLanguageProfile', () => {
  it('detects Thai from the current message', () => {
    expect(resolveWosLanguageProfile('สนใจตรวจเข่า').language).toBe('th');
  });

  it('detects Lao from the current message', () => {
    const result = resolveWosLanguageProfile('ຂ້ອຍສົນໃຈກວດສຸຂະພາບ');
    expect(result.language).toBe('lo');
    expect(result.isMixedThaiLao).toBe(false);
  });

  it('marks Thai-Lao code-switching as mixed while selecting a dominant response language', () => {
    const result = resolveWosLanguageProfile('ຂ້ອຍສົນໃຈ ตรวจเข่า');
    expect(result.isMixedThaiLao).toBe(true);
    expect(result.hasThai).toBe(true);
    expect(result.hasLao).toBe(true);
    expect(result.language).toBe('lo');
  });

  it('does not mistake English words inside a Thai sentence for an English conversation', () => {
    expect(resolveWosLanguageProfile('สนใจ program ตรวจเข่า').language).toBe('th');
  });

  it('inherits the latest meaningful customer language for a numeric reply', () => {
    const result = resolveWosLanguageProfile('1', ['สวัสดีค่ะ', 'ຂ້ອຍສົນໃຈ']);
    expect(result.language).toBe('lo');
    expect(result.source).toBe('history');
  });

  it('uses the current language when the customer clearly switches language', () => {
    expect(resolveWosLanguageProfile('Please help me', ['ຂ້ອຍສົນໃຈ']).language).toBe('en');
  });

  it('defaults conservatively when no language signal exists', () => {
    expect(resolveWosLanguageProfile('123').source).toBe('default');
  });
});
