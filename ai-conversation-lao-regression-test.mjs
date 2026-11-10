#!/usr/bin/env node
const args = process.argv.slice(2);
const idx = args.indexOf('--base-url');
const BASE_URL = (idx >= 0 && args[idx + 1] ? args[idx + 1] : 'http://127.0.0.1:3036').replace(/\/$/, '');
const ENDPOINT = BASE_URL + '/api/ai/chat';
const TEST_IP = process.env.WOS_AI_REGRESSION_IP || '198.18.0.204';
let history = [];

async function ask(message) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': TEST_IP },
    body: JSON.stringify({ message, history }),
  });
  const body = await res.json();
  const answer = String(body.answer ?? body.message ?? body.error ?? '');
  console.log('USER:', message);
  console.log('AI:', answer);
  console.log('---');
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  history = [...history, { role: 'user', content: message }, { role: 'assistant', content: answer }].slice(-10);
  return answer;
}

const list = await ask('ມີໂປຣແກຣມຫຍັງຢູ່ອຸດອນ?');
if (!/[\u0E80-\u0EFF]/u.test(list) || !/\d\./u.test(list)) throw new Error('Lao program list failed');

const ambiguous = await ask('ສົນໃຈຕ້ອງເຮັດແນວໃດ?');
if (!/[\u0E80-\u0EFF]/u.test(ambiguous) || !/ໂປຣແກຣມ|ໝາຍເລກ/u.test(ambiguous)) throw new Error('Lao ambiguity handling failed');

const selected = await ask('1');
if (!/[\u0E80-\u0EFF]/u.test(selected) || /^(Sure|Sorry|I |If |To )/m.test(selected)) throw new Error('Lao numeric selection/language continuity failed');

const price = await ask('ລາຄາເທົ່າໃດ?');
if (!/[\u0E80-\u0EFF]/u.test(price)) throw new Error('Lao price follow-up language failed');

const booking = await ask('ຈະຈອງແນວໃດ?');
if (!/[\u0E80-\u0EFF]/u.test(booking) || !/WOS/u.test(booking)) throw new Error('Lao booking route failed');

console.log('LAO_CONVERSATION_REGRESSION=PASS');
