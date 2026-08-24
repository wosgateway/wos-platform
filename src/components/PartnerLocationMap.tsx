'use client';

// src/components/PartnerLocationMap.tsx
//
// Medical Logistics Map — public partner-detail section (Phase 4).
//
// Rendering rules the caller (partners/[id]/page.tsx) must follow:
// only mount this component when the partner has BOTH a coordinate
// pair AND location_status === 'verified'. This component itself
// assumes that's already true — it does not re-check location_status,
// so passing an unverified partner here would show it on the public
// map, which is exactly what the verify workflow (Phase 3) exists to
// prevent. If NEXT_PUBLIC_MAPBOX_TOKEN isn't configured, this
// component quietly renders nothing rather than a broken map.
//
// Two lazy-load layers, deliberately kept separate:
//   1. IntersectionObserver — don't touch the network or the Mapbox
//      bundle at all until this section actually scrolls into view.
//   2. Dynamic import of `mapbox-gl` — keeps the ~200kb library out of
//      the partner-detail page's main JS chunk regardless of whether
//      the visitor ever scrolls far enough to trigger (1).
//
// nearby_partners()/nearby_transit_points() (migration 047) return
// id + name + distance_meters only — no coordinates, by design (see
// 047's comments on why). To actually plot pins for the results, this
// component does a second, ordinary `.select()` against `partners` /
// `transit_points` for just those ids, which is safe because both
// tables already have a public-read RLS policy scoped to
// active/verified rows (045, 046) — no new access is being opened up
// here, just reading columns the RPC didn't need to return.

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import 'mapbox-gl/dist/mapbox-gl.css';
import type mapboxgl from 'mapbox-gl';

type NearbyMode = 'hotels' | 'transit';

interface NearbyPartnerRow {
  id: string;
  name: string;
  category: string;
  distance_meters: number;
}

interface NearbyTransitRow {
  id: string;
  name_th: string;
  name_en: string;
  name_lo: string;
  type: 'border_crossing' | 'airport';
  distance_meters: number;
}

interface NearbyResultItem {
  id: string;
  label: string;
  distanceMeters: number;
  latitude: number;
  longitude: number;
  icon: string;
}

