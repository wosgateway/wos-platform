#!/usr/bin/env node
const args=process.argv.slice(2);
const i=args.indexOf('--base-url');
const BASE=(i>=0&&args[i+1]?args[i+1]:'http://127.0.0.1:3029').replace(/\/$/,'');
const ENDPOINT=`${BASE}/api/ai/chat`;
const IP='198.18.0.206';
let history=[];
async function ask(message){
  const res=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':IP},body:JSON.stringify({message,history})});
  const body=await res.json();
  const answer=String(body.answer??body.message??body.error??'');
  console.log(`USER: ${message}\nAI: ${answer}\n---`);
  if(res.status!==200) throw new Error(`HTTP ${res.status}`);
  history=[...history,{role:'user',content:message},{role:'assistant',content:answer}].slice(-12);
  return answer;
}
const catalog=await ask('ผมสนใจโปรแกรมตรวจสุขภาพ');
if(!/DNA Wellness|ตรวจสุขภาพ/u.test(catalog)) throw new Error('catalog selection missing');
const treatment=await ask('อยากไปรักษาต้องทำยังไง');
if(/DNA Wellness|1,900/u.test(treatment)||!/รักษา|พบแพทย์|สถานพยาบาล/u.test(treatment)) throw new Error('treatment journey repeated catalog');
const booking=await ask('จองยังไง');
if(/DNA Wellness|1,900/u.test(booking)||!/จอง|WOS/u.test(booking)) throw new Error('booking journey lost context');
const transport=await ask('มีรถมั้ย');
if(/DNA Wellness|1,900/u.test(transport)||!/จุดรับ|จุดส่ง|จำนวนคน|ประเภทรถ/u.test(transport)) throw new Error('transport journey swallowed by selected program');
const hotel=await ask('มีโรงแรมมั้ย');
if(!/ที่พัก|ห้อง|จำนวนคน|งบ/u.test(hotel)) throw new Error('hotel journey missing');
console.log('JOURNEY_STATE_V1=PASS');
