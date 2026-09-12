// src/lib/trips/routes/google-maps.ts
//
// Google Maps deep-link builders for the Journey Map (Phase 3, Level
// 1 — no Google Routes API, no key required; see brief §4/§5/§6).
//
// Before this file, the same "lat/lng first, text search fallback"
// idea existed twice, written independently and slightly differently:
//   - PartnerLocationMap.tsx's buildDirectionsUrl() — coordinate-only,
//     single destination.
//   - my-trip/token/[token]/page.tsx's googleMapsUrl() — text-only,
//     single destination.
// This module is the merged version both should call through, plus
// the new multi-stop case neither of them had. PartnerLocationMap.tsx
// is intentionally left as-is for this pass (targeted change, not a
// refactor of a working, unrelated feature) — only the my-trip journey
// page is wired to this module for now.

import type { ResolvedLocation } from './types';

function coordString(point: ResolvedLocation): string | null {
  if (point.latitude == null || point.longitude == null) return null;
  return `${point.latitude},${point.longitude}`;
}

// A single stop, coordinate preferred, free-text query as fallback.
// Returns null when neither is available (nothing to link to).
function stopQuery(point: ResolvedLocation): string | null {
  return coordString(point) ?? point.searchText?.trim() ?? null;
}

// One destination — same URL scheme as the old
// PartnerLocationMap.buildDirectionsUrl / page.tsx's googleMapsUrl,
// just coordinate-or-text instead of only one or the other.
export function buildPointUrl(point: ResolvedLocation): string | null {
  const query = stopQuery(point);
  if (!query) return null;
  const coords = coordString(point);
  // Coordinates go through the `destination` param directly (no
  // encoding needed, it's just digits/commas); free text is
  // URL-encoded and sent through the `search` endpoint instead of
  // `dir`, matching the old text-only behavior exactly.
  if (coords) {
    return `https://www.google.com/maps/dir/?api=1&destination=${coords}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

// Multiple stops in journey order. Google's `dir` URL takes an
// `origin`, a final `destination`, and up to 9 `|`-separated
// `waypoints` in between — coordinates and place text can be mixed
// freely in the same URL. Points with no resolvable location are
// skipped (§8 — they were never map points in the first place, but
// this stays defensive) rather than breaking the whole route.
export function buildRouteUrl(points: ResolvedLocation[]): string | null {
  const stops = points.map(stopQuery).filter((s): s is string => !!s);

  if (stops.length === 0) return null;
  if (stops.length === 1) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stops[0])}`;
  }

  const origin = stops[0];
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(1, -1).slice(0, 9); // documented Google Maps cap

  const params = new URLSearchParams({ api: '1', origin, destination });
  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
