import { deriveWosJourneyState } from './src/lib/ai/journey-state';

type M = { role: 'user' | 'assistant'; content: string };
const history: M[] = [
  { role: 'user', content: 'ผมมาจากเวียงจันทน์' },
  { role: 'assistant', content: 'ได้เลยค่ะ' },
  { role: 'user', content: 'มีงบ 2,000 บาท' },
  { role: 'assistant', content: 'รับทราบค่ะ' },
  { role: 'user', content: 'สนใจตรวจสุขภาพ' },
  { role: 'assistant', content: '1. ตรวจสุขภาพ — DNA Wellness Center / อุดรธานี' },
];
const state = deriveWosJourneyState(history, '1');
const checks: Array<[string, boolean, unknown]> = [
  ['origin', state.origin === 'เวียงจันทน์', state.origin],
  ['budget', state.budgetThb === 2000, state.budgetThb],
  ['selected program', state.selectedProgram === 'ตรวจสุขภาพ', state.selectedProgram],
  ['health need', state.needs.includes('health'), state.needs],
  ['active treatment on knee', deriveWosJourneyState(history, 'หากผมปวดเข่า').activeNeed === 'treatment', deriveWosJourneyState(history, 'หากผมปวดเข่า').activeNeed],
  ['trip duration', deriveWosJourneyState(history, 'อยากไปอุดรสามวัน').tripDurationDays === 3, deriveWosJourneyState(history, 'อยากไปอุดรสามวัน').tripDurationDays],
  ['unlimited budget', deriveWosJourneyState(history, 'งบไม่จำกัด').budgetUnlimited === true, deriveWosJourneyState(history, 'งบไม่จำกัด').budgetUnlimited],
];
for (const [name, ok, value] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}:`, value);
if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log('JOURNEY_STATE_UNIT=PASS');
