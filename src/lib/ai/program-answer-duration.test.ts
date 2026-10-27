import { describe, expect, it } from 'vitest';
import { buildProgramAnswer } from './program-answer';

describe('program answers retain canonical integer-minute presentation', () => {
  it.each([
    ['th', 'ระยะเวลา 60 นาที'],
    ['lo', 'ໄລຍະເວລາ 60 ນາທີ'],
    ['en', 'Duration: 60 minutes'],
  ] as const)('renders the verified duration without converting units in %s', (language, duration) => {
    const reply = buildProgramAnswer([
      { title: 'ตรวจเข่า', duration: 60 },
    ], 'รายละเอียด', '', language);
    expect(reply).toContain(duration);
    expect(reply).not.toMatch(/ชั่วโมง|ຊົ່ວໂມງ|hours?/i);
  });

  it('omits missing duration instead of inventing zero minutes', () => {
    const reply = buildProgramAnswer([
      { title: 'ตรวจเข่า', duration: null },
    ], 'details', '', 'en');
    expect(reply).toContain('ตรวจเข่า');
    expect(reply).not.toContain('Duration:');
    expect(reply).not.toContain('0 minutes');
  });
});
