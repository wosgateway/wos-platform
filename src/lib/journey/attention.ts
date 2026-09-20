// src/lib/journey/attention.ts
//
// Journey Control Center — Attention Engine (WOS Phase 4, Section 6).
//
// Pure, stateless derivation from data already returned by
// GET /api/trips/[tripId] plus trip_reminder_deliveries, which must be
// added to that route's select (not currently joined — see route.ts).
// Nothing here is persisted; ATTENTION_REQUIRED is always computed on read.
//
// Locked decisions (2026-09-12):
// - No migration for a 'planned' event status. trip.status === 'planned'
//   drives the journey-level PLANNED state; events only ever start 'pending'.
// - Computed in the application layer, not a DB view/function.
// - "Pending confirmation near event time" threshold = 24h
//   (PENDING_CONFIRMATION_HOURS), one-line change later.
//
// Review corrections applied (2026-09-12):
// - PENDING_CONFIRMATION requires 0 < hoursUntil <= 24 — an event whose
//   time already passed is no longer misfiled as "pending confirmation";
//   it now gets its own OVERDUE case instead (added in review round 2).
// - Bangkok-time math reuses eventStartInBangkok() from
//   src/lib/trips/reminders/bangkok-time.ts instead of a second, naive
//   `new Date(...)` parse that would break on a UTC runtime.
// - MISSING_CUSTOMER_CONTACT reuses primaryContactPhone() from
//   src/lib/trips/reminders/eligibility.ts (now exported) so this can never
//   disagree with the reminder engine about whether a trip has a contact.
// - findNextEvent() now excludes events with no resolvable datetime instead
//   of treating "no datetime" as "always upcoming".
// - TRANSPORT_INCOMPLETE's driver check now matches the DB constraint
//   (`transport_assignments_driver_identity`): driver_id OR driver_name
//   satisfies it, not driver_id alone. pickup_location/dropoff_location are
//   NOT NULL on that table, so they can only be "missing" when the
//   transport_assignments row doesn't exist at all — the check reflects that.
//
// Review round 2 (2026-09-12): added OVERDUE — a pending event whose time
// has already passed now gets its own case instead of silently producing
// no attention case at all. Checked before PENDING_CONFIRMATION so the two
// can never both fire for the same event (an event is either overdue or
// approaching, never both).
//
// Business rules confirmed (2026-09-12): PARTNER_REQUIRED_TYPES and
// TRAVEL_EVENT_TYPES below are both now locked, not guesses. Nothing left
// open in this file.

import { eventStartInBangkok } from '@/lib/trips/reminders/bangkok-time';
import { primaryContactPhone, type RawTripRow } from '@/lib/trips/reminders/eligibility';

export const PENDING_CONFIRMATION_HOURS = 24;

export type TripEventStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
export type TripStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type OverallStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ATTENTION_REQUIRED';

// Confirmed business rule (2026-09-12): transport, hotel, health, wellness
// need a partner or it's a real problem. dining/tour/experience/shopping/other
// do not — not a guess anymore.
// Confirmed business rule (2026-09-12): transport, health/clinic, and
// wellness/spa events need a location or it's a real problem — hotel,
// dining, tour, experience, shopping, other do not.
const TRAVEL_EVENT_TYPES = new Set(['transport', 'health', 'wellness']);
const PARTNER_REQUIRED_TYPES = new Set(['transport', 'hotel', 'health', 'wellness']);

export interface AttentionTransportAssignment {
  driver_id: string | null;
  driver_name: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
}

export interface AttentionTripEvent {
  id: string;
  event_type: string;
  title: string;
  event_date: string; // YYYY-MM-DD
  start_time: string | null; // 'HH:MM:SS' as returned by Postgres
  status: TripEventStatus;
  location: string | null;
  partner_id: string | null;
  order_item_id: string | null;
  // 1-to-1 with trip_events (transport_assignments.trip_event_id is
  // UNIQUE — see migration 076), so Supabase returns this embed as a
  // single object, never an array. Every other consumer of this same
  // nested field (JourneyDetail.tsx, the partner/customer trip pages,
  // journey-points.ts) already treats it this way — this file was the
  // one place still typed as an array. That mismatch meant the code
  // below always read `undefined` off an object via `?.[0]`, so
  // TRANSPORT_INCOMPLETE fired "missing driver, pickup, drop-off" for
  // every transport event regardless of whether it was actually filled
  // in (fixed alongside this type change).
  transport_assignments?: AttentionTransportAssignment | null;
}

export interface AttentionReminderDelivery {
  trip_event_id: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  reason?: string | null;
}

export interface AttentionTrip {
  id: string;
  status: TripStatus;
  trip_events: AttentionTripEvent[];
  // Same shape eligibility.ts's RawTripRow expects, so primaryContactPhone()
  // works unmodified — pass the trip_participants block straight through
  // from the GET /api/trips/[tripId] query.
  trip_participants: RawTripRow['trip_participants'];
}

export type AttentionCase =
  | { code: 'OVERDUE'; eventId: string; message: string }
  | { code: 'UNASSIGNED_PARTNER'; eventId: string; message: string }
  | { code: 'PENDING_CONFIRMATION'; eventId: string; message: string }
  | { code: 'FAILED_REMINDER'; eventId: string; message: string }
  | { code: 'MISSING_LOCATION'; eventId: string; message: string }
  | { code: 'MISSING_CUSTOMER_CONTACT'; eventId: null; message: string }
  | { code: 'TRANSPORT_INCOMPLETE'; eventId: string; message: string };

