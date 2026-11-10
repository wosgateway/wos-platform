import type { WosLanguage } from './language-routing';

/**
 * High-confidence request guard only. Ordinary symptom descriptions remain
 * eligible for verified catalog search; this blocks explicit diagnosis,
 * medication, dosage, and individualized treatment requests.
 */
const DIAGNOSIS_REQUESTS = [
  /(?:วินิจฉัย|ช่วยบอกหน่อยว่า.{0,24}(?:เป็นโรคอะไร|เป็นอะไร)|(?:อาการ|ที่ปวด|ปวด|เจ็บ|บวม|ชา|เวียนหัว).{0,24}(?:เกิดจากอะไร|เป็นอะไร|เป็นโรคอะไร|คือโรคอะไร)|เป็นโรคอะไร)/u,
  /(?:ແມ່ນພະຍາດຫຍັງ|(?:ເຈັບ|ປວດ|ບວມ|ຊາ).{0,24}ເປັນຫຍັງ|ວິນິດໄສ|ອາການ.{0,24}(?:ເກີດຈາກຫຍັງ|ແມ່ນຫຍັງ))/u,
  /\b(?:diagnose|diagnosis|what disease|what condition|what illness|what is wrong with me)\b/i,
];

const TREATMENT_REQUESTS = [
  /(?:\u{e0a}\u{e48}\u{e27}\u{e22}\s*)?\u{e40}\u{e25}\u{e37}\u{e2d}\u{e01}\u{e22}\u{e32}.{0,40}\u{e43}\u{e2b}\u{e49}\u{e2b}\u{e19}\u{e48}\u{e2d}/u,
  /(?:\u{e16}\u{e49}\u{e32}.{0,24})?\u{e1b}\u{e27}\u{e14}\u{e40}\u{e02}\u{e48}\u{e32}.{0,16}\u{e04}\u{e27}\u{e23}\s*(?:\u{e01}\u{e34}\u{e19}|\u{e43}\u{e0a}\u{e49})\u{e22}\u{e32}(?:\u{e2d}\u{e30}\u{e44}\u{e23}|\u{e41}\u{e1a}\u{e1a}\u{e44}\u{e2b}\u{e19})/u,
  /\u{e04}\u{e27}\u{e23}\s*(?:\u{e01}\u{e34}\u{e19}|\u{e43}\u{e0a}\u{e49})\u{e22}\u{e32}(?:\u{e2d}\u{e30}\u{e44}\u{e23}|\u{e41}\u{e1a}\u{e1a}\u{e44}\u{e2b}\u{e19})/u,
  /(?:\u{e01}\u{e34}\u{e19}|\u{e17}\u{e32}\u{e19}|\u{e43}\u{e0a}\u{e49})\u{e22}\u{e32}\u{e2d}\u{e30}\u{e44}\u{e23}/u,
  /(?:\u{e01}\u{e34}\u{e19}|\u{e17}\u{e32}\u{e19})\u{e22}\u{e32}.{0,32}(?:\u{e27}\u{e31}\u{e19}\u{e25}\u{e30}.{0,4}\u{e01}\u{e35}\u{e48}\u{e40}\u{e21}\u{e47}\u{e14}|\u{e01}\u{e35}\u{e48}\u{e40}\u{e21}\u{e47}\u{e14})/u,
  /\u{e04}\u{e27}\u{e23}\s*\u{e01}\u{e34}\u{e19}\u{e22}\u{e32}.{0,32}(?:\u{e01}\u{e48}\u{e2d}\u{e19}.{0,8}\u{e2b}\u{e23}\u{e37}\u{e2d}.{0,8}\u{e2b}\u{e25}\u{e31}\u{e07}|\u{e2b}\u{e25}\u{e31}\u{e07}.{0,8}\u{e2d}\u{e32}\u{e2b}\u{e32}\u{e23})/u,
  /\u{e1b}\u{e27}\u{e14}\u{e40}\u{e02}\u{e48}\u{e32}.{0,20}\u{e15}\u{e49}\u{e2d}\u{e07}\u{e01}\u{e34}\u{e19}\u{e22}\u{e32}.{0,20}\u{e2d}\u{e30}\u{e44}\u{e23}/u,
  /(?:\u{e8a}\u{ec8}\u{ea7}\u{e8d}\s*)?\u{ec0}\u{ea5}\u{eb7}\u{ead}\u{e81}\u{ea2}\u{eb2}.{0,16}\u{e81}\u{ec9}\u{e9b}\u{ea7}\u{e94}.{0,24}\u{eab}\u{ebb}\u{ea7}\u{ec0}\u{e82}\u{ebb}\u{ec8}\u{eb2}.{0,12}\u{ec3}\u{eab}\u{ec9}\u{ec1}\u{e94}\u{ec8}/u,
  /\u{e96}\u{ec9}\u{eb2}.{0,24}\u{ec0}\u{e88}\u{eb1}\u{e9a}.{0,24}\u{eab}\u{ebb}\u{ea7}\u{ec0}\u{e82}\u{ebb}\u{ec8}\u{eb2}.{0,24}\u{e84}\u{ea7}\u{e99}\s*\u{ec3}\u{e8a}\u{ec9}\u{ea2}\u{eb2}.{0,16}\u{eab}\u{e8d}/u,
  /\u{e84}\u{ea7}\u{e99}\s*\u{e81}\u{eb4}\u{e99}\u{ea2}\u{eb2}.{0,36}(?:\u{eab}\u{e8d}|\u{e88}\u{eb1}\u{e81}\u{ec0}\u{ea1}\u{eb1}\u{e94}|\u{e81}\u{ec8}\u{ead}\u{e99}|\u{eab}\u{ebc}\u{eb1}\u{e87})/u,
  /\u{e81}\u{eb4}\u{e99}\u{ea2}\u{eb2}\u{eab}\u{e8d}/u,
  /\u{e84}\u{ea7}\u{e99}\s*\u{e81}\u{eb4}\u{e99}\u{ea2}\u{eb2}.{0,36}\u{e88}\u{eb1}\u{e81}\u{ec0}\u{ea1}\u{eb1}\u{e94}/u,
  /\u{e84}\u{ea7}\u{e99}\s*\u{e81}\u{eb4}\u{e99}\u{ea2}\u{eb2}.{0,36}\u{e81}\u{ec8}\u{ead}\u{e99}.{0,16}\u{eab}\u{eb7}.{0,16}\u{eab}\u{ebc}\u{eb1}\u{e87}/u,
  /\u{e84}\u{ea7}\u{e99}\s*\u{e81}\u{eb4}\u{e99}\u{ea2}\u{eb2}.{0,36}\u{eab}\u{ebc}\u{eb1}\u{e87}.{0,16}\u{ead}\u{eb2}\u{eab}\u{eb2}\u{e99}/u,
  /\b(?:what medicine|which medication|what medication|dosage|how should i treat|how do i treat|what treatment should i use)\b/i,
  /\bshould\s+i\s+take\s+(?:ibuprofen|acetaminophen|paracetamol|aspirin|naproxen)\b/i,
  /\bhow\s+much\s+(?:ibuprofen|acetaminophen|paracetamol|aspirin|naproxen)\s+should\s+i\s+take\b/i,
  /\bwhat\s+should\s+i\s+take\b/i,
  /\b(?:should|can|could|may)\s+i\s+(?:take|stop|start|skip|change|increase|reduce)(?:\s+(?:taking|using))?\s+(?:my\s+|any\s+)?(?:prescribed\s+|blood\s+pressure\s+|pain\s+)?(?:medicine|medication|medicines|medications|antibiotics|pills|tablets)\b/i,
  /\bcan\s+i\s+take\s+(?:my\s+)?(?:friend'?s|someone\s+else'?s)\s+(?:medicine|medication|antibiotics|pills|tablets)\b/i,
  /\bhow\s+many\s+(?:tablets|pills|doses)\s+(?:should|can|may)\s+i\s+take\b/i,
  /\bhow\s+often\s+should\s+i\s+take\s+(?:this\s+)?(?:medicine|medication|drug)\b/i,
  /(?:ปวด|เจ็บ|บวม|อาการ).{0,32}(?:ควร|ต้อง).{0,12}(?:กิน|ใช้).{0,12}(?:ยา|ຢາ)(?:อะไร|แบบไหน|ຫຍັງ)?/u,
  /(?:ເຈັບ|ປວດ|ອາການ).{0,32}(?:ຄວນ|ຕ້ອງ).{0,12}(?:ກິນ|ໃຊ້).{0,12}(?:ຢາ|ยา)(?:ຫຍັງ|อะไร)?/u,
  /(?:ປວດ|ເຈັບ|ອາການ).{0,32}(?:ควร|ต้อง).{0,12}(?:กิน|ใช้).{0,12}(?:ยา|ຢາ)(?:อะไร|ຫຍັງ)?/u,
  /(?:ปวด|เจ็บ|อาการ).{0,32}(?:ຄວນ|ຕ້ອງ).{0,12}(?:ກິນ|ໃຊ້).{0,12}(?:ຢາ|ยา)(?:ຫຍັງ|อะไร)?/u,
  /(?:หยุด|เลิก).{0,12}(?:กิน|ใช้)?ยา.{0,20}(?:ได้ไหม|หรือไม่|ดีไหม)/u,
  /(?:ຢຸດ|ເຊົາ).{0,12}(?:ກິນ|ໃຊ້)?ຢາ.{0,20}(?:ໄດ້ບໍ|ຫຼືບໍ)/u,
  // Individualized self-care or treatment requests tied to a symptom.
  /\b(?:my\s+)?(?:knee\s+pain|knee\s+hurts|swollen\s+knee|headache|stomach\s+pain|fever)\b.{0,48}\b(?:what\s+can\s+i\s+do|what\s+should\s+i\s+do|how\s+can\s+i|what\s+can\s+help|what\s+should\s+i\s+use|what\s+can\s+i\s+take)\b/i,
  /\b(?:what\s+can\s+i\s+do|what\s+should\s+i\s+do|how\s+can\s+i|what\s+can\s+help|what\s+should\s+i\s+use)\b.{0,48}\b(?:my\s+)?(?:knee\s+pain|swollen\s+knee|headache|stomach\s+pain|fever)\b/i,
  /\b(?:recommend|suggest)\s+(?:something|a\s+(?:remedy|treatment|medicine))\s+for\s+(?:my\s+)?(?:knee\s+pain|pain|headache|fever)\b/i,
  /\bwould\s+(?:a\s+)?(?:painkiller|pain\s+killer|medicine|medication)\s+help\b/i,
  /(?:ปวด|เจ็บ|บวม).{0,32}(?:มีอะไรช่วย|ช่วยบรรเทา|บรรเทาอาการ|วิธีรักษา|แนะนำวิธีรักษา|ควรทำอย่างไร|ควรทำยังไง)/u,
  /(?:ช่วยบอก|แนะนำ).{0,20}(?:วิธีรักษา|วิธีบรรเทา).{0,24}(?:อาการ)?(?:ปวด|เจ็บ|บวม)/u,
  /(?:ເຈັບ|ປວດ|ບວມ).{0,40}(?:ມີຫຍັງຊ່ວຍ|ຊ່ວຍບັນເທົາ|ວິທີປິ່ນປົວ|ແນະນຳວິທີ|ຄວນເຮັດແນວໃດ)/u,
  /ມີຫຍັງຊ່ວຍ.{0,40}(?:ບັນເທົາ|ປິ່ນປົວ).{0,24}(?:ອາການ)?(?:ເຈັບ|ປວດ|ບວມ)/u,
  /ຊ່ວຍ.{0,24}(?:ບອກ)?\s*(?:ວິທີປິ່ນປົວ|ວິທີບັນເທົາ).{0,32}(?:ອາການ)?(?:ເຈັບ|ປວດ|ບວມ)/u,
  /(?:ปวด|เจ็บ|บวม).{0,32}\b(?:what\s+can\s+i\s+do|what\s+should\s+i\s+do|how\s+can\s+i|how\s+do\s+i\s+treat|what\s+can\s+help)\b/i,
  /\b(?:what\s+can\s+i\s+do|what\s+should\s+i\s+do|how\s+can\s+i|how\s+do\s+i\s+treat)\b.{0,32}(?:ปวด|เจ็บ|บวม)/i
];

