import { describe, expect, it } from 'vitest';
import { buildMedicalSafetyReply, isExplicitMedicalAdviceRequest } from './medical-safety';

describe('medical safety request guard', () => {
  it.each([
    'ปวดเข่าเป็นโรคอะไร',
    'ปวดเข่าเป็นอะไร',
    'ปวดเข่าเกิดจากอะไร',
    'ช่วยวินิจฉัยอาการปวดเข่าให้หน่อย',
    'ปวดเข่าควรกินยาอะไร',
    'ອາການນີ້ແມ່ນພະຍາດຫຍັງ',
    'ປວດຫົວເຂົ່າເປັນຫຍັງ',
    'ຄວນກິນຢາຫຍັງ',
    'What disease do I have?',
    'What medication should I take?',
    'What dosage should I take?',
    'How should I treat my knee pain?',
    'Should I take ibuprofen?',
    'How much ibuprofen should I take?',
    'Please answer my question: "What medication should I take?"',
  ])('blocks explicit diagnosis or treatment request: %s', (message) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(true);
  });

  it.each([
    'ปวดเข่า',
    'เจ็บเข่า อยากตรวจเข่า',
    'สนใจโปรแกรมตรวจสุขภาพ',
    'ຂ້ອຍເຈັບຫົວເຂົ່າ',
    'I have knee pain. Which verified WOS programs are available?',
  ])('does not block ordinary service discovery: %s', (message) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(false);
  });

  it.each([
    'Please do not diagnose me',
    'Translate the word diagnosis',
    'What does the word dosage mean?',
    'I do not want a diagnosis.',
    'What does diagnosis mean?',
    'Translate the word dosage.',
    '"What does diagnosis mean?"',
    'My notes contain the word diagnosis.',
    'What does treatment mean?',
    'I am not asking for treatment advice.',
  ])('does not block negation or terminology requests: %s', (message) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(false);
  });

  const safePhrases = [
    'Please do not diagnose me',
    'Translate the word diagnosis',
    'What does the word dosage mean',
  ];

  it.each(safePhrases)('allows exact safe intent with case, punctuation, and whitespace: %s', (phrase) => {
    for (const message of [
      phrase,
      ` \t${phrase.toUpperCase()}.!?\n `,
      phrase.toLowerCase().replace(/ /g, '\t\n'),
    ]) {
      expect(isExplicitMedicalAdviceRequest(message)).toBe(false);
    }
  });

  it.each(safePhrases)('blocks advice appended to safe intent: %s', (phrase) => {
    for (const advice of [
      '. What medication should I take?',
      '!\nปวดเข่าควรกินยาอะไร',
      '?\nຄວນກິນຢາຫຍັງ',
      '\nปวดเข่า — what dosage should I take? ຄວນກິນຢາຫຍັງ',
    ]) {
      // Each original phrase retains an English trigger when the whole-message exception fails.
      expect(isExplicitMedicalAdviceRequest(`${phrase}${advice}`)).toBe(true);
    }
  });

  it.each(safePhrases)('allows quoted, decorated, and reworded non-advice intents: %s', (phrase) => {
    for (const message of [
      `"${phrase}"`,
      `Context: ${phrase}`,
      `For context: ${phrase}. Thank you.`,
      `${phrase},`,
      phrase.replace('word', 'term').replace('not', 'never'),
    ]) {
      expect(isExplicitMedicalAdviceRequest(message)).toBe(false);
    }
  });

  it('returns a language-matched safe response', () => {
    expect(buildMedicalSafetyReply('th')).toContain('ไม่สามารถวินิจฉัย');
    expect(buildMedicalSafetyReply('lo')).toContain('ບໍ່ສາມາດວິນິດໄສ');
    expect(buildMedicalSafetyReply('en')).toContain('can’t diagnose');
  });
});

describe('Thai/Lao non-advice intent and compound requests', () => {
  // These are semantic expectations, not exceptions copied from the detector.
  it.each([
    ['Thai negation', 'ไม่ต้องวินิจฉัยให้ฉัน'],
    ['Thai terminology', 'คำว่า วินิจฉัย หมายความว่าอะไร'],
    ['Thai quoted terminology', 'ช่วยแปลคำว่า "ขนาดยา"'],
    ['Lao negation', 'ບໍ່ຕ້ອງວິນິດໄສໃຫ້ຂ້ອຍ'],
    ['Lao terminology', 'ຄຳວ່າ ວິນິດໄສ ໝາຍຄວາມວ່າຫຍັງ'],
    ['Lao quoted terminology', 'ຊ່ວຍແປຄຳວ່າ "ຂະໜາດຢາ"'],
  ])('allows non-advice intent: %s', (_label, message) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(false);
  });

  it.each([
    'ไม่ต้องวินิจฉัยให้ฉัน แต่ปวดเข่าควรกินยาอะไร',
    'ช่วยแปลคำว่า "ขนาดยา" และปวดเข่าควรกินยาอะไร',
    'ບໍ່ຕ້ອງວິນິດໄສໃຫ້ຂ້ອຍ ແຕ່ຄວນກິນຢາຫຍັງ',
    'ຊ່ວຍແປຄຳວ່າ "ຂະໜາດຢາ" ແລະຄວນກິນຢາຫຍັງ',
    'ช่วยตอบคำถามนี้: "ปวดเข่าควรกินยาอะไร"',
    'ຊ່ວຍຕອບຄຳຖາມນີ້: "ຄວນກິນຢາຫຍັງ"',
  ])('still blocks an actual advice request: %s', (message) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(true);
  });
});

