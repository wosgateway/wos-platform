import { describe, expect, it } from 'vitest';
import { deriveWosJourneyState, getWosConciergeStage } from '@/lib/ai/journey-state';
import type { WosJourneyState } from '@/lib/ai/journey-state';
import type { WosAIHistoryMessage } from '@/lib/ai/core';
import { buildProgramAnswer } from '@/lib/ai/program-answer';
import {
  buildHandoffConfirmation,
  buildHandoffContactPrompt,
  buildServiceOptionsPrompt,
  detectHandoffLanguage,
  extractContact,
  isHandoffConfirmation,
  isJourneyReady,
} from './concierge';

const trip = {
  needs: ['trip'],
  activeNeed: 'trip',
  destination: 'Udon Thani',
  serviceDate: '2026-10-10',
  travelers: 2,
  budgetThb: 15000,
} as const;

describe('handoff concierge', () => {
  it('detects Thai, Lao and English', () => {
    expect(detectHandoffLanguage('ยืนยันครับ')).toBe('th');
    expect(detectHandoffLanguage('ຢືນຢັນ')).toBe('lo');
    expect(detectHandoffLanguage('yes, confirm')).toBe('en');
  });

  it('requires explicit confirmation and rejects negative wording', () => {
    expect(isHandoffConfirmation('ใช่ครับ ยืนยันได้เลย')).toBe(true);
    expect(isHandoffConfirmation('yes, confirm')).toBe(true);
    expect(isHandoffConfirmation('ไม่ใช่ครับ')).toBe(false);
  });

  it('extracts sender phone before parsing message text', () => {
    expect(extractContact(
      { name: 'Boy', phone_number: '+66812345678' },
      'yes',
    )).toEqual({ name: 'Boy', channel: 'phone', value: '+66812345678' });
  });

  it('extracts email from message when sender metadata is missing', () => {
    expect(extractContact({ name: 'A' }, 'confirm a@example.com')).toEqual({
      name: 'A',
      channel: 'email',
      value: 'a@example.com',
    });
  });

  it('requires the trip journey minimum fields', () => {
    expect(isJourneyReady(trip)).toBe(true);
    expect(isJourneyReady({ ...trip, budgetThb: undefined })).toBe(false);
  });

  it('extracts a Thai name from the customer message', () => {
    expect(extractContact(undefined, 'ชื่อนายประชา 0855667566')).toEqual({
      name: 'ประชา',
      channel: 'phone',
      value: '0855667566',
    });
  });

  it('keeps local health concierge progressive and avoids unsolicited travel add-ons', () => {
    const localState = { needs: ['health'] as const, transportNeeded: undefined, hotelNeeded: undefined } as WosJourneyState;
    expect(buildServiceOptionsPrompt('th', localState)).toContain('มีอะไรให้ใบเฟิร์นช่วยเพิ่มเติม');

    const travelState = {
      needs: ['health'] as const,
      origin: 'เวียงจันทน์',
      transportNeeded: undefined,
      hotelNeeded: undefined,
    } as WosJourneyState;
    expect(buildServiceOptionsPrompt('th', travelState)).toContain('รถรับส่ง');
    expect(buildServiceOptionsPrompt('th', { ...travelState, transportNeeded: false })).toContain('โรงแรม');
  });

  it('does not re-ask optional services after customer declines both', () => {
    const state = { needs: ['health'] as const, transportNeeded: false, hotelNeeded: false } as WosJourneyState;
    expect(buildServiceOptionsPrompt('th', state)).toContain('มีอะไรให้ใบเฟิร์นช่วยเพิ่มเติม');
  });

  it('preserves the full booking + transport + hotel concierge journey', () => {
    const history: WosAIHistoryMessage[] = [      { role: 'user', content: 'มีโปรแกรมอะไรบ้าง' },
      { role: 'assistant', content: '1. ตรวจเข่า - INDY CLINICS - อุดรธานี\n2. ตรวจสุขภาพ - DNA Wellness Center - อุดรธานี' },
      { role: 'user', content: 'อุดร' },
      { role: 'assistant', content: '1. ตรวจเข่า - INDY CLINICS - อุดรธานี\n2. ตรวจสุขภาพ - DNA Wellness Center - อุดรธานี' },
      { role: 'user', content: '1' },
      { role: 'assistant', content: 'รับทราบค่ะ เลือกตรวจเข่าแล้วนะคะ' },
      { role: 'user', content: 'ราคาเท่าไร' },
      { role: 'assistant', content: 'ราคาโปร 1,500 บาทค่ะ' },
      { role: 'user', content: 'จองเลยครับ' },
      { role: 'assistant', content: 'ได้เลยค่ะ' },
      { role: 'user', content: 'จองวันที่ 6 ตุลาคม เวลา 13.00 ชื่อนายปีชา' },
      { role: 'assistant', content: 'ขอสรุปข้อมูลก่อนนะคะ' },
      { role: 'user', content: 'สนใจรถ' },
      { role: 'assistant', content: 'สนใจรถรับส่งด้วยไหมคะ' },
      { role: 'user', content: 'รับวันที่ 6 ตุลาคม 11 โมง จากเวียงจัน ไปอุดร 2 คน' },
      { role: 'assistant', content: 'สนใจโรงแรมด้วยไหมคะ' },
      { role: 'user', content: 'สนใจโรงแรม' },
      { role: 'assistant', content: 'ขอจำนวนคน จำนวนห้อง และประเภทเตียงค่ะ' },
    ];
    const state = deriveWosJourneyState(history, '2 คน 1 ห้อง เตียงคู่');
    expect(state.selectedProgram).toBe('ตรวจเข่า');
    expect(state.serviceDate).toContain('6 ตุลาคม');
    expect(state.serviceTime).toContain('13.00');
    expect(state.customerName).toContain('ปีชา');
    expect(state.transportNeeded).toBe(true);
    expect(state.transportTime).toContain('11 โมง');
    expect(state.transportOrigin).toBe('เวียงจันทน์');
    expect(state.transportDestination).toBe('อุดรธานี');
    expect(state.transportTravelers).toBe(2);
    expect(state.hotelNeeded).toBe(true);
    expect(state.hotelTravelers).toBe(2);
    expect(state.hotelRooms).toBe(1);
    expect(state.roomType).toBe('double');
    expect(getWosConciergeStage(state)).toBe('awaiting_confirmation');
  });

  it('treats a selected health program as its own booking flow', () => {
    const history: WosAIHistoryMessage[] = [
      { role: 'user', content: 'มีโปรแกรมอะไรบ้าง' },
      { role: 'assistant', content: '1. ตรวจเข่า - INDY CLINICS - อุดรธานี' },
      { role: 'user', content: '1' },
      { role: 'assistant', content: 'เลือกตรวจเข่าแล้วค่ะ' },
      { role: 'user', content: 'วันที่ 10 ตุลาคม' },
    ];
    const dateOnly = deriveWosJourneyState(history, 'วันที่ 10 ตุลาคม');
    expect(dateOnly.selectedProgram).toBe('ตรวจเข่า');
    expect(getWosConciergeStage(dateOnly)).toBe('collecting_booking');

    const withTime = deriveWosJourneyState(history, 'เวลา 10.00 ชื่อนางประดับ');
    expect(withTime.selectedProgram).toBe('ตรวจเข่า');
    expect(withTime.serviceTime).toContain('10.00');
    expect(withTime.customerName).toContain('ประดับ');
    expect(getWosConciergeStage(withTime)).toBe('ask_transport_interest');
  });

  it('persists a bare customer name across later concierge turns', () => {
    const history: WosAIHistoryMessage[] = [
      { role: 'user', content: '1' },
      { role: 'assistant', content: 'เลือกตรวจเข่าแล้วค่ะ ขอวันที่และเวลาที่สะดวกด้วยค่ะ' },
      { role: 'user', content: 'วันที่ 7 ตุลาคม เวลา 13.00' },
      { role: 'assistant', content: 'ได้เลยค่ะ ขอชื่อสำหรับลงข้อมูลให้ทีม WOS ประสานงานต่อด้วยนะคะ' },
      { role: 'user', content: 'ประดับ' },
      { role: 'assistant', content: 'ขอบคุณค่ะ รับชื่อประดับแล้วนะคะ' },
    ];
    const state = deriveWosJourneyState(history, 'สนใจรถรับส่งครับ');
    expect(state.customerName).toBe('ประดับ');
    expect(state.transportNeeded).toBe(true);
  });

  it('keeps V1 transport and hotel intake minimal', () => {
    const base = {
      needs: ['health'] as const,
      selectedProgram: 'ตรวจเข่า',
      serviceDate: '2026-10-10',
      serviceTime: '10:00',
      customerName: 'นางประดับ',
      transportNeeded: true,
    } as WosJourneyState;

    expect(getWosConciergeStage(base)).toBe('collecting_transport');
    expect(buildServiceOptionsPrompt('th', { ...base, origin: 'สนามบินอุดรธานี' }))
      .not.toContain('งบประมาณ');

    const withPickup = { ...base, transportOrigin: 'สนามบินอุดรธานี' };
    expect(getWosConciergeStage(withPickup)).toBe('ask_hotel_interest');

    const withHotel = { ...withPickup, hotelNeeded: true };
    expect(getWosConciergeStage(withHotel)).toBe('awaiting_confirmation');
  });

  it('keeps multi-program catalog replies compact', () => {
    const answer = buildProgramAnswer([
      { title: 'ตรวจเข่า', special_price: 1500, original_price: 1900, description: 'รายละเอียดจำนวนมาก' },
      { title: 'ตรวจสุขภาพ', special_price: 1900, original_price: 2500, description: 'รายละเอียดจำนวนมาก' },
    ], 'มีโปรแกรมอะไรบ้าง', '', 'th');

    expect(answer).toContain('1. ตรวจเข่า — 1,500 บาท');
    expect(answer).toContain('2. ตรวจสุขภาพ — 1,900 บาท');
    expect(answer).not.toContain('รายละเอียดจำนวนมาก');
  });

  it('builds non-empty confirmation/contact prompts', () => {
    expect(buildHandoffConfirmation('th')).toContain('ยืนยัน');
    expect(buildHandoffContactPrompt('th')).toContain('ชื่อ');
    expect(buildHandoffConfirmation('en')).toContain('confirm');
  });
});
