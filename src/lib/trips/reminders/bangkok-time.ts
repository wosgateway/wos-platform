// src/lib/trips/reminders/bangkok-time.ts
//
// Brief §9 (Timing / Timezone): "WOS ต้องใช้ timezone ของ Journey/Event
// อย่างถูกต้อง — Asia/Bangkok — ห้ามคำนวณ Reminder ด้วย UTC แบบ hardcoded
// โดยไม่ convert timezone."
//
// WHY A FIXED "+07:00" OFFSET INSTEAD OF A FULL IANA TZ LIBRARY:
// Thailand (Asia/Bangkok) and Laos (Asia/Vientiane) — the only two
// countries WOS operates in — have both used a fixed UTC+7 offset with
// no daylight-saving transitions for decades, and neither has any
// scheduled DST changes. A literal "+07:00" suffix on the event's local
// date/time is therefore not a shortcut that happens to work today; it
// is the correct, stable conversion for this product's actual operating
// countries, with no historical-rule or future-rule edge case to break.
// This is a real timezone conversion (event local time -> UTC instant),
// just one that doesn't need a tz database because the offset never
// moves. If WOS ever expands reminders to a DST-observing country,
// replace this with a real IANA-aware library (e.g. date-fns-tz) —
// do not just edit the offset string.

const BANGKOK_UTC_OFFSET = '+07:00';

/**
 * Converts a trip_event's (event_date, start_time) — both stored as
 * timezone-naive Postgres `date`/`time` columns representing Bangkok
 * wall-clock time — into an absolute UTC instant.
 *
 * Returns null when start_time is absent (e.g. a hotel event that only
 * has a check-in date, per migration 084's header comment) — such
 * events have no meaningful "N hours before" instant, so R1/R2 do not
 * apply to them (brief §4/§9 implicitly assume a clock time exists).
 */
export function eventStartInBangkok(eventDate: string, startTime: string | null): Date | null {
  if (!startTime) return null;

  // Postgres `time` values arrive as 'HH:MM:SS' (or 'HH:MM:SS.ffffff');
  // truncate to whole seconds, which is all a reminder trigger needs.
  const hhmmss = startTime.slice(0, 8);

  const instant = new Date(`${eventDate}T${hhmmss}${BANGKOK_UTC_OFFSET}`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** Formats a Bangkok wall-clock HH:MM for use in reminder message bodies. */
export function formatBangkokTime(startTime: string | null): string {
  if (!startTime) return '';
  return startTime.slice(0, 5); // 'HH:MM:SS' -> 'HH:MM'
}
