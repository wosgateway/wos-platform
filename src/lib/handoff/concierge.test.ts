import { describe, expect, it } from 'vitest';
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
    const localState = { needs: ['health'], transportNeeded: undefined, hotelNeeded: undefined };
    expect(buildServiceOptionsPrompt('th', localState)).toContain('มีอะไรให้ใบเฟิร์นช่วยเพิ่มเติม');

    const travelState = {
      needs: ['health'],
      origin: 'เวียงจันทน์',
      transportNeeded: undefined,
      hotelNeeded: undefined,
    };
    expect(buildServiceOptionsPrompt('th', travelState)).toContain('รถรับส่ง');
    expect(buildServiceOptionsPrompt('th', { ...travelState, transportNeeded: false })).toContain('ห้องพัก');
  });

  it('does not re-ask optional services after customer declines both', () => {
    const state = { needs: ['health'], transportNeeded: false, hotelNeeded: false };
    expect(buildServiceOptionsPrompt('th', state)).toContain('มีอะไรให้ใบเฟิร์นช่วยเพิ่มเติม');
  });

  it('builds non-empty confirmation/contact prompts', () => {
    expect(buildHandoffConfirmation('th')).toContain('ยืนยัน');
    expect(buildHandoffContactPrompt('th')).toContain('ชื่อ');
    expect(buildHandoffConfirmation('en')).toContain('confirm');
  });
});
