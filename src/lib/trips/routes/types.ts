// src/lib/trips/routes/types.ts
//
// Shared types for the Journey Map / Route Builder (Phase 3). These
// describe the *input* shape (a trip_event as returned by
// GET /api/my-trip/[token], with partners/transport_assignments
// embedded) and the *output* shape (a resolved MapPoint) that
// journey-points.ts derives from it.
//
// Kept separate from the page component's own TripEvent interface
// (my-trip/token/[token]/page.tsx) because the API response has a few
// more fields (partner coordinates) than the page needs to render the
// timeline — this is the superset the route builder actually reads.

export type EventStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

export type EventType =
  | 'transport'
  | 'hotel'
  | 'health'
  | 'wellness'
  | 'dining'
  | 'shopping'
  | 'tour'
  | 'experience'
  | 'other';

export type LocationStatus = 'pending' | 'verified' | 'rejected';

export interface JourneyPartner {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  location_status: LocationStatus | null;
}

export interface JourneyTransportAssignment {
  pickup_location: string;
  dropoff_location: string;
}

// The subset of a trip_event row the route builder needs. Extra
// fields the page also uses (notes, contact_name, etc.) are fine to
// pass through — this is a structural type, not exact.
export interface JourneyEventInput {
  event_type: EventType;
  title: string;
  event_date: string;
  start_time: string | null;
  sort_order: number | null;
  status: EventStatus;
  location: string | null;
  partners: JourneyPartner | null;
  transport_assignments: JourneyTransportAssignment | null;
}

// A resolved, orderable location — either a real coordinate pair or a
// text query to hand to Google Maps' search URL as a fallback.
export interface ResolvedLocation {
  latitude: number | null;
  longitude: number | null;
  searchText: string | null;
}

// One stop on the Journey Map. A transport event contributes two of
// these (pickup + dropoff, §9 of the Phase 3 brief); every other
// event type contributes at most one, and none at all if it has no
// resolvable location (§8).
export interface MapPoint extends ResolvedLocation {
  key: string;
  eventIndex: number;
  label: string;
  subLabel: 'pickup' | 'dropoff' | null;
  eventType: EventType;
  status: EventStatus;
}

export interface RouteSummary {
  stopCount: number;
  routeCount: number;
}
