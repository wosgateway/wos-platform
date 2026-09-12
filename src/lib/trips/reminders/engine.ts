// src/lib/trips/reminders/engine.ts
//
// Orchestration for the My Journey Phase 2 Reminder Engine, following
// the brief's §15 pipeline shape:
//
//   getEligibleReminders() -> claimDelivery() -> sendReminderWhatsApp()
//                                              -> recordDeliveryResult()
//
// Two entry points:
//   - runReminderSweep()   R1/R2, called by the cron route (engine.ts
//                           is deployment-agnostic; see
//                           src/app/api/cron/trip-reminders/route.ts)
//   - notifyEventConfirmed() R3, called inline wherever a trip_event
//                           transitions pending -> confirmed (both the
//                           admin and partner status-update routes)
//
// Business logic intentionally does NOT live in either WhatsApp API
// route or either status-update route — brief §15's "Business logic
// ไม่ควรอยู่ใน WhatsApp API route โดยตรง" — so a future LINE/email
// channel only needs a new sendReminderX() in src/lib/notify/, not a
// rewrite of anything in this file.

import { createServiceClient } from '@/lib/supabase/service';
import { getEligibleReminders, fetchReminderRowForEvent } from './eligibility';
import { claimDelivery, recordDeliveryResult } from './duplicate';
import { sendReminderWhatsApp, ReminderNotConfiguredError } from '@/lib/notify/trip-reminder-whatsapp';
import type { EligibleReminder, ReminderSweepResult } from './types';

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Claim -> send -> record for one reminder. Never throws — every
 *  outcome (sent/failed/skipped, including "already claimed") is
 *  handled internally, matching brief §17 (Failure Handling: a
 *  WhatsApp failure must never crash the system). */
async function deliverOne(
  supabase: ServiceClient,
  reminder: EligibleReminder
): Promise<'sent' | 'failed' | 'skipped' | 'already_claimed'> {
  const deliveryId = await claimDelivery(supabase, reminder.tripEventId, reminder.reminderType);
  if (!deliveryId) return 'already_claimed';

  if (!reminder.contactPhone) {
    await recordDeliveryResult(supabase, deliveryId, 'skipped', 'no_whatsapp_contact');
    return 'skipped';
  }

  try {
    await sendReminderWhatsApp(reminder);
    await recordDeliveryResult(supabase, deliveryId, 'sent', null);
    return 'sent';
  } catch (err) {
    if (err instanceof ReminderNotConfiguredError) {
      await recordDeliveryResult(supabase, deliveryId, 'skipped', 'channel_not_configured');
      return 'skipped';
    }
    const message = err instanceof Error ? err.message : 'unknown_error';
    console.error(
      `reminder send failed for event ${reminder.tripEventId} (${reminder.reminderType}):`,
      message
    );
    await recordDeliveryResult(supabase, deliveryId, 'failed', message);
    return 'failed';
  }
}

/** Cron entry point — sweeps every R1/R2 reminder due right now. */
export async function runReminderSweep(now: Date = new Date()): Promise<ReminderSweepResult> {
  const supabase = createServiceClient();
  const eligible = await getEligibleReminders(now);

  const result: ReminderSweepResult = {
    sent: 0,
    failed: 0,
    skipped: 0,
    consideredCount: eligible.length,
  };

  for (const reminder of eligible) {
    const outcome = await deliverOne(supabase, reminder);
    if (outcome === 'sent') result.sent++;
    else if (outcome === 'failed') result.failed++;
    else if (outcome === 'skipped') result.skipped++;
    // 'already_claimed' isn't counted — it means a previous sweep (or
    // this same event racing on two rows of R1 vs R2) already owns it.
  }

  return result;
}

/**
 * R3 hook — call this (fire-and-forget, `void notifyEventConfirmed(id)`)
 * immediately after a trip_event's status successfully transitions to
 * 'confirmed'. Same swallow-and-log contract as every other notify*
 * function in this codebase (order-notify.ts, customer-whatsapp.ts,
 * driver-line.ts, hotel-line.ts) — this function resolves, never throws.
 */
export async function notifyEventConfirmed(tripEventId: string): Promise<void> {
  try {
    const reminder = await fetchReminderRowForEvent(tripEventId);
    if (!reminder) return; // trip/event not reminder-eligible right now — silent no-op

    const supabase = createServiceClient();
    await deliverOne(supabase, reminder);
  } catch (err) {
    console.error(`notifyEventConfirmed failed for event ${tripEventId}:`, err);
  }
}
