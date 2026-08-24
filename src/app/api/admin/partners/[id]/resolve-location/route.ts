// src/app/api/admin/partners/[id]/resolve-location/route.ts
//
// Admin-only. Takes a Google Maps URL, resolves it through
// safe-url-fetch (SSRF-safe: allowlisted hosts only, DNS re-validated
// at every redirect hop, private/internal addresses always refused),
// extracts lat/lng from the final resolved URL, and stores the result
// on the partner row.
//
// Deliberately does NOT set location_status = 'verified' — a
// successful resolve only proves "this URL points somewhere with
// coordinates", not "this is definitely the right place". It always
// lands as 'pending' (the column default from migration 045) so an
// admin has to explicitly verify before nearby_partners()/
// nearby_transit_points() (047) will surface it on the public map.
//
// Auth follows the same pattern as every other admin route in this
// project (see /api/admin/payments/[id]/verify/route.ts):
// cookieCarrier + requireAdmin(cookieCarrier) + withRefreshedCookies
// on every response. Skipping this either leaves the endpoint publicly
// reachable or produces intermittent 401s once a token expires — both
// bugs that are easy to miss in testing and only show up later.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { withRefreshedCookies } from '@/lib/admin/with-refreshed-cookies';
import { createServiceClient } from '@/lib/supabase/service';
import { safeUrlFetch, SafeFetchError } from '@/lib/security/safe-url-fetch';
import { simpleRateLimit } from '@/lib/rate-limit';

// dns.lookup (used inside safeUrlFetch) requires the Node.js runtime.
export const runtime = 'nodejs';

/**
 * Tries a handful of known Google Maps URL coordinate patterns, most
 * precise first. `!3d..!4d..` is the exact pin marker Google embeds on
 * /maps/place/ URLs; `@lat,lng` is only the viewport center (present
 * on almost every maps URL, but can be a few hundred meters off the
 * actual pin); `q=`/`ll=` are older query-param forms.
 */
function parseLatLngFromUrl(url: URL): { latitude: number; longitude: number } | null {
  const full = url.toString();

  const patterns: RegExp[] = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/, // exact place pin
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/, // viewport center
  ];

  for (const pattern of patterns) {
    const match = full.match(pattern);
    if (match) {
      const latitude = parseFloat(match[1]);
      const longitude = parseFloat(match[2]);
      if (isFinite(latitude) && isFinite(longitude)) {
        return { latitude, longitude };
      }
    }
  }

  const q = url.searchParams.get('q') ?? url.searchParams.get('query');
  const ll = url.searchParams.get('ll');
  for (const candidate of [q, ll]) {
    if (!candidate) continue;
    const parts = candidate.split(',');
    if (parts.length === 2) {
      const latitude = parseFloat(parts[0]);
      const longitude = parseFloat(parts[1]);
      if (isFinite(latitude) && isFinite(longitude)) {
        return { latitude, longitude };
      }
    }
  }

  return null;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  // Used only as a place for Supabase to write a refreshed access/refresh
  // token pair into, via requireAdmin's setAll(). Never returned directly.
  const cookieCarrier = new NextResponse();

  const auth = await requireAdmin(cookieCarrier);
  if (!auth.authorized) {
    return withRefreshedCookies(
      NextResponse.json({ error: auth.message }, { status: auth.status }),
      cookieCarrier
    );
  }

  const partnerId = params.id;

  // Resolving means fetching an external URL server-side — rate limit
  // per admin so a stuck client or bulk-resolve script can't hammer
  // Google or burn through the fetch timeout budget.
  const rateLimit = simpleRateLimit(`resolve-location:${auth.user.id}`, 30, 60 * 60 * 1000);
  if (!rateLimit.allowed) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: 'Too many resolve requests — try again later.' },
        { status: 429 }
      ),
      cookieCarrier
    );
  }

  let body: { google_maps_url?: string };
  try {
    body = await request.json();
  } catch {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
      cookieCarrier
    );
  }

  const googleMapsUrl = body.google_maps_url?.trim();
  if (!googleMapsUrl) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'google_maps_url is required' }, { status: 400 }),
      cookieCarrier
    );
  }

  const supabase = createServiceClient();

  const { data: partner, error: fetchErr } = await supabase
    .from('partners')
    .select('id')
    .eq('id', partnerId)
    .single();

  if (fetchErr || !partner) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Partner not found' }, { status: 404 }),
      cookieCarrier
    );
  }

  let response: Response;
  try {
    response = await safeUrlFetch(googleMapsUrl);
  } catch (err) {
    if (err instanceof SafeFetchError) {
      return withRefreshedCookies(
        NextResponse.json({ error: `Could not resolve URL: ${err.message}` }, { status: 400 }),
        cookieCarrier
      );
    }
    throw err;
  }

  if (!response.ok) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: `Resolved URL returned HTTP ${response.status}` },
        { status: 502 }
      ),
      cookieCarrier
    );
  }

  const coords = parseLatLngFromUrl(new URL(response.url || googleMapsUrl));

  if (!coords) {
    return withRefreshedCookies(
      NextResponse.json(
        {
          error:
            'Resolved the URL but could not extract coordinates from it. Try pasting the URL from the address bar after opening the pin in Google Maps.',
        },
        { status: 422 }
      ),
      cookieCarrier
    );
  }

  const { latitude, longitude } = coords;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Extracted coordinates are out of range' }, { status: 422 }),
      cookieCarrier
    );
  }

  const { data: updated, error: updateErr } = await supabase
    .from('partners')
    .update({
      google_maps_url: googleMapsUrl,
      latitude,
      longitude,
      location_source: 'google_maps',
      location_status: 'pending',
      location_resolved_at: new Date().toISOString(),
    })
    .eq('id', partnerId)
    .select('id, latitude, longitude, location_status, location_resolved_at')
    .single();

  if (updateErr || !updated) {
    return withRefreshedCookies(
      NextResponse.json(
        { error: updateErr?.message ?? 'Failed to save resolved location' },
        { status: 500 }
      ),
      cookieCarrier
    );
  }

  return withRefreshedCookies(NextResponse.json({ success: true, partner: updated }), cookieCarrier);
}
