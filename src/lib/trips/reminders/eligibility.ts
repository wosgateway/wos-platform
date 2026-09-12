// src/lib/trips/reminders/eligibility.ts
//
// getEligibleReminders() — brief §4 R1/R2, §7 (eligibility checks),
// §10 (late/missed handling). Time-window polled by the cron sweep.
//
// R3 (event-confirmed) is NOT time-window polled — it fires inline at
// the status-transition call site (see notifyEventConfirmed() in
// engine.ts). fetchReminderRowForEvent() below is shared by both paths
// so the "what counts as a usable trip/event" logic lives in one place.

import { createServiceClient } from '@/lib/supabase/service';
import { eventStartInBangkok } from './bangkok-time';
import type { EligibleReminder, PreferredLanguage } from './types';

type ServiceClient = ReturnType<typeof createServiceClient>;

// How late a scheduler run can be and still send a given reminder.
// R2 (1-hour-before) needs a tight grace window: "1 hour before" stops
// being true information well before a full hour has passed. QA
// scenario from the brief (§20 Test 5): event 14:00, job runs 13:20 —
// 20 minutes after the ideal 13:00 trigger — must NOT send. R1
// (24-hours-before) is a heads-up, not a countdown, so a same-morning
// "tomorrow" reminder still reads correctly hours after its ideal
// trigger time; a wider window is fine there.
const GRACE_MINUTES: Record<'r1_24h' | 'r2_1h', number> = {
  r1_24h: 180,
  r2_1h: 15,
};

const LEAD_MS: Record<'r1_24h' | 'r2_1h', number> = {
  r1_24h: 24 * 60 * 60 * 1000,
  r2_1h: 60 * 60 * 1000,
};

const EVENT_SELECT = `
  id, trip_id, event_type, title, event_date, start_time, location, status,
  trips!inner (
    id, status, access_token, token_revoked_at, token_expires_at, preferred_language,
    trip_participants ( is_primary, customers ( phone ) )
  )
`;

export interface RawTripRow {
  id: string;
  status: string;
  access_token: string;
  token_revoked_at: string | null;
  token_expires_at: string | null;
  preferred_language: PreferredLanguage;
  trip_participants: { is_primary: boolean; customers: { phone: string | null } | null }[];
}

interface RawEventRow {
  id: string;
  trip_id: string;
  event_type: string;
  title: string;
  event_date: string;
  start_time: string | null;
  location: string | null;
  status: string;
  trips: RawTripRow | null;
}

/** Exported so other consumers (the Attention Engine's MISSING_CUSTOMER_CONTACT
 *  case, see attention.ts) resolve "does this trip have a usable contact" the
 *  same way the reminder sweep does. Do not re-derive this independently —
 *  a second definition drifting from this one is how the reminder engine and
 *  the attention engine end up disagreeing about the same trip. */
export function primaryContactPhone(trip: RawTripRow | null): string | null {
  const participants = trip?.trip_participants ?? [];
  const primary = participants.find((p) => p.is_primary) ?? participants[0];
  return primary?.customers?.phone ?? null;
}

/** Brief §7 "Trip" eligibility checks: exists / not revoked / not expired.
 *  §11 (cancelled trip -> no reminder) folded in via trip.status. */
function tripIsUsable(trip: RawTripRow | null): boolean {
  if (!trip) return false;
  if (trip.status === 'cancelled') return false;
  if (trip.token_revoked_at) return false;
  if (trip.token_expires_at && new Date(trip.token_expires_at) < new Date()) return false;
  return true;
}

function toEligibleReminder(
  row: RawEventRow,
  reminderType: EligibleReminder['reminderType']
): EligibleReminder {
  return {
    reminderType,
    tripEventId: row.id,
    tripId: row.trip_id,
    accessToken: row.trips!.access_token,
    preferredLanguage: row.trips!.preferred_language,
    eventTitle: row.title,
    eventType: row.event_type,
    eventDate: row.event_date,
    startTime: row.start_time,
    location: row.location,
    contactPhone: primaryContactPhone(row.trips),
  };
}

/** Fetches every trip_event whose event_date falls within a ~2-day
 *  window around `now`, wide enough to cover both R1 (24h) and R2 (1h)
 *  trigger+grace windows regardless of what time of day the sweep runs. */
async function fetchCandidateRows(supabase: ServiceClient, now: Date): Promise<RawEventRow[]> {
  const windowStart = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // status filter: only pending/confirmed events are reminder-eligible —
  // covers §7 (event not cancelled) and §20 Test 6 (completed event ->
  // no late reminder) at the query level rather than after the fact.
  const { data, error } = await supabase
    .from('trip_events')
    .select(EVENT_SELECT)
    .not('start_time', 'is', null)
    .in('status', ['pending', 'confirmed'])
    .gte('event_date', windowStart)
    .lte('event_date', windowEnd);

  if (error || !data) {
    console.error('reminder eligibility: trip_events query failed:', error?.message);
    return [];
  }

  return data as unknown as RawEventRow[];
}

async function fetchAlreadySentTypes(
  supabase: ServiceClient,
  tripEventIds: string[]
): Promise<Set<string>> {
  if (tripEventIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('trip_reminder_deliveries')
    .select('trip_event_id, reminder_type')
    .in('trip_event_id', tripEventIds)
    .eq('status', 'sent');

  if (error) {
    console.error('reminder eligibility: delivery lookup failed:', error.message);
    return new Set(); // fail open here is safe: duplicate protection is
    // re-enforced at claim time by the unique constraint (§8) — worst
    // case is one redundant DB round trip per event, never a dupe send.
  }

  return new Set((data ?? []).map((d) => `${d.trip_event_id}:${d.reminder_type}`));
}

/** The cron sweep's main query: every R1/R2 reminder due right now. */
export async function getEligibleReminders(now: Date = new Date()): Promise<EligibleReminder[]> {
  const supabase = createServiceClient();

  const rows = await fetchCandidateRows(supabase, now);
  const usableRows = rows.filter((r) => tripIsUsable(r.trips));
  const alreadySent = await fetchAlreadySentTypes(
    supabase,
    usableRows.map((r) => r.id)
  );

  const eligible: EligibleReminder[] = [];

  for (const row of usableRows) {
    const eventStart = eventStartInBangkok(row.event_date, row.start_time);
    if (!eventStart) continue; // no clock time -> R1/R2 don't apply

    for (const type of ['r1_24h', 'r2_1h'] as const) {
      if (alreadySent.has(`${row.id}:${type}`)) continue;
      if (now >= eventStart) continue; // event already started — never useful (§10)

      const triggerTime = new Date(eventStart.getTime() - LEAD_MS[type]);
      const windowEnd = new Date(triggerTime.getTime() + GRACE_MINUTES[type] * 60 * 1000);

      if (now < triggerTime) continue; // not due yet
      if (now >= windowEnd) continue; // window lapsed — skip, never send late (§10)

      eligible.push(toEligibleReminder(row, type));
    }
  }

  return eligible;
}

/** Shared by the R3 (event-confirmed) hook — fetches and validates a
 *  single trip_event the same way the sweep validates its candidates,
 *  so "usable trip" means the same thing on both paths. Returns null if
 *  the event/trip isn't reminder-eligible right now (brief §7/§11). */
export async function fetchReminderRowForEvent(
  tripEventId: string
): Promise<EligibleReminder | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('trip_events')
    .select(EVENT_SELECT)
    .eq('id', tripEventId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as RawEventRow;
  if (row.status === 'cancelled') return null;
  if (!tripIsUsable(row.trips)) return null;

  return toEligibleReminder(row, 'r3_confirmed');
}
