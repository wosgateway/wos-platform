'use client';

// src/app/[locale]/partner-trip/[token]/page.tsx
//
// Partner — read-only view of the trip_events this partner is
// responsible for, via a partner-scoped link
// (088_trip_partner_links.sql). No login, matching the trust model of
// the WhatsApp/LINE link itself — same pattern as
// my-trip/token/[token]/page.tsx for customers.
//
// Backend: GET /api/partner-trip/[token] -> resolvePartnerTripToken()
// does the exists -> revoked -> expired check, THEN filters
// trip_events by trip_id AND partner_id from the resolved link. This
// page only ever renders what that route returns — it never has (and
// must never request) any other partner's events, `notes`, or a
// customer join. See route.ts and resolve-partner-trip-token.ts for
// why those are excluded.
//
// Deliberately a separate page from my-trip/token/[token] — different
// API route, different response shape (no trip_participants, no
// notes, no partners.name — irrelevant once already partner-scoped),
// and a different header (no customer-name greeting, since this
// token doesn't resolve to a named person).
//
// i18n: same pattern as my-trip/token/[token]/page.tsx — useTranslations
// + useLocale + next-intl router.replace switcher. New strings live
// under the "partnerTripJourney" namespace in src/messages/{th,lo,en}.json.

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  Car,
  Building2,
  HeartPulse,
  Sparkles,
  UtensilsCrossed,
  ShoppingBag,
  Compass,
  Star,
  Calendar,
  MapPin,
  Phone,
  User,
} from 'lucide-react';

type Locale = 'th' | 'lo' | 'en';
const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'th', label: 'ไทย' },
  { value: 'lo', label: 'ລາວ' },
  { value: 'en', label: 'English' },
];

type TripStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
type EventType = 'transport' | 'hotel' | 'health' | 'wellness' | 'dining' | 'shopping' | 'tour' | 'experience' | 'other';
type EventStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

interface TransportAssignment {
  vehicle: string | null;
  pickup_location: string;
  dropoff_location: string;
  pickup_time: string;
  dropoff_time_estimated: string | null;
  status: string;
  driver_name: string | null;
  driver_phone: string | null;
}

// Matches the exact select() in /api/partner-trip/[token]/route.ts —
// no `notes`, no `partners` embed (already scoped to one partner).
interface PartnerTripEvent {
  id: string;
  event_type: EventType;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  status: EventStatus;
  contact_name: string | null;
  contact_phone: string | null;
  sort_order: number | null;
  transport_assignments: TransportAssignment | null;
}

// Matches trips select() in the same route — no origin, no
// trip_participants (this link was never scoped to a named customer).
interface PartnerTrip {
  trip_number: string;
  start_date: string;
  end_date: string;
  destination: string | null;
  status: TripStatus;
}

const EVENT_TYPE_ICON: Record<EventType, React.ElementType> = {
  transport: Car,
  hotel: Building2,
  health: HeartPulse,
  wellness: Sparkles,
  dining: UtensilsCrossed,
  shopping: ShoppingBag,
  tour: Compass,
  experience: Star,
  other: Calendar,
};

const STATUS_PILL: Record<TripStatus, string> = {
  planned: 'bg-sky-100 text-sky-700',
  in_progress: 'bg-primary/15 text-primary-dark',
  completed: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-rose-100 text-rose-700',
};
const EVENT_STATUS_PILL: Record<EventStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-sky-100 text-sky-700',
  in_progress: 'bg-primary/15 text-primary-dark',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-700',
};