function isActiveEvent(ev: AttentionTripEvent): boolean {
  return ev.status !== 'cancelled' && ev.status !== 'completed';
}

/**
 * Computes every attention case for a single trip. Call once per trip —
 * list view can reuse it for the badge count, detail view renders the
 * message list directly.
 */
export function computeAttentionCases(
  trip: AttentionTrip,
  reminders: AttentionReminderDelivery[],
  now: Date = new Date()
): AttentionCase[] {
  const cases: AttentionCase[] = [];
  const remindersByEvent = new Map<string, AttentionReminderDelivery[]>();
  for (const r of reminders) {
    const list = remindersByEvent.get(r.trip_event_id) ?? [];
    list.push(r);
    remindersByEvent.set(r.trip_event_id, list);
  }

  // E. Missing customer contact — trip-level, only matters if there's an
  // active event that would need notifying. Same definition the reminder
  // engine uses, via primaryContactPhone().
  const hasActiveEvents = trip.trip_events.some(isActiveEvent);
  if (hasActiveEvents && !primaryContactPhone(trip as unknown as RawTripRow)) {
    cases.push({ code: 'MISSING_CUSTOMER_CONTACT', eventId: null, message: 'Customer contact missing' });
  }

  for (const ev of trip.trip_events) {
    if (!isActiveEvent(ev)) continue;

    // A. Unassigned partner
    if (PARTNER_REQUIRED_TYPES.has(ev.event_type) && !ev.partner_id) {
      cases.push({
        code: 'UNASSIGNED_PARTNER',
        eventId: ev.id,
        message: `${ev.title || ev.event_type}: partner not assigned`,
      });
    }

    // B. Overdue / pending confirmation. An overdue event (time already
    // passed, still pending) and a near-term pending event are mutually
    // exclusive by construction — hoursUntil is either <= 0 or > 0, never
    // both branches.
    if (ev.status === 'pending') {
      const dt = eventStartInBangkok(ev.event_date, ev.start_time);
      if (dt) {
        const hoursUntil = (dt.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursUntil <= 0) {
          cases.push({
            code: 'OVERDUE',
            eventId: ev.id,
            message: `${ev.title || ev.event_type}: event time passed but still pending`,
          });
        } else if (hoursUntil <= PENDING_CONFIRMATION_HOURS) {
          cases.push({
            code: 'PENDING_CONFIRMATION',
            eventId: ev.id,
            message: `${ev.title || ev.event_type}: not confirmed`,
          });
        }
      }
    }

    // C. Failed reminder
    const eventReminders = remindersByEvent.get(ev.id) ?? [];
    if (eventReminders.some((r) => r.status === 'failed')) {
      cases.push({
        code: 'FAILED_REMINDER',
        eventId: ev.id,
        message: `${ev.title || ev.event_type}: customer reminder failed`,
      });
    }

    // D. Missing location (travel-type events only)
    if (TRAVEL_EVENT_TYPES.has(ev.event_type) && !ev.location) {
      cases.push({
        code: 'MISSING_LOCATION',
        eventId: ev.id,
        message: `${ev.title || ev.event_type}: pickup location missing`,
      });
    }

    // F. Transport incomplete. pickup_location/dropoff_location are NOT
    // NULL on transport_assignments, so they can only be "missing" when
    // there's no assignment row at all. Driver identity is satisfied by
    // EITHER driver_id or driver_name (matches the DB check constraint) —
    // don't flag a driver as missing just because driver_id is null.
    if (ev.event_type === 'transport') {
      const assignment = ev.transport_assignments ?? null;
      const missing: string[] = [];
      if (!ev.partner_id) missing.push('partner'); // already covered by case A, filtered below
      if (!assignment) {
        missing.push('driver', 'pickup', 'drop-off');
      } else if (!assignment.driver_id && !assignment.driver_name) {
        missing.push('driver');
      }
      const nonPartnerMissing = [...new Set(missing.filter((m) => m !== 'partner'))];
      if (nonPartnerMissing.length > 0) {
        cases.push({
          code: 'TRANSPORT_INCOMPLETE',
          eventId: ev.id,
          message: `${ev.title || ev.event_type}: missing ${nonPartnerMissing.join(', ')}`,
        });
      }
    }
  }

  return cases;
}

/**
 * Derives the journey-level overall status per Section 5. ATTENTION_REQUIRED
 * is a display-layer overlay on top of trip.status, not a replacement for it —
 * callers that need the raw trip.status too should read it separately.
 */
export function computeOverallStatus(trip: AttentionTrip, attentionCases: AttentionCase[]): OverallStatus {
  if (trip.status === 'cancelled') return 'CANCELLED';
  if (trip.status === 'completed') return 'COMPLETED';
  if (attentionCases.length > 0) return 'ATTENTION_REQUIRED';
  if (trip.status === 'in_progress') return 'IN_PROGRESS';
  return 'PLANNED';
}

export function computeJourneyProgress(trip: AttentionTrip): { completed: number; total: number } {
  const total = trip.trip_events.length;
  const completed = trip.trip_events.filter((e) => e.status === 'completed').length;
  return { completed, total };
}

export function findNextEvent(trip: AttentionTrip, now: Date = new Date()): AttentionTripEvent | null {
  const upcoming = trip.trip_events
    .filter(isActiveEvent)
    .map((e) => ({ e, dt: eventStartInBangkok(e.event_date, e.start_time) }))
    .filter((x): x is { e: AttentionTripEvent; dt: Date } => x.dt !== null && x.dt.getTime() >= now.getTime())
    .sort((a, b) => a.dt.getTime() - b.dt.getTime());
  return upcoming[0]?.e ?? null;
}
