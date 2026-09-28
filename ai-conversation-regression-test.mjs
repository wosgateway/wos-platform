#!/usr/bin/env node
const args=process.argv.slice(2);
const idx=args.indexOf('--base-url');
const BASE_URL=(idx>=0&&args[idx+1]?args[idx+1]:'http://127.0.0.1:3026').replace(/\/$/,'');
const ENDPOINT=`${BASE_URL}/api/ai/chat`;
const TEST_IP=process.env.WOS_AI_REGRESSION_IP||'198.18.0.201';
const optionList='1. ตรวจเข่า — INDY CLINICS / อุดรธานี\nราคาโปรโมชั่น 1,500 บาท (ราคาปกติ 1,900 บาท)\nระยะเวลา 1 ชม\n\n2. ตรวจสุขภาพ — DNA Wellness Center / อุดรธานี\nราคาโปรโมชั่น 1,900 บาท (ราคาปกติ 2,500 บาท)\nระยะเวลา 2 ชั่วโมง';
let history=[{role:'user',content:'โปรแกรมอุดรมีอะไรบ้าง'},{role:'assistant',content:optionList}];
async function ask(message){
 const res=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':TEST_IP},body:JSON.stringify({message,history})});
 const body=await res.json(); const answer=String(body.answer??body.message??body.error??'');
 console.log(`USER: ${message}`); console.log(`AI: ${answer}`); console.log('---');
 if(res.status!==200) throw new Error(`HTTP ${res.status}`);
 history=[...history,{role:'user',content:message},{role:'assistant',content:answer}].slice(-10);
 return answer;
}
const ambiguous=await ask('สนใจต้องทำไง');
if(!/สนใจตัวไหน|บอกหมายเลข|1\./u.test(ambiguous)) throw new Error('ambiguous follow-up did not ask for selection');
const selected=await ask('1');
if(!/ตรวจเข่า/u.test(selected)||!/[\u0E00-\u0EFF]/u.test(selected)) throw new Error('numeric selection lost selected program or Thai language');
const contact=await ask('ผมต้องติดต่อใคร');
if(!/WOS|จองผ่าน/u.test(contact)) throw new Error('WOS booking route missing');
const price=await ask('ราคาเท่าไหร่');
if(!/1,500|1500/u.test(price)||/ตรวจสุขภาพ/u.test(price)) throw new Error('active selected program was lost on price follow-up');
console.log('CONVERSATION_REGRESSION=PASS');