// src/lib/trips/routes/route-builder.ts

import type { JourneyEventInput, MapPoint, RouteSummary } from './types';

// Canonical Journey ordering: event_date, then start_time (an event
// with no time set doesn't jump ahead of a timed one on the same
// day — sorts last among that day's events), then sort_order as the
// final tiebreaker. This is the same key pickHeroEvent() in
// my-trip/token/[token]/page.tsx already sorts by — kept identical on
// purpose so "current/next" and "the route" never disagree about
// order. If that sort key ever changes, change both.
export function sortJourneyEvents<T extends JourneyEventInput>(events: T[]): T[] {
  return events.slice().sort((a, b) => {
    if (a.event_date !== b.event_date) return a.event_date.localeCompare(b.event_date);
    const at = a.start_time ?? '';
    const bt = b.start_time ?? '';
    if (at !== bt) return at.localeCompare(bt);
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
}

// §12 — "4 Stops / 3 Routes", no guessed travel time (Level 1 has no
// Google Routes API call to get a real duration from).
export function buildRouteSummary(points: MapPoint[]): RouteSummary {
  return {
    stopCount: points.length,
    routeCount: Math.max(points.length - 1, 0),
  };
}