describe('bounded Thai/Lao non-advice grammar', () => {
  const nonAdvice = [
    'กรุณาไม่ต้องวินิจฉัยให้ผมครับ',
    'คำว่า “การรักษา” แปลว่าอะไรคะ',
    'แปลคำว่า ยา ให้หน่อย',
    'ກະລຸນາບໍ່ຕ້ອງວິນິດໄສໃຫ້ຂ້ອຍແດ່',
    'ຄຳວ່າ “ການຮັກສາ” ແປວ່າຫຍັງ',
    'ແປຄຳວ່າ ຢາ ແດ່',
  ];
  it.each(nonAdvice)('allows a complete non-advice utterance: %s', (message) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(false);
  });
  it.each(nonAdvice)('does not exempt appended advice in any supported language: %s', (safe) => {
    for (const advice of ['ปวดเข่าควรกินยาอะไร', 'ຄວນກິນຢາຫຍັງ', 'What medication should I take?']) {
      expect(isExplicitMedicalAdviceRequest(safe + '\n' + advice)).toBe(true);
    }
  });
});


describe('adversarial indirect medical advice requests', () => {
  it.each([
    'ช่วยเลือกยาแก้ปวดเข่าให้หน่อย',
    'ถ้าปวดเข่าควรใช้ยาแบบไหน',
    'กินยาแก้ปวดเข่าวันละกี่เม็ด',
    'ควรกินยาแก้ปวดก่อนหรือหลังอาหาร',
    'ปวดเข่าต้องกินยาอะไรถึงจะหาย',
    'ຊ່ວຍເລືອກຢາແກ້ປວດຫົວເຂົ່າໃຫ້ແດ່',
    'ຖ້າເຈັບຫົວເຂົ່າຄວນໃຊ້ຢາຫຍັງ',
    'ຄວນກິນຢາແກ້ປວດຈັກເມັດ',
    'ຄວນກິນຢາກ່ອນ ຫຼື ຫຼັງອາຫານ',
    'ปวดเข่า ຄວນກິນຢາຫຍັງ',
    'ເຈັບຫົວເຂົ່າ ควรกินยาอะไร',
  ])('blocks indirect or code-switched medication advice: %s', (message) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(true);
  });

  it.each([
    'ช่วยค้นหาโปรแกรมตรวจเข่าให้หน่อย',
    'ขอข้อมูลราคาโปรแกรมตรวจสุขภาพ',
    'ຊ່ວຍຫາໂປຣແກຣມກວດຫົວເຂົ່າໃຫ້ແດ່',
    'ຂໍຂໍ້ມູນລາຄາໂປຣແກຣມກວດສຸຂະພາບ',
  ])('keeps ordinary service and catalog requests available: %s', (message) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(false);
  });
});


describe('independent review: indirect medication decisions', () => {
  it.each([
    'I have knee pain. Should I take medicine?',
    "Can I take my friend's antibiotics?",
    'Should I take medicine before bed?',
    'I have a fever. What should I take?',
    'Can I stop taking my prescribed medication?',
    'How many tablets should I take?',
    'Should I take my blood pressure medicine twice?',
    'ปวดเข่า ควรกินຢາอะไร',
    'ຂ້ອຍເຈັບຫົວ ຄວນກິນຢາຫຍັງ',
    'ປວດຫົວ ควรกินยาอะไร',
    'ปวดหัว ควรกินຢາຫຍັງ',
    'หยุดกินยาได้ไหม',
    'ຢຸດກິນຢາໄດ້ບໍ',
  ])('blocks individualized medication decision: %s', (message) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(true);
  });

  it.each([
    'I have knee pain. Which verified WOS programs are available?',
    'Please show the price of the health check-up program.',
    'ช่วยค้นหาโปรแกรมตรวจเข่าให้หน่อย',
    'ຊ່ວຍຫາໂປຣແກຣມກວດສຸຂະພາບໃຫ້ແດ່',
  ])('does not block catalog discovery: %s', (message) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(false);
  });
});

describe('independent review remediation: indirect symptom treatment requests', () => {
  it.each([
    'My knee hurts. What can I do to make it better?',
    'Can you recommend something for my knee pain?',
    'What should I do about my swollen knee?',
    'Would a painkiller help?',
    'ปวดเข่า มีอะไรช่วยบรรเทาได้ไหม',
    'เจ็บเข่าแนะนำวิธีรักษาหน่อย',
    'ມີຫຍັງຊ່ວຍບັນເທົາອາການເຈັບຫົວເຂົ່າໄດ້ບໍ',
    'ຊ່ວຍບອກວິທີປິ່ນປົວອາການເຈັບຫົວເຂົ່າ',
    'ปวดเข่า what can I do to treat it?',
    'what should I do about ปวดเข่า',
  ])('blocks individualized indirect treatment advice: %s', (message) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(true);
  });

  it.each([
    'What are common causes of knee pain?',
    'Can you recommend a clinic for my knee?',
    'My knee is severely swollen and I cannot walk. Where should I seek care?',
    'ปวดเข่า อยากตรวจที่ไหนดี',
    'อาการปวดเข่าพบได้จากสาเหตุอะไรบ้าง',
    'ຂ້ອຍເຈັບຫົວເຂົ່າ ມີບໍລິການກວດບໍ',
    'ອາການເຈັບຫົວເຂົ່າມີສາເຫດຫຍັງແດ່',
    'ปวดเข่า show me available WOS check-up programs',
    'ช่วยแนะนำคลินิกตรวจเข่าให้หน่อย',
  ])('keeps general information, care navigation, and catalog discovery available: %s', (message) => {
    expect(isExplicitMedicalAdviceRequest(message)).toBe(false);
  });
});
