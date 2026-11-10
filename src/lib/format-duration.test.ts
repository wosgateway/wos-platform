import { describe, expect, it } from 'vitest';
import { formatDurationMinutes } from './format-duration';

describe('canonical integer-minute presentation boundary', () => {
  it.each([['th', '60 นาที'], ['lo', '60 ນາທີ'], ['en', '60 minutes']])(
    'formats minutes for %s without converting units', (locale, expected) => {
      expect(formatDurationMinutes(60, locale)).toBe(expected);
    }
  );
  it('preserves absent values and does not parse strings', () => {
    expect(formatDurationMinutes(null, 'th')).toBeNull();
    expect(formatDurationMinutes(undefined, 'th')).toBeNull();
    expect(formatDurationMinutes('60 นาที' as unknown as number, 'th')).toBeNull();
    expect(formatDurationMinutes(1.5, 'th')).toBeNull();
  });
  it('keeps zero distinct from NULL', () => {
    expect(formatDurationMinutes(0, 'en')).toBe('0 minutes');
  });
});