// Mapbox's default style ships a lot of generic POI clutter (cafes,
// shops, etc.) that has nothing to do with this partner. Hiding any
// layer whose id mentions "poi" keeps the map focused on the pin +
// whatever the visitor explicitly toggles on.
function hidePoiLayers(map: mapboxgl.Map) {
  const style = map.getStyle();
  style?.layers?.forEach((layer) => {
    if (layer.id.toLowerCase().includes('poi')) {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  });
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function PartnerLocationMap({
  partnerId,
  latitude,
  longitude,
  name,
}: {
  partnerId: string;
  latitude: number;
  longitude: number;
  name: string;
}) {
  const t = useTranslations('partnerMap');
  const locale = useLocale();

  const sectionRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapboxglRef = useRef<typeof mapboxgl | null>(null);
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const nearbyMarkersRef = useRef<mapboxgl.Marker[]>([]);

  const [isVisible, setIsVisible] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mode, setMode] = useState<NearbyMode | null>(null);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [results, setResults] = useState<NearbyResultItem[]>([]);

  const hasToken = !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // --- Layer 1: only mount the map once scrolled near viewport ---
  useEffect(() => {
    if (!hasToken || !sectionRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, [hasToken]);

  // --- Layer 2: dynamic-import mapbox-gl + initialize once visible ---
  useEffect(() => {
    if (!isVisible || !mapContainerRef.current || mapRef.current) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;

    let cancelled = false;

    (async () => {
      const mod = await import('mapbox-gl');
      const mapboxgl = mod.default;
      if (cancelled || !mapContainerRef.current) return;

      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [longitude, latitude],
        zoom: 14,
        cooperativeGestures: true,
      });

      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => hidePoiLayers(map));

      originMarkerRef.current = new mapboxgl.Marker({ color: '#0f766e' })
        .setLngLat([longitude, latitude])
        .setPopup(new mapboxgl.Popup({ offset: 24 }).setText(name))
        .addTo(map);

      mapboxglRef.current = mapboxgl;
      mapRef.current = map;
      setMapReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [isVisible, latitude, longitude, name]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  function clearNearbyMarkers() {
    nearbyMarkersRef.current.forEach((m) => m.remove());
    nearbyMarkersRef.current = [];
    setResults([]);
  }

  function plotResults(items: NearbyResultItem[]) {
    const map = mapRef.current;
    const mapboxgl = mapboxglRef.current;
    if (!map || !mapboxgl) return;

    const bounds = new mapboxgl.LngLatBounds();
    bounds.extend([longitude, latitude]);

    items.forEach((item) => {
      const marker = new mapboxgl.Marker({ color: '#f97316' })
        .setLngLat([item.longitude, item.latitude])
        .setPopup(
          new mapboxgl.Popup({ offset: 20 }).setText(`${item.icon} ${item.label} · ${formatDistance(item.distanceMeters)}`)
        )
        .addTo(map);
      nearbyMarkersRef.current.push(marker);
      bounds.extend([item.longitude, item.latitude]);
    });

    if (items.length > 0) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    }
    setResults(items);
  }

  async function handleToggle(nextMode: NearbyMode) {
    setNearbyError(null);

    if (mode === nextMode) {
      setMode(null);
      clearNearbyMarkers();
      return;
    }

    if (!mapReady) return;

    setMode(nextMode);
    setLoadingNearby(true);
    clearNearbyMarkers();

    const supabase = createClient();

    try {
      if (nextMode === 'hotels') {
        const { data, error } = await supabase.rpc('nearby_partners', { p_partner_id: partnerId });
        if (error) throw error;
        const rows = (data ?? []) as NearbyPartnerRow[];
        if (rows.length === 0) {
          setResults([]);
          return;
        }
        const ids = rows.map((r) => r.id);
        const { data: coords, error: coordsErr } = await supabase
          .from('partners')
          .select('id, latitude, longitude')
          .in('id', ids);
        if (coordsErr) throw coordsErr;
        const coordMap = new Map((coords ?? []).map((c) => [c.id, c]));
        const items: NearbyResultItem[] = rows
          .map((r) => {
            const c = coordMap.get(r.id);
            if (!c || c.latitude == null || c.longitude == null) return null;
            return {
              id: r.id,
              label: r.name,
              distanceMeters: r.distance_meters,
              latitude: c.latitude,
              longitude: c.longitude,
              icon: '🏨',
            };
          })
          .filter((x): x is NearbyResultItem => x !== null);
        plotResults(items);
      } else {
        const { data, error } = await supabase.rpc('nearby_transit_points', { p_partner_id: partnerId });
        if (error) throw error;
        const rows = (data ?? []) as NearbyTransitRow[];
        if (rows.length === 0) {
          setResults([]);
          return;
        }
        const ids = rows.map((r) => r.id);
        const { data: coords, error: coordsErr } = await supabase
          .from('transit_points')
          .select('id, latitude, longitude')
          .in('id', ids);
        if (coordsErr) throw coordsErr;
        const coordMap = new Map((coords ?? []).map((c) => [c.id, c]));
        const items: NearbyResultItem[] = rows
          .map((r) => {
            const c = coordMap.get(r.id);
            if (!c) return null;
            const label = locale === 'en' ? r.name_en : locale === 'lo' ? r.name_lo : r.name_th;
            return {
              id: r.id,
              label,
              distanceMeters: r.distance_meters,
              latitude: c.latitude,
              longitude: c.longitude,
              icon: r.type === 'airport' ? '✈️' : '🛂',
            };
          })
          .filter((x): x is NearbyResultItem => x !== null);
        plotResults(items);
      }
    } catch (e) {
      setNearbyError(e instanceof Error ? e.message : t('nearbyError'));
      setMode(null);
    } finally {
      setLoadingNearby(false);
    }
  }

  // No token configured at all — nothing to render, and nothing to
  // observe either (the effect above already no-ops on !hasToken).
  if (!hasToken) return null;

  return (
    <div ref={sectionRef} className="mt-8">
      <h2 className="mb-3 text-lg font-bold text-slate-900">{t('title')}</h2>

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleToggle('hotels')}
          disabled={!mapReady || loadingNearby}
          className={`rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
            mode === 'hotels'
              ? 'border-primary bg-primary-light text-primary-dark'
              : 'border-slate-200 text-slate-600'
          }`}
        >
          🏨 {t('nearbyHotels')}
        </button>
        <button
          type="button"
          onClick={() => handleToggle('transit')}
          disabled={!mapReady || loadingNearby}
          className={`rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
            mode === 'transit'
              ? 'border-primary bg-primary-light text-primary-dark'
              : 'border-slate-200 text-slate-600'
          }`}
        >
          🛂 {t('nearbyTransit')}
        </button>
        {loadingNearby ? <span className="self-center text-xs text-slate-400">{t('loading')}</span> : null}
      </div>

      {nearbyError ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {nearbyError}
        </div>
      ) : null}

      <div
        ref={mapContainerRef}
        className="h-72 w-full overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 sm:h-96"
      />

      {mode && !loadingNearby && results.length === 0 && !nearbyError ? (
        <p className="mt-2 text-xs text-slate-400">{t('noResults')}</p>
      ) : null}

      {results.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100">
          {results.map((item) => (
            <li key={item.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-slate-700">
                {item.icon} {item.label}
              </span>
              <span className="text-xs text-slate-400">{formatDistance(item.distanceMeters)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
