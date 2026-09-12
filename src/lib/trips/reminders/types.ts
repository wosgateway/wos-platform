// src/lib/trips/reminders/types.ts
//
// Shared types for the My Journey Phase 2 Reminder Engine.
// See docs: WOS — My Journey / Phase 2 — Journey Reminder brief.

export type ReminderType = 'r1_24h' | 'r2_1h' | 'r3_confirmed';

export type DeliveryStatus = 'sent' | 'failed' | 'skipped';

export type PreferredLanguage = 'th' | 'lo' | 'en';

/** One reminder that is due to be sent (or has just been triggered by an
 *  event transition, for r3_confirmed) — everything sendReminderWhatsApp()
 *  needs, with no internal ids beyond what stays server-side. */
export interface EligibleReminder {
  reminderType: ReminderType;
  tripEventId: string;
  tripId: string;

  /** Trips.access_token — the ONLY thing that goes into the customer-facing
   *  link, per brief §6 (never internal trip/event/partner ids). */
  accessToken: string;
  preferredLanguage: PreferredLanguage;

  eventTitle: string;
  eventType: string;
  eventDate: string; // YYYY-MM-DD
  startTime: string | null; // HH:MM:SS (Postgres `time`), Bangkok wall-clock
  location: string | null;

  /** Primary participant's WhatsApp-reachable phone, already in E.164
   *  ('+66...'), or null if none on file / not confirmed E.164 — see
   *  toWhatsAppRecipient() in src/lib/notify/customer-whatsapp.ts for why
   *  we never guess a country code here either. */
  contactPhone: string | null;
}

export interface ReminderSweepResult {
  sent: number;
  failed: number;
  skipped: number;
  consideredCount: number;
}
