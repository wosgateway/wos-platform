// content/partner/lo.ts
//
// ⚠️ TRANSLATION REVIEW NOTE:
// The Lao text below is a best-effort translation produced for this build —
// it has NOT been proofread by a native Lao speaker. Please have someone on
// your Lao-market team (or a professional translator) review this file
// before publishing, the same way you'd want any legal/commercial copy checked.
//
import type { PartnerPageContent } from "./types";

export const lo: PartnerPageContent = {
  locale: "lo",
  nav: {
    brand: "WOS Partner",
    mobileBrand: "WOS Partner",
    links: [
      { label: "Partner Benefits", href: "#why-partner" },
      { label: "How It Works", href: "#how-it-works" },
      { label: "Founding Partner", href: "#founding-partner" },
    ],
    cta: { label: "Apply Now", href: "/partner/apply" },
    mobileCtaLabel: "Apply",
  },
  hero: {
    eyebrow: "WOS PARTNER NETWORK",
    headlineLines: ["ເຊື່ອມຕໍ່ທຸລະກິດຂອງທ່ານ", "ກັບລູກຄ້າຈາກລາວ"],
    description:
      "WOS ເຊື່ອມຕໍ່ລູກຄ້າຈາກລາວກັບ Healthcare & Wellness ໃນປະເທດໄທ ພ້ອມດູແລຕັ້ງແຕ່ການວາງແຜນ ການຈອງ ການເດີນທາງ ຈົນເຖິງຫຼັງຮັບບໍລິການ",
    highlight: "Thailand × Laos",
    primaryCta: { label: "Become a Founding Partner", href: "/partner/apply" },
    secondaryCta: { label: "ເບິ່ງລາຍລະອຽດ Partnership", href: "#why-partner" },
    visual: { from: "Laos Customer", via: "WOS", to: "Thai Partner" },
  },
  whyPartner: {
    eyebrow: "WHY PARTNER WITH WOS",
    headline: "ເຂົ້າເຖິງລູກຄ້າໃໝ່",
    subheadline: "ພ້ອມບໍລິການທີ່ຫຼາຍກວ່າການຈອງ",
    cards: [
      {
        index: "01",
        title: "Reach New Customers",
        description: "ເຂົ້າເຖິງລູກຄ້າຈາກລາວທີ່ຊອກຫາ Healthcare & Wellness ໃນປະເທດໄທ",
      },
      {
        index: "02",
        title: "One Complete Journey",
        description: "WOS ຊ່ວຍປະສານຕັ້ງແຕ່ Booking, Transport, Hotel ຈົນເຖິງການເຂົ້າຮັບບໍລິການ",
      },
      {
        index: "03",
        title: "Performance-Based",
        description: "ບໍ່ມີ Setup Fee ແລະ Monthly Platform Fee ໃນຊ່ວງ Founding Pilot",
      },
    ],
  },
  journey: {
    eyebrow: "ONE COMPLETE JOURNEY",
    headline: "ຈາກລາວສູ່ໄທ",
    subheadline: "WOS ດູແລຕະຫຼອດ Journey",
    steps: [
      { index: "01", title: "Discover", description: "ລູກຄ້າຈາກລາວຄົ້ນພົບບໍລິການທີ່ເໝາະສົມກັບຄວາມຕ້ອງການ" },
      { index: "02", title: "Plan", description: "WOS ຊ່ວຍເລືອກໂປຣແກຣມ ແລະ ວາງແຜນການເດີນທາງ" },
      { index: "03", title: "Travel", description: "ປະສານ Transport / Hotel / Appointment" },
      { index: "04", title: "Care", description: "ລູກຄ້າເຂົ້າຮັບບໍລິການກັບ WOS Partner" },
      { index: "05", title: "Return", description: "WOS ຊ່ວຍດູແລ ແລະ ປະສານງານຈົນລູກຄ້າກັບປະເທດ" },
    ],
    highlightTitle: "One Complete Journey",
    highlightText: "ບໍ່ແມ່ນພຽງແຕ່ Booking ແຕ່ແມ່ນການດູແລ Customer Journey ຕັ້ງແຕ່ຕົ້ນຈົນຈົບ",
  },
  whoCanJoin: {
    eyebrow: "WHO CAN JOIN",
    headline: "WOS Partner Network",
    intro: "ພວກເຮົາກຳລັງສ້າງເຄືອຂ່າຍ Healthcare, Wellness ແລະ Hospitality ສຳລັບລູກຄ້າຈາກລາວ",
    groups: [
      { name: "Healthcare", items: ["ໂຮງໝໍ", "ຄລີນິກ", "ທັນຕະກຳ", "ສູນສະເພາະທາງ"] },
      { name: "Wellness", items: ["Wellness Center", "Longevity", "Spa", "Recovery"] },
      { name: "Hospitality & Travel", items: ["Hotel", "Transport", "Travel Support"] },
    ],
    note: "Additional partner categories will be added as the network expands.",
  },
  foundingPartner: {
    eyebrow: "WOS FOUNDING PARTNER",
    headline: "Join the First Partner Network",
    intro:
      "ຮ່ວມເປັນໜຶ່ງໃນ Partner ຮຸ່ນທຳອິດຂອງ WOS ແລະ ຮ່ວມອອກແບບບໍລິການສຳລັບຕະຫຼາດລາວໄປກັບທີມ WOS",
    privilegesHeadline: "Founding Partner Privileges",
    privileges: [
      { title: "No Setup Fee", description: "ບໍ່ມີຄ່າ Setup" },
      { title: "No Monthly Platform Fee", description: "ບໍ່ມີຄ່າລາຍເດືອນໃນຊ່ວງ Pilot" },
      { title: "Priority Onboarding", description: "ໄດ້ຮັບສິດໃນການ Onboarding ກ່ອນ" },
      { title: "Package Co-Design", description: "ຮ່ວມອອກແບບ Package ສຳລັບຕະຫຼາດລາວ" },
      { title: "Partner Profile on WOS", description: "ນຳສະເໜີທຸລະກິດຜ່ານ WOS" },
      { title: "Cross-border Customer Opportunities", description: "ໂອກາດຮັບລູກຄ້າຈາກຕະຫຼາດລາວ" },
    ],
    badge: "LIMITED FIRST COHORT",
    cta: { label: "Become a Founding Partner", href: "/partner/apply" },
  },
  howItWorks: {
    eyebrow: "HOW IT WORKS",
    headline: "ເລີ່ມຕົ້ນກັບ WOS ງ່າຍໆ",
    steps: [
      { index: "01", title: "Apply", description: "ສົ່ງຂໍ້ມູນ Partner" },
      { index: "02", title: "Review", description: "ທີມ WOS ລົມກັນ ແລະ ກວດສອບຂໍ້ມູນ" },
      { index: "03", title: "Build", description: "ຮ່ວມອອກແບບ Package / Service ສຳລັບຕະຫຼາດລາວ" },
      { index: "04", title: "Launch", description: "ເລີ່ມຮັບ Customer Journey ຜ່ານ WOS" },
    ],
    ctaHeadline: "Ready to grow with WOS?",
    cta: { label: "Become a Founding Partner", href: "/partner/apply" },
  },
  commercialModel: {
    eyebrow: "COMMERCIAL MODEL",
    headline: "Simple & Performance-Based",
    subheadline: "ໂຄງສ້າງຄ່າໃຊ້ຈ່າຍທີ່ເຂົ້າໃຈງ່າຍ ແລະ ເກີດຂຶ້ນເມື່ອມີທຸລະກຳຈິງ",
    cards: [
      { lead: "NO", term: "SETUP FEE", note: "ບໍ່ມີຄ່າ Setup ໃນຊ່ວງ Founding Pilot" },
      { lead: "NO", term: "MONTHLY FEE", note: "ບໍ່ມີຄ່າລາຍເດືອນໃນຊ່ວງ Pilot" },
      {
        lead: "PAY",
        term: "WHEN BUSINESS HAPPENS",
        note: "ເກີດຄ່າບໍລິການເມື່ອເກີດທຸລະກຳ — ຮູບແບບ Commercial ແລະ Commission ຕົກລົງຕາມປະເພດ Partner ແລະ ຮູບແບບບໍລິການ",
      },
    ],
    termsLink: { label: "View Partnership Terms", href: "/partner/terms" },
  },
  requirements: {
    eyebrow: "PARTNER REQUIREMENTS",
    headline: "ສິ່ງທີ່ Partner ຕ້ອງກຽມ",
    items: [
      "Business / Service Information",
      "Price & Package",
      "Availability / Booking Conditions",
      "Contact Person",
      "Supporting Documents",
    ],
    note: "ທີມ WOS ຈະຊ່ວຍແນະນຳ ແລະ ປະສານຂັ້ນຕອນການ Onboarding",
  },
  cta: {
    eyebrow: "JOIN THE NETWORK",
    headline: "ພ້ອມເຕີບໂຕໄປກັບຕະຫຼາດລາວບໍ?",
    subheadline: "ຮ່ວມເປັນ WOS Founding Partner",
    description:
      "WOS ກຳລັງເປີດຮັບ Partner ຮຸ່ນທຳອິດ ສຳລັບການຂະຫຍາຍຕະຫຼາດ Healthcare & Wellness ລະຫວ່າງລາວ ແລະ ປະເທດໄທ",
    primaryCta: { label: "Become a Founding Partner", href: "/partner/apply" },
    secondaryCta: { label: "Talk to WOS Team", href: "/consultation" },
  },
  termsPage: {
    eyebrow: "PARTNERSHIP TERMS",
    headline: "ລາຍລະອຽດຄວາມຮ່ວມມື",
    intro:
      "ລາຍລະອຽດເຊິງພານິດ ຂໍ້ຕົກລົງ MOU ຄວາມຮັບຜິດຊອບ ແລະ ມາດຕະຖານການໃຫ້ບໍລິການ ສຳລັບ Partner ທີ່ຕ້ອງການສຶກສາເງື່ອນໄຂກ່ອນຕັດສິນໃຈ",
    backLabel: "ກັບໄປໜ້າ Partner",
    ctaHeadline: "ພ້ອມເລີ່ມຕົ້ນກັບ WOS ແລ້ວບໍ?",
    cta: { label: "Become a Founding Partner", href: "/partner/apply" },
  },
  commercialTerms: {
    headline: "Commercial Model",
    intro:
      "Performance-based Partnership — WOS ບໍ່ມີຄ່າ Setup ແລະ ບໍ່ມີ Monthly Platform Fee ສຳລັບ Founding Partner ໃນຊ່ວງ Pilot WOS ຈະໄດ້ຮັບຄ່າບໍລິການ/Commission ເມື່ອເກີດທຸລະກຳ ຕາມເງື່ອນໄຂທີ່ຕົກລົງຮ່ວມກັນໃນ Partner Agreement",
    docStamp: "Founding Partner Terms",
    terms: [
      { label: "ຄ່າ Setup", value: "ບໍ່ມີ", note: "ສຳລັບ Founding Partner ໃນຊ່ວງ Pilot" },
      { label: "Monthly Platform Fee", value: "ບໍ່ມີ", note: "ໃນຊ່ວງ Pilot" },
      { label: "ຄ່າຄອມມິຊັນ / ຄ່າບໍລິການ", value: "ຄິດຕາມທຸລະກຳຈິງ", note: "ຕາມເງື່ອນໄຂທີ່ຕົກລົງຮ່ວມກັນໃນ Partner Agreement" },
      { label: "ຮອບການຈ່າຍເງິນ", value: "ລາຍເດືອນ ພາຍໃນ 30 ວັນຫຼັງປິດຮອບບິນ" },
      { label: "ໄລຍະເວລາສັນຍາ", value: "1 ປີ ຕໍ່ອາຍຸອັດຕະໂນມັດ ເວັ້ນເສຍແຕ່ແຈ້ງຍົກເລີກລ່ວງໜ້າ" },
      { label: "ສະກຸນເງິນທີ່ຈ່າຍ", value: "THB / USD (ຕາມຂໍ້ຕົກລົງ)" },
    ],
    feeScheduleHeadline: "ອັດຕາຄ່າທຳນຽມຕາມປະເພດຄູ່ຮ່ວມທຸລະກິດ",
    feeSchedule: [
      { icon: "🏥", category: "Clinic / Medical Provider", fee: "15%", principle: "ຄິດຈາກບໍລິການທີ່ເກີດຈາກ WOS" },
      { icon: "🌿", category: "Wellness / Spa", fee: "15%", principle: "ຂຶ້ນກັບບໍລິການ ແລະ margin" },
      { icon: "🏨", category: "Hotel / Resort", fee: "12%", principle: "ເໝາະກັບໂຮງແຮມທີ່ມີ volume" },
      { icon: "🚐", category: "Transport", fee: "15%", principle: "Sedan/SUV/Van/ລົດ VIP" },
      { icon: "🧘", category: "Fitness / Yoga / Activity", fee: "15%", principle: "Package / Activity" },
      { icon: "🥗", category: "Healthy Food", fee: "10%", principle: "margin ຄ່ອນຂ້າງຕ່ຳ" },
      { icon: "🥊", category: "Muay Thai / Training", fee: "15%", principle: "Package ໄລຍະສັ້ນ/ຍາວ" },
      { icon: "👨‍⚕️", category: "Specialist / Consultant", fee: "10%", principle: "ຄ່າບໍລິການວິຊາຊີບ" },
      { icon: "📦", category: "WOS Bundled Journey", fee: "20%+", principle: "WOS ລວມຫຼາຍບໍລິການ ແລະ ບໍລິຫານ Journey" },
    ],
    feeScheduleNote:
      "ອັດຕາຄ່າທຳນຽມອາດປັບຕາມປະລິມານການຈອງ ໄລຍະເວລາສັນຍາ ແລະ ຮູບແບບຄວາມຮ່ວມມື — ຕິດຕໍ່ທີມ WOS ເພື່ອຮັບຂໍ້ສະເໜີທີ່ເໝາະສົມກັບທຸລະກິດຂອງທ່ານ",
    disclaimer: "ລາຍລະອຽດຄ່າຄອມມິຊັນ ແລະ ເງື່ອນໄຂສະບັບສົມບູນຈະລະບຸໄວ້ໃນ Pilot Agreement / MOU ທີ່ລົງນາມຮ່ວມກັນ",
  },
  mou: {
    headline: "MOU ແລະ ຂໍ້ຕົກລົງຄວາມຮ່ວມມື",
    intro:
      "ຄູ່ຮ່ວມທຸລະກິດທຸກລາຍຂອງ WOS ຈະລົງນາມໃນບົດບັນທຶກຄວາມເຂົ້າໃຈ (MOU) ກ່ອນເລີ່ມໃຫ້ບໍລິການ ເພື່ອກຳນົດສິດ ໜ້າທີ່ ແລະ ມາດຕະຖານການເຮັດວຽກຮ່ວມກັນຢ່າງຊັດເຈນ",
    documentIncludes: [
      "ຂອບເຂດຄວາມຮ່ວມມື ແລະ ປະເພດບໍລິການ",
      "ເງື່ອນໄຂທາງການຄ້າ ແລະ ຮອບການຈ່າຍເງິນ",
      "ມາດຕະຖານຄຸນນະພາບ ແລະ SLA",
      "ນະໂຍບາຍຄວາມເປັນສ່ວນຕົວ ແລະ ການປົກປ້ອງຂໍ້ມູນລູກຄ້າ",
      "ເງື່ອນໄຂການຕໍ່ອາຍຸ ແລະ ການຍົກເລີກສັນຍາ",
    ],
    signingSteps: [
      "ທີມ WOS ສົ່ງຮ່າງ MOU ຫຼັງຈາກຜ່ານການກວດສອບຄຸນສົມບັດ",
      "ທັງສອງຝ່າຍທົບທວນ ແລະ ເຈລະຈາເງື່ອນໄຂ (ຖ້າມີ)",
      "ລົງນາມຜ່ານລະບົບລົງນາມເອເລັກໂຕຣນິກ ຫຼື ເອກະສານຕົ້ນສະບັບ",
      "ຈັດເກັບສຳເນົາ MOU ໄວ້ໃນລະບົບ Partner Dashboard ຂອງທ່ານ",
    ],
    downloadLabel: "ຂໍຕົວຢ່າງຮ່າງ MOU",
    downloadNote: "ທີມງານຈະສົ່ງຕົວຢ່າງເອກະສານໃຫ້ທາງອີເມວຫຼັງຈາກຢືນຢັນຄຸນສົມບັດເບື້ອງຕົ້ນ",
  },
  responsibilitiesSla: {
    headline: "ຄວາມຮັບຜິດຊອບ ແລະ SLA",
    intro: "ແບ່ງບົດບາດໜ້າທີ່ລະຫວ່າງ WOS ແລະ ຄູ່ຮ່ວມທຸລະກິດໃຫ້ຊັດເຈນ ພ້ອມມາດຕະຖານເວລາຕອບສະໜອງທີ່ຕົກລົງຮ່ວມກັນ",
    responsibilities: [
      { area: "ການຕະຫຼາດ ແລະ ຫາລູກຄ້າ", wos: "ຈັດຫາ ແລະ ຄັດກອງນັກທ່ອງທ່ຽວເຊີງການແພດ", partner: "ໃຫ້ຂໍ້ມູນບໍລິການທີ່ຖືກຕ້ອງ ແລະ ທັນສະໄໝ" },
      { area: "ການຈອງ ແລະ ຢືນຢັນ", wos: "ຈັດການລະບົບຈອງຜ່ານແພລດຟອມ", partner: "ຢືນຢັນ ຫຼື ປະຕິເສດຄຳຮ້ອງຂໍຈອງພາຍໃນເວລາທີ່ກຳນົດ" },
      { area: "ຄຸນນະພາບບໍລິການ", wos: "ກວດສອບຄຸນນະພາບ ແລະ ຮັບ Feedback ຈາກຜູ້ໃຊ້", partner: "ໃຫ້ບໍລິການຕາມມາດຕະຖານທີ່ຕົກລົງໄວ້ໃນ MOU" },
      { area: "ການຈ່າຍເງິນ", wos: "ໂອນເງິນຕາມຮອບບິນທີ່ກຳນົດ", partner: "ອອກໃບຮັບເງິນ/ເອກະສານບັນຊີທີ່ຖືກຕ້ອງ" },
      { area: "ຂໍ້ມູນລູກຄ້າ", wos: "ປົກປ້ອງຂໍ້ມູນຕາມນະໂຍບາຍຄວາມເປັນສ່ວນຕົວ", partner: "ໃຊ້ຂໍ້ມູນລູກຄ້າສະເພາະເພື່ອການໃຫ້ບໍລິການທີ່ຈອງຜ່ານ WOS" },
    ],
    slaHeadline: "ມາດຕະຖານເວລາຕອບສະໜອງ (SLA)",
    slaItems: [
      { label: "ຢືນຢັນການຈອງ", target: "ພາຍໃນ 4 ຊົ່ວໂມງເຮັດວຽກ" },
      { label: "ຕອບຄຳຖາມລູກຄ້າ", target: "ພາຍໃນ 24 ຊົ່ວໂມງ" },
      { label: "ແຈ້ງບັນຫາຮີບດ່ວນ (Urgent Case)", target: "ພາຍໃນ 1 ຊົ່ວໂມງ" },
      { label: "ຮອບການຈ່າຍເງິນຄູ່ຮ່ວມທຸລະກິດ", target: "ພາຍໃນ 30 ວັນຫຼັງປິດຮອບບິນ" },
    ],
  },
  seo: {
    title: "ເປັນຄູ່ຮ່ວມທຸລະກິດກັບ WOS | Medical Tourism Partner Network",
    description: "ຮ່ວມເປັນຄູ່ຮ່ວມທຸລະກິດກັບ WOS ລະບົບນິເວດການທ່ອງທ່ຽວເຊີງການແພດທີ່ໂປ່ງໃສ ປອດໄພ ແລະ ເຕີບໂຕຢ່າງຍືນຍົງ",
    keywords: ["ຄູ່ຮ່ວມທຸລະກິດ", "ການທ່ອງທ່ຽວເຊີງການແພດ", "WOS", "ໂຮງໝໍ", "ຄລີນິກ", "ໂຮງແຮມ", "ບໍລິການຮັບສົ່ງ"],
  },
  applyForm: {
    eyebrow: "PARTNER APPLICATION",
    headline: "Apply to Become a Founding Partner",
    subheadline: "ປ້ອນຂໍ້ມູນຂ້າງລຸ່ມ ທີມງານຈະກວດສອບ ແລະ ຕິດຕໍ່ກັບພາຍໃນ 48 ຊົ່ວໂມງ",
    sections: {
      company: "ຂໍ້ມູນອົງກອນ",
      contact: "ຂໍ້ມູນຜູ້ຕິດຕໍ່",
      services: "ປະເພດ ແລະ ບໍລິການ",
      consent: "ຢືນຢັນການສະໝັກ",
    },
    fields: {
      companyName: "ຊື່ອົງກອນ / ສະຖານປະກອບການ",
      registrationNumber: "ເລກທະບຽນນິຕິບຸກຄົນ",
      taxId: "ເລກປະຈຳຕົວຜູ້ເສຍພາສີ",
      businessType: "ປະເພດທຸລະກິດ",
      businessTypeOptions: [
        { value: "HOSPITAL", label: "ໂຮງໝໍ" },
        { value: "CLINIC", label: "ຄລີນິກສະເພາະທາງ" },
        { value: "HOTEL", label: "ໂຮງແຮມ ແລະ ທີ່ພັກ" },
        { value: "TRANSPORT", label: "ບໍລິການຮັບສົ່ງ" },
        { value: "CORPORATE", label: "ອົງກອນ ແລະ ນັກລົງທຶນ" },
        { value: "WELLNESS_SPA", label: "ບໍລິການ Wellness ແລະ ສະປາ" },
      ],
      yearEstablished: "ປີກໍ່ຕັ້ງ",
      employeeCount: "ຈຳນວນພະນັກງານ",
      primaryName: "ຊື່ຜູ້ຕິດຕໍ່ຫຼັກ",
      primaryTitle: "ຕຳແໜ່ງ",
      primaryEmail: "ອີເມວ",
      primaryPhone: "ເບີໂທລະສັບ",
      primaryLineId: "Line ID",
      address: "ທີ່ຢູ່",
      district: "ເມືອງ/ຕົວເມືອງ",
      province: "ແຂວງ",
      postalCode: "ລະຫັດໄປສະນີ",
      serviceTypes: "ບໍລິການທີ່ໃຫ້ (ເລືອກໄດ້ຫຼາຍກວ່າ 1)",
      languages: "ພາສາທີ່ໃຫ້ບໍລິການ",
      operatingHours: "ເວລາເຮັດວຽກ",
      capacity: "ຄວາມສາມາດຮອງຮັບ (ເຊັ່ນ: ຈຳນວນຕຽງ/ຫ້ອງ/ຄັນ)",
    },
    consent: {
      acceptTerms: "ຂ້າພະເຈົ້າຍອມຮັບຂໍ້ກຳນົດ ແລະ ເງື່ອນໄຂການເປັນຄູ່ຮ່ວມທຸລະກິດຂອງ WOS",
      acceptPrivacy: "ຂ້າພະເຈົ້າຍອມຮັບນະໂຍບາຍຄວາມເປັນສ່ວນຕົວຂອງ WOS",
      acceptSLA: "ຂ້າພະເຈົ້າຮັບຊາບ ແລະ ຍິນຍອມປະຕິບັດຕາມມາດຕະຖານ SLA ທີ່ກຳນົດ",
    },
    submitLabel: "ສົ່ງໃບສະໝັກ",
    submittingLabel: "ກຳລັງສົ່ງຂໍ້ມູນ...",
    successTitle: "ສົ່ງໃບສະໝັກສຳເລັດ",
    successBody: "ຂອບໃຈສຳລັບຄວາມສົນໃຈ ທີມງານ WOS ຈະຕິດຕໍ່ກັບພາຍໃນ 48 ຊົ່ວໂມງ",
    errorTitle: "ສົ່ງໃບສະໝັກບໍ່ສຳເລັດ",
    errorBody: "ກະລຸນາລອງໃໝ່ອີກຄັ້ງ ຫຼື ຕິດຕໍ່ທີມງານໂດຍກົງຖ້າບັນຫາຍັງເກີດຂຶ້ນ",
    validationError: "ກະລຸນາປ້ອນຂໍ້ມູນໃນຊ່ອງທີ່ມີເຄື່ອງໝາຍ * ໃຫ້ຄົບຖ້ວນ",
  },
};
