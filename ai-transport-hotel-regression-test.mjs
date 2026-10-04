#!/usr/bin/env node
const args=process.argv.slice(2);
const idx=args.indexOf('--base-url');
const BASE=(idx>=0&&args[idx+1]?args[idx+1]:'http://127.0.0.1:3020').replace(/\/$/,'');
const ENDPOINT=BASE+'/api/ai/chat';
const IP=process.env.WOS_AI_REGRESSION_IP||'198.18.0.209';
let history=[];

async function ask(message){
  const res=await fetch(ENDPOINT,{
    method:'POST',
    headers:{'content-type':'application/json','x-forwarded-for':IP},
    body:JSON.stringify({message,history})
  });
  const body=await res.json();
  const answer=String(body.answer??body.message??body.error??'');
  console.log('\nUSER:',message,'\nAI:',answer,'\n---');
  if(res.status!==200) throw new Error('HTTP '+res.status);
  history=[...history,{role:'user',content:message},{role:'assistant',content:answer}].slice(-20);
  return answer;
}

await ask('มีโปรแกรมอะไรบ้าง');
await ask('อุดร');
await ask('ตรวจเข่า');
await ask('ต้องการจองตรวจเข่า');
const name=await ask('Vith Hub');
if(!/รถ|รถรับส่ง|โรงแรม|ที่พัก|WOS/iu.test(name)) throw new Error('booking flow did not advance after customer name');

const transportInterest=await ask('สนใจ');
if(!/รถ|รถรับส่ง|จุดรับ|pickup/iu.test(transportInterest)) throw new Error('transport-interest step missing');

const pickup=await ask('คำม่วน');
if(/สนใจรถ|รถรับส่งด้วยไหม|ต้องการรถ|สนใจรถรับส่ง|ขอจุดรับ|จุดรับอยู่ที่ไหน/iu.test(pickup) || !/โรงแรม|ที่พัก|hotel/iu.test(pickup)) {
  throw new Error('arbitrary pickup was not captured and concierge did not advance to hotel');
}

// The exact production failure: repeating the same pickup must never reopen
// the transport question.
const repeatedPickup=await ask('คำม่วน');
if(/สนใจรถ|รถรับส่งด้วยไหม|ต้องการรถ|สนใจรถรับส่ง|ขอจุดรับ|จุดรับอยู่ที่ไหน/iu.test(repeatedPickup) || !/โรงแรม|ที่พัก|hotel/iu.test(repeatedPickup)) {
  throw new Error('repeated pickup reopened the transport step');
}

const hotelDecline=await ask('ไม่ต้องการ');
if(/สนใจรถ|รถรับส่ง|จุดรับ|pickup|สนใจโรงแรม|โรงแรมด้วยไหม/iu.test(hotelDecline)) {
  throw new Error('hotel rejection caused transport/hotel repetition');
}
if(!/ยืนยัน|สรุป|ข้อมูล/iu.test(hotelDecline)) throw new Error('hotel rejection did not advance to confirmation');

console.log('\nTRANSPORT_HOTEL_REGRESSION=PASS');
