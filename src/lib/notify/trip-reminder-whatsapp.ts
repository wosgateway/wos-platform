// src/lib/notify/trip-reminder-whatsapp.ts
//
// My Journey Phase 2 — WhatsApp delivery for R1/R2/R3 reminders.
// Sibling to src/lib/notify/customer-whatsapp.ts, reusing its
// timeout guard and phone-normalization safety rule rather than
// duplicating them (imported below) — same fetch, same "never guess a
// country code" policy for Lao numbers.
//
// TEMPLATE-BASED, NOT FREE TEXT — AND WHY:
// Meta's WhatsApp Cloud API only allows business-initiated messages
// (i.e. WOS messaging a customer who hasn't just messaged WOS) through
// pre-approved message templates, regardless of session window. That
// means the actual customer-visible copy shown in the brief's mockups
// (§4's "🔔 พรุ่งนี้คือ Wellness Journey ของคุณ" etc.) lives in Meta's
// Template Library, submitted and approved per language (th/lo/en) —
// the same th/lo/en-per-template pattern customer-whatsapp.ts already
// uses for order-confirmed/payment-verified/partner-assigned. This
// module supplies only the DYNAMIC parts of an already-approved
// template: body variables (event title / time / location) and one or
// two dynamic-suffix URL buttons. It cannot render literal message
// text — there's no "send arbitrary Thai/Lao/English string" path in
// Meta's API for a business-initiated notification, so brief §13's
// "ห้ามสร้างข้อความหลายภาษาแบบ hardcode ใน API" is satisfied by design:
// nothing here hardcodes customer-facing copy in any language, the
// approved templates are that localization layer.
//
// REQUIRED ENV (all optional independently — a missing template name
// silently no-ops that reminder type, same philosophy as
// customer-whatsapp.ts so local/dev never needs any of this configured):
//   WHATSAPP_ACCESS_TOKEN            (shared with customer-whatsapp.ts)
//   WHATSAPP_PHONE_NUMBER_ID         (shared with customer-whatsapp.ts)
//   WHATSAPP_TEMPLATE_JOURNEY_REMINDER_24H
//   WHATSAPP_TEMPLATE_JOURNEY_REMINDER_1H
//   WHATSAPP_TEMPLATE_JOURNEY_REMINDER_CONFIRMED
//
// TEMPLATE CONTRACT each of the 3 templates must be approved with:
//   - body: exactly 3 text variables, in order: {{1}} event title,
//     {{2}} event time (HH:MM, Bangkok), {{3}} location (may be empty
//     string — Meta requires a value, so pass a single space if the
//     event has no location; do not omit the component)
//   - button 0: a URL button whose base is
//     "https://wos.asia/{locale}/my-trip/token/" (or your deployed
//     origin) with a trailing {{1}} suffix — we pass the trip's
//     access_token as that suffix, never an internal id (brief §6)
//   - button 1 (OPTIONAL, only if the template defines it): a second
//     URL button, base "https://www.google.com/maps/search/?api=1&query="
//     with a trailing {{1}} suffix — we pass the URL-encoded location.
//     Only sent when the event has a location (brief §14: no Maps CTA
//     when there's nothing to point at).

import {
  WHATSAPP_TIMEOUT_MS,
  fetchWithTimeout,
  toWhatsAppRecipient,
} from './customer-whatsapp';
import type { EligibleReminder } from '@/lib/trips/reminders/types';
import { formatBangkokTime } from '@/lib/trips/reminders/bangkok-time';

const REMINDER_TEMPLATE_ENV: Record<EligibleReminder['reminderType'], string> = {
  r1_24h: 'WHATSAPP_TEMPLATE_JOURNEY_REMINDER_24H',
  r2_1h: 'WHATSAPP_TEMPLATE_JOURNEY_REMINDER_1H',
  r3_confirmed: 'WHATSAPP_TEMPLATE_JOURNEY_REMINDER_CONFIRMED',
};

/** Thrown when the reminder was NOT sent because of missing/incomplete
 *  configuration (no template name set for this type) — the caller
 *  treats this as a 'skipped' delivery, not a 'failed' one, since it is
 *  an operator/config state rather than a send-time error. */
export class ReminderNotConfiguredError extends Error {}

function buildButtonComponents(accessToken: string, location: string | null) {
  const components: Array<Record<string, unknown>> = [
    {
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: accessToken }],
    },
  ];

  if (location && location.trim().length > 0) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '1',
      parameters: [{ type: 'text', text: encodeURIComponent(location.trim()) }],
    });
  }

  return components;
}

export async function sendReminderWhatsApp(reminder: EligibleReminder): Promise<void> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env[REMINDER_TEMPLATE_ENV[reminder.reminderType]];

  if (!accessToken || !phoneNumberId || !templateName) {
    throw new ReminderNotConfiguredError(
      `reminder channel not configured for ${reminder.reminderType}`
    );
  }

  if (!reminder.contactPhone) {
    // Caller (engine.ts) already checks this before calling — this is
    // a defensive second check, not the primary path.
    throw new Error('no contact phone on reminder');
  }

  const recipient = toWhatsAppRecipient(reminder.contactPhone);
  if (!recipient) {
    throw new Error('contact phone has no confirmed country code');
  }

  const timeLabel = formatBangkokTime(reminder.startTime);
  const locationLabel = reminder.location?.trim() || ' '; // Meta requires a non-empty variable

  const res = await fetchWithTimeout(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: templateName,
          language: { code: reminder.preferredLanguage },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: reminder.eventTitle },
                { type: 'text', text: timeLabel },
                { type: 'text', text: locationLabel },
              ],
            },
            ...buildButtonComponents(reminder.accessToken, reminder.location),
          ],
        },
      }),
    },
    WHATSAPP_TIMEOUT_MS
  );

  if (!res.ok) {
    // Same no-raw-body logging rule as customer-whatsapp.ts — Meta may
    // echo request data (recipient, params) into its error payload.
    throw new Error(`reminder WhatsApp send failed: ${templateName} (${res.status})`);
  }
}