// Match complete non-advice forms, including harmless presentation wrappers.
// Never remove a quoted substring: an enclosing request may ask us to answer it.
const MEDICAL_TERM = String.raw`(?:diagnosis|dosage|treatment|medication|medicine)`;
// Non-advice intent must occupy the entire utterance; an appended request
// must still be evaluated by the diagnosis/treatment guard.
const THAI_MEDICAL_TERM = String.raw`(?:การวินิจฉัย|วินิจฉัย|ขนาดยา|การรักษา|ยา)`;
const LAO_MEDICAL_TERM = String.raw`(?:ການວິນິດໄສ|ວິນິດໄສ|ຂະໜາດຢາ|ການຮັກສາ|ຢາ)`;
function quotedTerm(term: string): string {
  return String.raw`(?:${term}|"${term}"|'${term}'|“${term}”|‘${term}’)`;
}
const THAI_NON_ADVICE_FORMS = [
  String.raw`(?:กรุณา\s*|ช่วย\s*)?ไม่(?:ต้อง|อยากให้)\s*(?:วินิจฉัย|แนะนำยา|แนะนำวิธีรักษา)(?:\s*(?:ให้\s*)?(?:ฉัน|ผม|ดิฉัน))?(?:\s*(?:นะ)?(?:คะ|ค่ะ|ครับ))?`,
  String.raw`คำว่า\s*${quotedTerm(THAI_MEDICAL_TERM)}\s*(?:หมายความว่าอะไร|แปลว่าอะไร|คืออะไร)(?:\s*(?:คะ|ค่ะ|ครับ))?`,
  String.raw`(?:ช่วย\s*|กรุณา\s*)?แปลคำว่า\s*${quotedTerm(THAI_MEDICAL_TERM)}(?:\s*(?:ให้หน่อย|หน่อย))?(?:\s*(?:คะ|ค่ะ|ครับ))?`,
];
const LAO_NON_ADVICE_FORMS = [
  String.raw`(?:ກະລຸນາ\s*|ຊ່ວຍ\s*)?ບໍ່(?:ຕ້ອງ|ຢາກໃຫ້)\s*(?:ວິນິດໄສ|ແນະນຳຢາ|ແນະນຳວິທີຮັກສາ)(?:\s*(?:ໃຫ້\s*)?ຂ້ອຍ)?(?:\s*ແດ່)?`,
  String.raw`ຄຳວ່າ\s*${quotedTerm(LAO_MEDICAL_TERM)}\s*(?:ໝາຍຄວາມວ່າຫຍັງ|ແປວ່າຫຍັງ|ແມ່ນຫຍັງ)`,
  String.raw`(?:ຊ່ວຍ\s*|ກະລຸນາ\s*)?ແປຄຳວ່າ\s*${quotedTerm(LAO_MEDICAL_TERM)}(?:\s*ແດ່)?`,
];
const NON_ADVICE_FORMS = [
  ...THAI_NON_ADVICE_FORMS,
  ...LAO_NON_ADVICE_FORMS,
  String.raw`(?:please\s+)?(?:do\s+(?:not|never)|never)\s+diagnose\s+me`,
  String.raw`i\s+(?:do\s+not|never)\s+want\s+(?:a\s+)?${MEDICAL_TERM}`,
  String.raw`i\s+am\s+(?:not|never)\s+asking\s+for\s+${MEDICAL_TERM}(?:\s+advice)?`,
  String.raw`translate\s+(?:the\s+)?(?:(?:word|term)\s+)?${MEDICAL_TERM}`,
  String.raw`what\s+does\s+(?:the\s+(?:word|term)\s+)?${MEDICAL_TERM}\s+mean`,
  String.raw`my\s+notes\s+contain\s+the\s+(?:word|term)\s+${MEDICAL_TERM}`,
].map((form) => new RegExp(
  String.raw`^(?:(?:for\s+)?context:\s*)?["'“‘]?${form}[.!?,]*["'”’]?(?:\s*thank\s+you[.!]*)?$`,
  'i',
));