function formatShortDate(d: string, locale: string) {
  return new Date(d).toLocaleDateString(locale === 'th' ? 'th-TH' : locale === 'lo' ? 'lo-LA' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
function formatDateHeading(d: string, locale: string) {
  return new Date(d).toLocaleDateString(locale === 'th' ? 'th-TH' : locale === 'lo' ? 'lo-LA' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}
function formatTime(t: string | null) {
  if (!t) return null;
  return t.slice(0, 5);
}

// B2 — mirrors PARTNER_ALLOWED_TRANSITIONS in
// /api/partner-trip/[token]/events/[eventId]/status/route.ts. This is
// UI convenience only (which single action button to show, and its
// label) — the route re-checks the transition server-side regardless,
// so this map going stale would just show/hide a button, never grant
// an unauthorized write.
const PARTNER_NEXT_STATUS: Partial<Record<EventStatus, { next: EventStatus; labelKey: string }>> = {
  pending: { next: 'confirmed', labelKey: 'statusAction.markConfirmed' },
  confirmed: { next: 'in_progress', labelKey: 'statusAction.markInProgress' },
  in_progress: { next: 'completed', labelKey: 'statusAction.markCompleted' },
};

export default function PartnerTripPage() {
  const params = useParams();
  const token = params?.token as string;
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('partnerTripJourney');

  const [trip, setTrip] = useState<PartnerTrip | null>(null);
  const [events, setEvents] = useState<PartnerTripEvent[]>([]);
  const [errorKind, setErrorKind] = useState<'not_found' | 'link_revoked' | 'link_expired' | 'unknown' | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updateErrorId, setUpdateErrorId] = useState<string | null>(null);

  // B2 — optimistic-on-success status update. Server is still the
  // source of truth: on a 4xx (invalid transition / not this
  // partner's event) we roll back and surface statusAction.updateFailed
  // rather than trusting the click.
  const updateStatus = useCallback(
    async (eventId: string, nextStatus: EventStatus) => {
      setUpdatingId(eventId);
      setUpdateErrorId(null);
      try {
        const res = await fetch(
          `/api/partner-trip/${encodeURIComponent(token)}/events/${encodeURIComponent(eventId)}/status`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus }),
          }
        );
        if (!res.ok) {
          setUpdateErrorId(eventId);
          return;
        }
        setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, status: nextStatus } : e)));
      } catch {
        setUpdateErrorId(eventId);
      } finally {
        setUpdatingId(null);
      }
    },
    [token]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/partner-trip/${encodeURIComponent(token)}`, { cache: 'no-store' });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        const kind = result?.error;
        setErrorKind(kind === 'link_revoked' || kind === 'link_expired' || kind === 'not_found' ? kind : 'unknown');
        setTrip(null);
        setEvents([]);
        return;
      }
      setErrorKind(null);
      setTrip(result.trip);
      setEvents(result.events ?? []);
    } catch {
      setErrorKind('unknown');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  function switchLocale(next: Locale) {
    if (next === locale) return;
    router.replace(pathname, { locale: next });
  }

  const localeSwitcher = (
    <div className="flex gap-1 rounded-full border border-slate-200 bg-white p-1">
      {LOCALE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => switchLocale(opt.value)}
          className={`flex min-h-[44px] items-center rounded-full px-3 text-xs font-medium transition-colors ${
            locale === opt.value ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-100" />
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (errorKind) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6 text-center">
        <div className="flex justify-end">{localeSwitcher}</div>
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
          <p className="text-3xl">{errorKind === 'link_expired' ? '⏰' : errorKind === 'link_revoked' ? '🔒' : '🔍'}</p>
          <p className="mt-3 text-sm text-slate-600">{t(`error.${errorKind}`)}</p>
        </div>
        <a
          href="https://wa.me/66864522644"
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-xl border border-emerald-200 bg-emerald-50 py-3 text-center text-sm font-semibold text-emerald-700"
        >
          {t('whatsappCta')}
        </a>
      </div>
    );
  }

  if (!trip) return null;

  const groupedEvents = (() => {
    const groups = new Map<string, PartnerTripEvent[]>();
    for (const ev of events) {
      if (!groups.has(ev.event_date)) groups.set(ev.event_date, []);
      groups.get(ev.event_date)!.push(ev);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  })();

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <div className="flex justify-end">{localeSwitcher}</div>

      {/* Trip header — no customer name/greeting: this link was never
          scoped to a named person, only to (trip, partner). */}
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <p className="text-xs text-slate-400">{trip.trip_number}</p>
        <h1 className="mt-0.5 text-lg font-bold text-slate-900">{t('heading')}</h1>
        <div className="mt-3 flex items-center justify-between">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_PILL[trip.status]}`}>
            {t(`tripStatus.${trip.status}`)}
          </span>
          <span className="text-xs text-slate-400">
            {formatShortDate(trip.start_date, locale)} – {formatShortDate(trip.end_date, locale)}
          </span>
        </div>
        {trip.destination ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
            <span>{trip.destination}</span>
          </div>
        ) : null}
      </div>

      {/* Timeline — this partner's events only (server-side filtered
          by trip_id AND partner_id; nothing to re-filter here). */}
      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 p-5 pb-3 text-sm font-bold text-slate-700">{t('scheduleHeading')}</h2>
        {groupedEvents.length === 0 ? (
          <p className="p-5 text-center text-sm text-slate-400">{t('noEventsYet')}</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {groupedEvents.map(([date, dayEvents]) => (
              <div key={date} className="p-5">
                <div className="mb-3 text-xs font-medium text-slate-400">{formatDateHeading(date, locale)}</div>
                <div className="space-y-3">
                  {dayEvents
                    .slice()
                    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    .map((ev, idx) => {
                      const Icon = EVENT_TYPE_ICON[ev.event_type];
                      const transport = ev.transport_assignments ?? null;
                      return (
                        <div key={idx} className="flex gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-dark">
                            <Icon className="h-4.5 w-4.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-semibold text-slate-900">{ev.title}</span>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${EVENT_STATUS_PILL[ev.status]}`}>
                                {t(`eventStatus.${ev.status}`)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                              {ev.start_time ? (
                                <span>
                                  {formatTime(ev.start_time)}
                                  {ev.end_time ? `–${formatTime(ev.end_time)}` : ''}
                                </span>
                              ) : null}
                              {ev.location ? <span className="truncate">{ev.location}</span> : null}
                            </div>
                            {transport ? (
                              <div className="mt-2 space-y-1 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                                <div className="flex items-center gap-1.5">
                                  <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                  <span>
                                    {transport.pickup_location} → {transport.dropoff_location}
                                  </span>
                                </div>
                                {transport.driver_name ? (
                                  <div className="flex items-center gap-1.5">
                                    <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                    <span>{transport.driver_name}{transport.vehicle ? ` · ${transport.vehicle}` : ''}</span>
                                  </div>
                                ) : null}
                                {transport.driver_phone ? (
                                  <div className="flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                    <span>{transport.driver_phone}</span>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            {/* Per-event contact — the minimum contact info this
                                partner needs, per route.ts's comment. No `notes`:
                                that column is deliberately excluded server-side.
                                Always shown when present, transport events included:
                                this is whatever contact_name/contact_phone the admin
                                entered on the event (typically the customer's own
                                number), not the driver's — separate from
                                transport.driver_name/driver_phone above (which is
                                the driver assigned BY this partner, shown back to
                                them for confirmation). Labelled only when the
                                driver block is also present, to keep the two
                                numbers from being confused. Whether the number is
                                actually reachable while the customer is still in
                                Laos depends on what was entered — the field itself
                                doesn't distinguish Thai vs Lao numbers. */}
                            {(ev.contact_name || ev.contact_phone) ? (
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                                {transport ? (
                                  <span className="w-full text-[10px] font-medium uppercase tracking-wide text-slate-400">
                                    {t('customerContact')}
                                  </span>
                                ) : null}
                                {ev.contact_name ? (
                                  <span className="flex items-center gap-1">
                                    <User className="h-3 w-3" />
                                    {ev.contact_name}
                                  </span>
                                ) : null}
                                {ev.contact_phone ? (
                                  <span className="flex items-center gap-1">
                                    <Phone className="h-3 w-3" />
                                    {ev.contact_phone}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                            {(() => {
                              const action = PARTNER_NEXT_STATUS[ev.status];
                              if (!action) return null;
                              const isUpdating = updatingId === ev.id;
                              return (
                                <div className="mt-2">
                                  <button
                                    type="button"
                                    disabled={isUpdating}
                                    onClick={() => updateStatus(ev.id, action.next)}
                                    className="flex min-h-[44px] items-center rounded-lg bg-primary px-3 text-[11px] font-semibold text-white disabled:opacity-50"
                                  >
                                    {isUpdating ? t('statusAction.updating') : t(action.labelKey)}
                                  </button>
                                  {updateErrorId === ev.id ? (
                                    <p className="mt-1 text-[11px] text-rose-600">{t('statusAction.updateFailed')}</p>
                                  ) : null}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <a
        href="https://wa.me/66864522644"
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full rounded-xl border border-emerald-200 bg-emerald-50 py-3 text-center text-sm font-semibold text-emerald-700"
      >
        {t('whatsappCta')}
      </a>

      <p className="text-center text-xs text-slate-400">{t('contactLine')}</p>
    </div>
  );
}
