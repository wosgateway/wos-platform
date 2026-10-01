const base='http://127.0.0.1:3044';
let history=[];
async function ask(message){
 const r=await fetch(base+'/api/ai/chat',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'198.18.0.207'},body:JSON.stringify({message,history})});
 const b=await r.json(); const a=String(b.answer??b.message??b.error??'');
 console.log('\nUSER:',message,'\nAI:',a);
 if(r.status!==200) throw new Error('HTTP '+r.status);
 history=[...history,{role:'user',content:message},{role:'assistant',content:a}].slice(-12); return a;
}
let a=await ask('มีโปรแกรมอะไรบ้าง'); if(!/ตรวจสุขภาพ|DNA Wellness/i.test(a)||/ຖ້າກຳລັງ|ລາຄາໂປຣໂມຊັນ/.test(a)) throw new Error('Thai catalog language/state failed');
a=await ask('หากผมปวดเข่า'); if(/ตรวจสุขภาพ|DNA Wellness/.test(a)||!/เข่า|INDY/i.test(a)) throw new Error('knee topic switch failed');
a=await ask('มีรถรับส่งมั้ยครับ'); if(/ตรวจสุขภาพ|DNA Wellness|1,900/.test(a)||!/รถ|จุดรับ|จุดส่ง/.test(a)) throw new Error('transport switch failed');
a=await ask('อยากไปอุดรสามวัน'); if(!/3 วัน|3 วัน/.test(a)&&!/วันเดินทาง|งบประมาณ/.test(a)) throw new Error('trip planning failed');
a=await ask('ไปวันที่ 5 ตุลาคม 2คน งบไม่จำกัด'); if(/กรุณาแจ้ง|ขอ.*จำนวนคน|ขอ.*งบประมาณ/.test(a)) throw new Error('repeated trip fields');
a=await ask('งบ 10000'); if(/กรุณาแจ้ง|ขอ.*งบประมาณ|งบไม่จำกัด/.test(a)) throw new Error('budget override failed');
console.log('\nREAL_JOURNEY_V2=PASS');
