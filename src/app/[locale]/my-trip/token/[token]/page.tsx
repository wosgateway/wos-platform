'use client';

// src/app/[locale]/my-trip/token/[token]/page.tsx
//
// Customer — My Trip via Secure Link. This is the page
// JourneyDetail.tsx's "copy link" button in admin has been building
// URLs for since the Journey Control Center shipped
// (PUBLIC_TRIP_PATH = '/th/my-trip/token') — until now those links
// 404'd. The backend side was already built and tested:
// GET /api/my-trip/[token] -> resolveTripByToken() does the
// exists -> revoked -> expired -> scope check and returns only
// customer-safe fields (no order_item_id, no admin notes). This page
// is a pure read-only render of that response — no login, no write
// actions, matching the trust model of the WhatsApp/LINE link itself.
//
// Distinct from /[locale]/my-trip/[orderNumber] (the older
// order-number + phone flow for payments/quotes) — that page is
// about a single order's payment status; this one is the multi-day
// itinerary view for the new trips/trip_events schema (migration
// 076). They can both exist for the same customer at once and don't
// share data.
//
// i18n: same pattern as my-trip/[orderNumber]/page.tsx — useTranslations
// + useLocale + next-intl router.replace switcher. New strings live
// under the "tripJourney" namespace in src/messages/{th,lo,en}.json.

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

interface TripEvent {
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
  notes: string | null;
  partners: { name: string } | null;
  // 1:1 with trip_events. trip_event_id has a UNIQUE constraint, so
  // PostgREST embeds this as a single object, not an array.
  transport_assignments: TransportAssignment | null;
}

interface TripParticipant {
  display_name: string | null;
  is_primary: boolean;
  customers: { full_name: string } | null;
}

interface Trip {
  trip_number: string;
  start_date: string;
  end_date: string;
  origin: string | null;
  destination: string | null;
  status: TripStatus;
  preferred_language: string;
  trip_participants: TripParticipant[];
  trip_events: TripEvent[];
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

export default function MyTripJourneyPage() {
  const params = useParams();
  const token = params?.token as string;
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('tripJourney');

  const [trip, setTrip] = useState<Trip | null>(null);
  const [errorKind, setErrorKind] = useState<'not_found' | 'link_revoked' | 'link_expired' | 'unknown' | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/my-trip/${encodeURIComponent(token)}`, { cache: 'no-store' });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        const kind = result?.error;
        setErrorKind(kind === 'link_revoked' || kind === 'link_expired' || kind === 'not_found' ? kind : 'unknown');
        setTrip(null);
        return;
      }
      setErrorKind(null);
      setTrip(result.trip);
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
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
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

  const primaryName =
    trip.trip_participants.find((p) => p.is_primary)?.customers?.full_name ?? null;
  const otherParticipants = trip.trip_participants.filter((p) => !p.is_primary);

  const groupedEvents = (() => {
    const groups = new Map<string, TripEvent[]>();
    for (const ev of trip.trip_events) {
      if (!groups.has(ev.event_date)) groups.set(ev.event_date, []);
      groups.get(ev.event_date)!.push(ev);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  })();

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <div className="flex justify-end">{localeSwitcher}</div>

      {/* Trip header */}
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <p className="text-xs text-slate-400">{trip.trip_number}</p>
        <h1 className="mt-0.5 text-lg font-bold text-slate-900">
          {primaryName ? t('greeting', { name: primaryName }) : t('greetingGeneric')}
        </h1>
        <div className="mt-3 flex items-center justify-between">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_PILL[trip.status]}`}>
            {t(`tripStatus.${trip.status}`)}
          </span>
          <span className="text-xs text-slate-400">
            {formatShortDate(trip.start_date, locale)} – {formatShortDate(trip.end_date, locale)}
          </span>
        </div>
        {(trip.origin || trip.destination) && (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
            <span>
              {trip.origin || '—'} → {trip.destination || '—'}
            </span>
          </div>
        )}
        {otherParticipants.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {otherParticipants.map((p, i) => (
              <span key={i} className="flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                <User className="h-3 w-3" />
                {p.display_name ?? t('companion')}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Timeline */}
      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 p-5 pb-3 text-sm font-bold text-slate-700">{t('itineraryHeading')}</h2>
        {groupedEvents.length === 0 ? (
          <p className="p-5 text-center text-sm text-slate-400">{t('noEventsYet')}</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {groupedEvents.map(([date, events]) => (
              <div key={date} className="p-5">
                <div className="mb-3 text-xs font-medium text-slate-400">{formatDateHeading(date, locale)}</div>
                <div className="space-y-3">
                  {events
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
                              {ev.partners?.name ? <span className="truncate">{ev.partners.name}</span> : null}
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
                            {(ev.contact_name || ev.contact_phone) && !transport ? (
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
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
                            {ev.notes ? <p className="mt-1 text-xs text-slate-400">{ev.notes}</p> : null}
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

      {/* WhatsApp CTA — same primary "need help" affordance as the
          order-number my-trip page. */}
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
