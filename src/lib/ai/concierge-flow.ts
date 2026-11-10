import type { WosLanguage } from './language-dictionary';
import { getWosConciergeStage, type WosJourneyState } from './journey-state';
import { buildConciergeHandoffSummary, buildHandoffConfirmation } from '@/lib/handoff/concierge';

/**
 * Single control point for the selected-program concierge intake:
 *
 *   program -> name -> transport? -> pickup (if transport) -> hotel? -> handoff summary
 *
 * Journey State (journey-state.ts) decides WHAT the customer has said, binding every
 * short answer to the one question Fern just asked. This module decides WHAT FERN
 * SAYS NEXT from that state, in one place. Nothing in core.ts should re-derive
 * transport/hotel answers from raw text.
 */

const ASK_TRANSPORT: Record<WosLanguage, string> = {
  lo: 'ຮັບຊາບຄ່ະ 😊 ສົນໃຈລົດຮັບສົ່ງນຳບໍຄ່ະ?',
  en: 'Got it 😊 Would you like transport as well?',
  th: 'รับทราบค่ะ 😊 สนใจรถรับส่งด้วยไหมคะ?',
};

const ASK_PICKUP: Record<WosLanguage, string> = {
  lo: 'ໄດ້ຄ່ະ 😊 ຂໍຈຸດຮັບດ້ວຍນະຄະ ທີມ WOS ຈະປະສານລາຍລະອຽດລົດສ່ວນທີ່ເຫຼືອຕໍ່ໃຫ້ຄ່ະ',
  en: 'Sure 😊 What is the pickup point? The WOS team will coordinate the remaining transport details with you.',
  th: 'ได้เลยค่ะ 😊 ขอจุดรับด้วยนะคะ เดี๋ยวทีม WOS จะประสานรายละเอียดรถส่วนที่เหลือต่อให้ค่ะ',
};

// Asked right after a pickup point was captured.
const ASK_HOTEL_AFTER_PICKUP: Record<WosLanguage, string> = {
  lo: 'ຮັບຊາບແລ້ວ 😊 ໃບເຟີນມີຈຸດຮັບແລ້ວ. ສົນໃຈໂຮງແຮມນຳບໍຄ່ະ?',
  en: 'Perfect 😊 I have the pickup point. Would you like a hotel too?',
  th: 'เรียบร้อยค่ะ 😊 ใบเฟิร์นมีจุดรับแล้วนะคะ สนใจโรงแรมด้วยไหมคะ?',
};

// Asked when transport was declined: there is no pickup point to mention.
const ASK_HOTEL_NO_TRANSPORT: Record<WosLanguage, string> = {
  lo: 'ຮັບຊາບຄ່ະ 😊 ສົນໃຈໂຮງແຮມນຳບໍຄ່ະ?',
  en: 'Got it 😊 Would you like a hotel too?',
  th: 'รับทราบค่ะ 😊 สนใจโรงแรมด้วยไหมคะ?',
};

export function buildAskTransportReply(language: WosLanguage): string {
  return ASK_TRANSPORT[language];
}

export function buildAskPickupReply(language: WosLanguage): string {
  return ASK_PICKUP[language];
}

export function buildAskHotelReply(language: WosLanguage, state: Pick<WosJourneyState, 'transportNeeded' | 'transportOrigin'>): string {
  return state.transportNeeded === true && state.transportOrigin
    ? ASK_HOTEL_AFTER_PICKUP[language]
    : ASK_HOTEL_NO_TRANSPORT[language];
}

/**
 * Next concierge reply for the current journey state, or null when this module
 * has nothing to say (no selected program, or the name gate in core.ts owns the turn).
 */
export function decideConciergeReply(state: WosJourneyState, language: WosLanguage): string | null {
  if (!state.selectedProgram) return null;

  if (!state.customerName) {
    // The public chat API carries no sender metadata, so the name may still be
    // missing. The one transition we can still honour is the transport "yes":
    // ask for the pickup point instead of restarting the intake.
    if (state.answeredQuestion === 'transport' && state.transportNeeded === true && !state.transportOrigin) {
      return buildAskPickupReply(language);
    }
    return null;
  }

  switch (getWosConciergeStage(state)) {
    case 'ask_transport_interest':
      return buildAskTransportReply(language);
    case 'collecting_transport':
      return buildAskPickupReply(language);
    case 'ask_hotel_interest':
      return buildAskHotelReply(language, state);
    case 'awaiting_confirmation':
      // The turn that answered the hotel question (yes OR no) closes the intake
      // with the same summary; the summary lists every captured status.
      if (
        state.answeredQuestion === 'hotel' ||
        (state.answeredQuestion === 'transport' && state.hotelNeeded !== undefined)
      ) {
        return buildConciergeHandoffSummary(language, state);
      }
      return buildHandoffConfirmation(language);
    default:
      return null;
  }
}
