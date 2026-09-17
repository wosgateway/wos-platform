// content/partner/images.ts
//
// Image manifest for /partner. Paths only live here so the design team can
// swap art direction without touching components or copy.
//
// Art direction (visual brief): editorial luxury travel photography —
// natural light, soft contrast, real Asian travellers, warm skin tones,
// premium Thai environments, subtle Thailand context. NOT clinical stock:
// no clipboards, no hospital beds, no close-up medical equipment.
//
// Drop the files into /public/images/partner/. Required ratios are listed
// next to each entry and enforced in CSS, so an off-ratio file will be
// cropped (object-fit: cover) rather than break the layout.

import type { Locale } from "./types";

export interface PartnerImage {
  src: string;
  alt: string;
}

type AltByLocale = Record<Locale, string>;

interface ImageEntry {
  src: string;
  alt: AltByLocale;
}

const manifest = {
  /** 16:9 — hero. Asian wellness traveller arriving at a premium Thai resort. */
  hero: {
    src: "/images/partner/hero-wellness-traveler.webp",
    alt: {
      th: "นักเดินทางชาวเอเชียเข้าสู่ Wellness Resort ในประเทศไทย",
      en: "Asian traveller arriving at a wellness resort in Thailand",
      lo: "ນັກເດີນທາງຊາວອາຊີເຂົ້າສູ່ Wellness Resort ໃນປະເທດໄທ",
    },
  },
  /** 4:3 — why WOS. A provider welcoming a guest: the partner receiving a customer. */
  whyPartner: {
    src: "/images/partner/why-welcome.webp",
    alt: {
      th: "ทีมงานผู้ให้บริการกำลังต้อนรับลูกค้า",
      en: "A wellness consultant welcoming a guest",
      lo: "ທີມງານຜູ້ໃຫ້ບໍລິການກຳລັງຕ້ອນຮັບລູກຄ້າ",
    },
  },
  /** 16:9 wide panorama — the journey section backdrop. */
  journey: {
    src: "/images/partner/journey-wide.webp",
    alt: {
      th: "การเดินทางจากลาวสู่ประเทศไทยเพื่อรับบริการ Wellness",
      en: "The journey from Laos into Thailand for wellness care",
      lo: "ການເດີນທາງຈາກລາວສູ່ປະເທດໄທເພື່ອຮັບບໍລິການ Wellness",
    },
  },
  /** 4:3 — Who can join, card 1. */
  healthcare: {
    src: "/images/partner/group-healthcare.webp",
    alt: {
      th: "การปรึกษากับแพทย์ในคลินิกสมัยใหม่",
      en: "A consultation in a modern clinic",
      lo: "ການປຶກສາກັບແພດໃນຄລີນິກທັນສະໄໝ",
    },
  },
  /** 4:3 — Who can join, card 2. */
  wellness: {
    src: "/images/partner/group-wellness.webp",
    alt: {
      th: "บรรยากาศการดูแลสุขภาพแบบ Wellness",
      en: "A wellness treatment in a calm, premium setting",
      lo: "ບັນຍາກາດການດູແລສຸຂະພາບແບບ Wellness",
    },
  },
  /** 4:3 — Who can join, card 3. */
  hospitality: {
    src: "/images/partner/group-hospitality.webp",
    alt: {
      th: "โรงแรมและการเดินทางระดับพรีเมียมในประเทศไทย",
      en: "Premium hotel and travel experience in Thailand",
      lo: "ໂຮງແຮມ ແລະ ການເດີນທາງລະດັບພຣີມຽມໃນປະເທດໄທ",
    },
  },
  /** 4:5 — Founding Partner, beside the navy copy block. */
  founding: {
    src: "/images/partner/founding-experience.webp",
    alt: {
      th: "ลูกค้าเข้าสู่ประสบการณ์ Wellness ระดับพรีเมียม",
      en: "Guests entering a premium Thai wellness experience",
      lo: "ລູກຄ້າເຂົ້າສູ່ປະສົບການ Wellness ລະດັບພຣີມຽມ",
    },
  },
  /** 4:3 small — How it works, moment 01. */
  step01: {
    src: "/images/partner/step-apply.webp",
    alt: {
      th: "ส่งข้อมูลธุรกิจผ่านมือถือ",
      en: "Submitting business details from a phone",
      lo: "ສົ່ງຂໍ້ມູນທຸລະກິດຜ່ານມືຖື",
    },
  },
  /** 4:3 small — How it works, moment 02. */
  step02: {
    src: "/images/partner/step-review.webp",
    alt: {
      th: "การพูดคุยระหว่างทีม WOS และ Partner",
      en: "A conversation between the WOS team and a partner",
      lo: "ການລົມກັນລະຫວ່າງທີມ WOS ແລະ Partner",
    },
  },
  /** 4:3 small — How it works, moment 03. */
  step03: {
    src: "/images/partner/step-build.webp",
    alt: {
      th: "ร่วมออกแบบ Package สำหรับลูกค้าลาว",
      en: "Designing a service package together",
      lo: "ຮ່ວມອອກແບບ Package ສຳລັບລູກຄ້າລາວ",
    },
  },
  /** 4:3 small — How it works, moment 04. */
  step04: {
    src: "/images/partner/step-launch.webp",
    alt: {
      th: "ลูกค้าเข้ารับบริการกับ Partner",
      en: "A customer receiving care from a partner",
      lo: "ລູກຄ້າເຂົ້າຮັບບໍລິການກັບ Partner",
    },
  },
  /** 16:9 full-bleed — closing CTA backdrop. */
  finalCta: {
    src: "/images/partner/cta-wellness-thailand.webp",
    alt: {
      th: "บรรยากาศ Wellness ระดับพรีเมียมในประเทศไทย",
      en: "A premium wellness setting in Thailand",
      lo: "ບັນຍາກາດ Wellness ລະດັບພຣີມຽມໃນປະເທດໄທ",
    },
  },
} satisfies Record<string, ImageEntry>;

export type PartnerImageKey = keyof typeof manifest;

export function getPartnerImages(locale: Locale): Record<PartnerImageKey, PartnerImage> {
  const out = {} as Record<PartnerImageKey, PartnerImage>;
  (Object.keys(manifest) as PartnerImageKey[]).forEach((key) => {
    const entry: ImageEntry = manifest[key];
    out[key] = { src: entry.src, alt: entry.alt[locale] };
  });
  return out;
}
