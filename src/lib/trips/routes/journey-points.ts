// src/lib/trips/routes/journey-points.ts
//
// Turns the trip_events the API already returns into the ordered set
// of Journey Map stops (§7/§8/§9 of the Phase 3 brief). No new schema,
// no new booking data — this is a pure derived view over
// trip_events/partners/transport_assignments (§18: "Route เป็น Derived
// View ไม่ใช่ Source of Truth").

import type { JourneyEventInput, JourneyPartner, MapPoint, ResolvedLocation } from './types';
import { sortJourneyEvents } from './route-builder';

// §7 — a partner's lat/lng is only trusted once location_status =
// 'verified', same rule PartnerLocationMap.tsx already enforces for
// the public partner map. An unverified coordinate falls back to text
// exactly like a partner with no coordinates at all.
function verifiedPartnerCoords(partner: JourneyPartner | null): { latitude: number; longitude: number } | null {
  if (!partner || partner.location_status !== 'verified') return null;
  if (partner.latitude == null || partner.longitude == null) return null;
  return { latitude: partner.latitude, longitude: partner.longitude };
}

// §7 resolution order for a non-transport event: verified coordinate
// → partner address → event.location. Returns null when none of the
// three exist, meaning this event has no resolvable location at all.
export function resolveEventLocation(event: JourneyEventInput): ResolvedLocation | null {
  const coords = verifiedPartnerCoords(event.partners);
  const fallbackText = event.partners?.address?.trim() || event.location?.trim() || null;

  if (!coords && !fallbackText) return null;
  return {
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    searchText: fallbackText,
  };
}

// §8 Route Rules + §9 Transport Event. Sorts events into Journey
// order first (sortJourneyEvents), then maps each to zero, one, or
// two MapPoints:
//   - transport event with an assignment  -> pickup point + dropoff
//     point (both free-text; transport_assignments has no lat/lng)
//   - any other event with a resolvable location -> one point
//   - anything else (no location at all, e.g. payment/confirmation-
//     style events) -> excluded, per §8
export function getMapPoints(events: JourneyEventInput[]): MapPoint[] {
  const sorted = sortJourneyEvents(events);
  const points: MapPoint[] = [];

  sorted.forEach((event, eventIndex) => {
    if (event.event_type === 'transport' && event.transport_assignments) {
      const { pickup_location, dropoff_location } = event.transport_assignments;
      if (pickup_location?.trim()) {
        points.push({
          key: `${eventIndex}-pickup`,
          eventIndex,
          label: pickup_location.trim(),
          subLabel: 'pickup',
          eventType: event.event_type,
          status: event.status,
          latitude: null,
          longitude: null,
          searchText: pickup_location.trim(),
        });
      }
      if (dropoff_location?.trim()) {
        points.push({
          key: `${eventIndex}-dropoff`,
          eventIndex,
          label: dropoff_location.trim(),
          subLabel: 'dropoff',
          eventType: event.event_type,
          status: event.status,
          latitude: null,
          longitude: null,
          searchText: dropoff_location.trim(),
        });
      }
      return;
    }

    const resolved = resolveEventLocation(event);
    if (!resolved) return; // §8 — no location, no map point

    points.push({
      key: `${eventIndex}`,
      eventIndex,
      label: event.partners?.name || event.title,
      subLabel: null,
      eventType: event.event_type,
      status: event.status,
      ...resolved,
    });
  });

  return points;
}