export function isExplicitMedicalAdviceRequest(message: string): boolean {
  const text = message.normalize('NFC').trim();
  if (!text) return false;
  if (NON_ADVICE_FORMS.some((pattern) => pattern.test(text))) return false;
  return [...DIAGNOSIS_REQUESTS, ...TREATMENT_REQUESTS].some((pattern) => pattern.test(text));
}

export function buildMedicalSafetyReply(language: WosLanguage): string {
  if (language === 'lo') {
    return 'ໃບເຟີນບໍ່ສາມາດວິນິດໄສ ຫຼື ແນະນຳຢາແລະວິທີຮັກສາສະເພາະບຸກຄົນໄດ້ຄ່ະ. ຂໍແນະນຳໃຫ້ປຶກສາແພດເພື່ອປະເມີນອາການໂດຍກົງ. ຖ້າຕ້ອງການ ໃບເຟີນຊ່ວຍຄົ້ນຫາໂປຣແກຣມ WOS ທີ່ມີຂໍ້ມູນຢືນຢັນໄດ້ຄ່ະ';
  }
  if (language === 'en') {
    return 'Fern can’t diagnose a condition or recommend personal medication or treatment. Please consult a qualified healthcare professional for an assessment. I can still help find relevant WOS programs using verified information.';
  }
  return 'ใบเฟิร์นไม่สามารถวินิจฉัยโรคหรือแนะนำยาและวิธีรักษาเฉพาะบุคคลได้ค่ะ แนะนำให้ปรึกษาแพทย์หรือบุคลากรทางการแพทย์เพื่อประเมินอาการโดยตรงนะคะ หากต้องการ ใบเฟิร์นช่วยค้นหาโปรแกรม WOS ที่มีข้อมูลยืนยันได้ค่ะ';
}
