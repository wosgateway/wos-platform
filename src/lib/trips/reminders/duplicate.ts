// src/lib/trips/reminders/duplicate.ts
//
// Brief §8 (Duplicate Protection). Atomic claim-then-resolve pattern —
// see sql/095_trip_reminder_deliveries.sql's header comment for the
// full idempotency model and its documented tradeoff.

import { createServiceClient } from '@/lib/supabase/service';
import type { DeliveryStatus, ReminderType } from './types';

type ServiceClient = ReturnType<typeof createServiceClient>;

const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Attempts to claim the (tripEventId, reminderType) slot by inserting a
 * 'pending' row. Returns the new row's id on success, or null if the
 * slot is already claimed (by a 'sent'/'failed'/'skipped'/'pending' row
 * from this or a concurrent run) — null means "do not send, someone
 * already has this."
 */
export async function claimDelivery(
  supabase: ServiceClient,
  tripEventId: string,
  reminderType: ReminderType
): Promise<string | null> {
  const { data, error } = await supabase
    .from('trip_reminder_deliveries')
    .insert({ trip_event_id: tripEventId, reminder_type: reminderType, status: 'pending' })
    .select('id')
    .single();

  if (error) {
    if ((error as { code?: string }).code !== POSTGRES_UNIQUE_VIOLATION) {
      console.error(
        `reminder claim failed for event ${tripEventId} (${reminderType}):`,
        error.message
      );
    }
    return null;
  }

  return data.id as string;
}

export async function recordDeliveryResult(
  supabase: ServiceClient,
  deliveryId: string,
  status: DeliveryStatus,
  reason: string | null
): Promise<void> {
  const { error } = await supabase
    .from('trip_reminder_deliveries')
    .update({ status, reason })
    .eq('id', deliveryId);

  if (error) {
    // Best-effort logging only — the WhatsApp send itself already
    // happened (or was skipped/failed) by the time this runs, so there
    // is nothing left to roll back. A row stuck at 'pending' here has
    // the same documented tradeoff as a crash mid-send (see migration
    // 095's header comment).
    console.error(`reminder delivery record update failed for ${deliveryId}:`, error.message);
  }
}
