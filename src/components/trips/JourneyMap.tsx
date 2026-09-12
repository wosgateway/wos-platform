'use client';

// src/components/trips/JourneyMap.tsx
//
// Phase 3, Level 1 (MVP) — per the brief's §4/§5: WOS's job here is
// "จัดลำดับ Journey → ส่งลูกค้าเข้าสู่ Google Maps", not building a
// WOS-owned interactive map. So this renders an ordered stop list
// (with completed/current/next state, §11) rather than an embedded
// map widget — PartnerLocationMap.tsx's Mapbox-based map is a
// separate, unrelated feature (public partner detail page) and isn't
// reused here.
//
// Deliberately has no opinion about *which* events became points —
// that's getMapPoints()'s job (src/lib/trips/routes/journey-points.ts).
// This component just renders whatever MapPoint[] it's given.

import { MapPin, Navigation } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MapPoint } from '@/lib/trips/routes/types';
import { buildPointUrl, buildRouteUrl } from '@/lib/trips/routes/google-maps';
import { buildRouteSummary } from '@/lib/trips/routes/route-builder';

function dotClassName(status: MapPoint['status']): string {
  switch (status) {
    case 'completed':
      return 'border-emerald-500 bg-emerald-500';
    case 'in_progress':
      return 'border-primary bg-primary';
    case 'cancelled':
      return 'border-slate-200 bg-slate-100';
    default:
      return 'border-slate-300 bg-white';
  }
}

export function JourneyMap({ points }: { points: MapPoint[] }) {
  const t = useTranslations('tripJourney.journeyMap');

  // §21 DoD — "Location ไม่มี → ไม่ทำให้หน้า crash": an empty point
  // list (every event lacked a location) just means no section here.
  if (points.length === 0) return null;

  const summary = buildRouteSummary(points);
  const routeUrl = buildRouteUrl(points);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 p-5 pb-3">
        <h2 className="text-sm font-bold text-slate-700">{t('heading')}</h2>
        <span className="text-xs text-slate-400">
          {t('stopCount', { count: summary.stopCount })}
        </span>
      </div>

      <ol className="p-5">
        {points.map((point, idx) => {
          const pointUrl = buildPointUrl(point);
          const isLast = idx === points.length - 1;
          return (
            <li key={point.key} className="relative flex gap-3 pb-6 last:pb-0">
              {!isLast ? (
                <span
                  className="absolute left-[6px] top-4 h-full w-px bg-slate-200"
                  aria-hidden="true"
                />
              ) : null}
              <span
                className={`relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${dotClassName(point.status)}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-slate-800">
                    {point.subLabel === 'pickup' ? `🚐 ${t('pickup')} · ` : null}
                    {point.subLabel === 'dropoff' ? `🚐 ${t('dropoff')} · ` : null}
                    {point.label}
                  </p>
                  {pointUrl ? (
                    <a
                      href={pointUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[44px] shrink-0 items-center gap-1 text-[11px] font-semibold text-primary"
                    >
                      <MapPin className="h-3 w-3" />
                      {t('open')}
                    </a>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {routeUrl ? (
        <div className="border-t border-slate-100 p-5 pt-3">
          <a
            href={routeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white"
          >
            <Navigation className="h-4 w-4" />
            {t('openFullRoute')}
          </a>
        </div>
      ) : null}
    </div>
  );
}
