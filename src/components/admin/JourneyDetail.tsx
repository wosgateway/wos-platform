'use client';

// src/components/admin/JourneyDetail.tsx
//
// Admin — Journey Control Center (detail view). One trip: info card,
// secure link management (reissue/revoke — talks to
// /api/trips/[tripId]/token), and an iOS-Calendar-style event timeline
// (add/edit/status-transition/delete via /api/trips/[tripId]/events...).
//
// NOTE: the customer-facing page that actually renders at the secure
// link (/[locale]/my-trip/token/[token] or similar) hasn't been built
// yet — that's the next roadmap item ("Customer — My Trip via Secure
// Link"). The "copy link" button below builds the URL it WILL be at
// once that page ships; until then the link 404s on the customer side
// even though the API behind it already works (see trip-api-test.js).
// Swap PUBLIC_TRIP_PATH below if that page lands at a different path.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  ArrowLeft,
  Plus,
  Copy,
  RefreshCw,
  Ban,
  Calendar,
  MapPin,
  Phone,
  User,
  Car,
  Building2,
  HeartPulse,
  Sparkles,
  UtensilsCrossed,
  ShoppingBag,
  Compass,
  Star,
  X,
  Check,
  Trash2,
  Link2,
  PackagePlus,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

const PUBLIC_TRIP_PATH = '/th/my-trip/token'; // see note above — page not live yet

type TripStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
type EventType =
  | 'transport'
  | 'hotel'
  | 'health'
  | 'wellness'
  | 'dining'
  | 'shopping'
  | 'tour'
  | 'experience'
  | 'other';
type EventStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
type TransportStatus = 'pending' | 'confirmed' | 'driver_assigned' | 'picked_up' | 'dropped_off' | 'cancelled';

interface TransportAssignment {
  id: string;
  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle: string | null;
  pickup_location: string;
  dropoff_location: string;
  pickup_time: string;
  dropoff_time_estimated: string | null;
  status: TransportStatus;
  drivers: { id: string; name: string; phone: string | null; partner_id: string | null } | null;
}

interface Driver {
  id: string;
  partner_id: string | null;
  name: string;
  phone: string | null;
  status: 'active' | 'inactive';
}

interface TripEvent {
  id: string;
  event_type: EventType;
  title: string;
  event_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  status: EventStatus;
  partner_id: string | null;
  order_item_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  sort_order: number | null;
  notes: string | null;
  partners: { id: string; name: string } | null;
  // 1:1 with trip_events. trip_event_id has a UNIQUE constraint, so
  // PostgREST embeds this as a single object, not an array.
  transport_assignments: TransportAssignment | null;
}

interface Trip {
  id: string;
  trip_number: string;
  customer_id: string;
  start_date: string;
  end_date: string;
  origin: string | null;
  destination: string | null;
  status: TripStatus;
  requires_passport: boolean;
  requires_visa: boolean;
  border_notes: string | null;
  preferred_language: string;
  notes: string | null;
  access_token: string | null;
  token_revoked_at: string | null;
  token_expires_at: string | null;
  customers: { id: string; full_name: string; phone: string } | null;
  trip_participants: { id: string; customer_id: string | null; display_name: string | null; is_primary: boolean }[];
  trip_events: TripEvent[];
}

interface PartnerOption {
  id: string;
  name: string;
}

const STATUS_LABEL: Record<TripStatus, string> = {
  planned: 'วางแผน',
  in_progress: 'กำลังเดินทาง',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
};
const STATUS_PILL: Record<TripStatus, string> = {
  planned: 'bg-sky-100 text-sky-700',
  in_progress: 'bg-primary/15 text-primary-dark',
  completed: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-rose-100 text-rose-700',
};

const EVENT_TYPE_LABEL: Record<EventType, string> = {
  transport: 'การเดินทาง',
  hotel: 'ที่พัก',
  health: 'สุขภาพ',
  wellness: 'เวลเนส',
  dining: 'อาหาร',
  shopping: 'ช้อปปิ้ง',
  tour: 'ทัวร์',
  experience: 'กิจกรรม',
  other: 'อื่นๆ',
};
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

const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  pending: 'รอดำเนินการ',
  confirmed: 'ยืนยันแล้ว',
  in_progress: 'กำลังดำเนินการ',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
};
const EVENT_STATUS_PILL: Record<EventStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-sky-100 text-sky-700',
  in_progress: 'bg-primary/15 text-primary-dark',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-700',
};
const EVENT_STATUS_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  // Terminal states still allow reverting, so an accidental status change
  // (e.g. marking an event completed too early during testing/data entry)
  // can be corrected from the UI instead of requiring a direct DB edit.
  completed: ['in_progress'],
  cancelled: ['pending'],
};

const TRANSPORT_STATUS_LABEL: Record<TransportStatus, string> = {
  pending: 'รอดำเนินการ',
  confirmed: 'ยืนยันแล้ว',
  driver_assigned: 'มอบหมายคนขับแล้ว',
  picked_up: 'รับแล้ว',
  dropped_off: 'ส่งถึงแล้ว',
  cancelled: 'ยกเลิก',
};

// Bangkok-local <-> UTC-ISO conversions for the datetime-local inputs below.
// We work entirely in absolute ms so this is correct regardless of the
// admin's own browser timezone.
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const bkkMs = new Date(iso).getTime() + 7 * 60 * 60 * 1000;
  return new Date(bkkMs).toISOString().slice(0, 16);
}
function fromDatetimeLocal(local: string): string | null {
  if (!local) return null;
  return `${local}:00+07:00`;
}

// "YYYY-MM-DDTHH:MM" <-> separate date/time pieces, so pickup/dropoff can be
// entered as a plain date picker + a forced-24h time picker instead of one
// native datetime-local field (whose time portion renders AM/PM per the
// browser's own locale — see Time24Input below).
function splitLocal(value: string): { date: string; time: string } {
  if (!value) return { date: '', time: '' };
  const [date, time] = value.split('T');
  return { date: date ?? '', time: time ?? '' };
}
function joinLocal(date: string, time: string): string {
  if (!date || !time) return '';
  return `${date}T${time}`;
}
// Today's date (Bangkok-local), used as a fallback below.
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

// Native <input type="time"/"datetime-local"> render their picker (and typed
// value) in AM/PM or 24h depending on the browser/OS locale, not anything we
// control from the page — that's what was showing "08:13 AM" in the admin
// panel and inviting am/pm mix-ups. This is a plain HH/MM select pair instead,
// so the value is always 24h everywhere regardless of the admin's browser.
function Time24Input({
  value,
  onChange,
}: {
  value: string; // "HH:MM" or ""
  onChange: (v: string) => void;
}) {
  const [h, m] = value ? value.split(':') : ['', ''];
  return (
    <div className="flex items-center gap-1">
      <select
        value={h ?? ''}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}:${m || '00'}` : '')}
        className="form-input !w-[4.75rem] shrink-0 !px-2 text-center"
        aria-label="ชั่วโมง"
      >
        <option value="">--</option>
        {HOURS_24.map((hh) => (
          <option key={hh} value={hh}>
            {hh}
          </option>
        ))}
      </select>
      <span className="text-slate-400">:</span>
      <select
        value={m ?? ''}
        onChange={(e) => onChange(`${h || '00'}:${e.target.value || '00'}`)}
        className="form-input !w-[4.75rem] shrink-0 !px-2 text-center"
        disabled={!h}
        aria-label="นาที"
      >
        <option value="">--</option>
        {MINUTES_60.map((mm) => (
          <option key={mm} value={mm}>
            {mm}
          </option>
        ))}
      </select>
    </div>
  );
}

function formatDateHeading(d: string) {
  return new Date(d).toLocaleDateString('th-TH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}
function formatShortDate(d: string) {
  return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatTime(t: string | null) {
  if (!t) return null;
  return t.slice(0, 5);
}

export function JourneyDetail({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [showEditTrip, setShowEditTrip] = useState(false);
  const [eventModal, setEventModal] = useState<{ mode: 'create' } | { mode: 'edit'; event: TripEvent } | null>(
    null
  );
  const [showImportSheet, setShowImportSheet] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}`, { cache: 'no-store' });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'failed to load');
      setTrip(result.trip);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    }
  }

  useEffect(() => {
    load();
    // partners list — RLS allows authenticated admin read directly (same
    // pattern as PartnersManager.tsx), so no dedicated API route needed.
    const supabase = createClient();
    supabase
      .from('partners')
      .select('id, name')
      .order('name')
      .then(({ data }) => setPartners(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const groupedEvents = useMemo(() => {
    if (!trip) return [];
    const groups = new Map<string, TripEvent[]>();
    for (const ev of trip.trip_events) {
      const key = ev.event_date;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ev);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [trip]);

  async function handleTokenAction(action: 'reissue' | 'revoke') {
    setTokenBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, expires_in_days: 30 }),
      });
      if (!res.ok) throw new Error('token action failed');
      await load();
    } finally {
      setTokenBusy(false);
    }
  }

  async function handleCopyLink() {
    if (!trip?.access_token) return;
    const url = `${window.location.origin}${PUBLIC_TRIP_PATH}/${trip.access_token}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-600">
          โหลดข้อมูลไม่สำเร็จ: {error}{' '}
          <button onClick={load} className="underline">
            ลองใหม่
          </button>
        </div>
      </div>
    );
  }

  if (!trip) {
    return <div className="py-16 text-center text-sm text-slate-400">กำลังโหลด...</div>;
  }

  const tokenState: 'none' | 'active' | 'revoked' | 'expired' = !trip.access_token
    ? 'none'
    : trip.token_revoked_at
    ? 'revoked'
    : trip.token_expires_at && new Date(trip.token_expires_at) < new Date()
    ? 'expired'
    : 'active';

  return (
    <div className="mx-auto max-w-2xl p-4 pb-28">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => router.push('/admin/journeys')}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-400">{trip.trip_number}</div>
          <h1 className="truncate text-lg font-bold text-slate-900">
            {trip.customers?.full_name ?? 'ไม่ทราบชื่อลูกค้า'}
          </h1>
        </div>
        <button
          onClick={() => setShowEditTrip(true)}
          className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600"
        >
          แก้ไข
        </button>
      </div>

      {/* Info card */}
      <div className="card-shadow mb-3 rounded-2xl border border-slate-100 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_PILL[trip.status]}`}>
            {STATUS_LABEL[trip.status]}
          </span>
          <span className="text-xs text-slate-400">
            {formatShortDate(trip.start_date)} – {formatShortDate(trip.end_date)}
          </span>
        </div>
        <div className="space-y-1.5 text-sm text-slate-700">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
            <span>
              {trip.origin || '—'} → {trip.destination || '—'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 shrink-0 text-slate-400" />
            <span>{trip.customers?.phone ?? '—'}</span>
          </div>
        </div>
        {(trip.requires_passport || trip.requires_visa) && (
          <div className="mt-3 flex gap-2">
            {trip.requires_passport ? (
              <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                ต้องใช้พาสปอร์ต
              </span>
            ) : null}
            {trip.requires_visa ? (
              <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                ต้องใช้วีซ่า
              </span>
            ) : null}
          </div>
        )}
        {trip.notes ? <p className="mt-3 text-xs text-slate-500">{trip.notes}</p> : null}
        {trip.trip_participants.length > 1 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {trip.trip_participants.map((p) => (
              <span
                key={p.id}
                className="flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
              >
                <User className="h-3 w-3" />
                {p.is_primary ? trip.customers?.full_name : p.display_name ?? 'ผู้ร่วมเดินทาง'}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Secure link card */}
      <div className="card-shadow mb-5 rounded-2xl border border-slate-100 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Link2 className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900">ลิงก์สำหรับลูกค้า</h2>
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${
              tokenState === 'active'
                ? 'bg-emerald-100 text-emerald-700'
                : tokenState === 'none'
                ? 'bg-slate-100 text-slate-500'
                : 'bg-rose-100 text-rose-700'
            }`}
          >
            {tokenState === 'active'
              ? 'ใช้งานได้'
              : tokenState === 'none'
              ? 'ยังไม่สร้าง'
              : tokenState === 'revoked'
              ? 'ถูกเพิกถอน'
              : 'หมดอายุ'}
          </span>
        </div>
        {tokenState === 'active' && trip.token_expires_at ? (
          <p className="mb-3 text-xs text-slate-400">
            หมดอายุ {formatShortDate(trip.token_expires_at)}
          </p>
        ) : null}
        <div className="flex gap-2">
          {tokenState === 'active' ? (
            <>
              <button
                onClick={handleCopyLink}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-white"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
              </button>
              <button
                onClick={() => handleTokenAction('revoke')}
                disabled={tokenBusy}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
                เพิกถอน
              </button>
            </>
          ) : (
            <button
              onClick={() => handleTokenAction('reissue')}
              disabled={tokenBusy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {tokenBusy ? 'กำลังสร้าง...' : tokenState === 'none' ? 'สร้างลิงก์' : 'ออกลิงก์ใหม่'}
            </button>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">กำหนดการ</h2>
        <button
          onClick={() => setShowImportSheet(true)}
          className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary-dark"
        >
          <PackagePlus className="h-3.5 w-3.5" />
          นำเข้าจากคำสั่งจอง
        </button>
      </div>
      {groupedEvents.length === 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white py-10 text-center text-sm text-slate-400">
          ยังไม่มีกิจกรรมในทริปนี้
        </div>
      ) : (
        <div className="space-y-5">
          {groupedEvents.map(([date, events]) => (
            <div key={date}>
              <div className="mb-2 text-xs font-medium text-slate-400">{formatDateHeading(date)}</div>
              <div className="space-y-2">
                {events
                  .slice()
                  .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                  .map((ev) => {
                    const Icon = EVENT_TYPE_ICON[ev.event_type];
                    return (
                      <button
                        key={ev.id}
                        onClick={() => setEventModal({ mode: 'edit', event: ev })}
                        className="card-shadow flex w-full items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 text-left transition-transform active:scale-[0.99]"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-dark">
                          <Icon className="h-4.5 w-4.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-900">{ev.title}</span>
                            <span
                              className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${EVENT_STATUS_PILL[ev.status]}`}
                            >
                              {EVENT_STATUS_LABEL[ev.status]}
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                            {ev.event_type === 'hotel' ? (
                              <span>
                                เข้าพัก {formatShortDate(ev.event_date)}
                                {ev.end_date ? ` – ออก ${formatShortDate(ev.end_date)}` : ''}
                              </span>
                            ) : ev.start_time ? (
                              <span>
                                {formatTime(ev.start_time)}
                                {ev.end_time ? `–${formatTime(ev.end_time)}` : ''}
                              </span>
                            ) : null}
                            {ev.location ? <span className="truncate">{ev.location}</span> : null}
                            {ev.partners?.name ? <span className="truncate">{ev.partners.name}</span> : null}
                          </div>
                          {ev.event_type === 'transport' ? (
                            (() => {
                              const ta = ev.transport_assignments;
                              if (!ta) {
                                return (
                                  <div className="mt-1 text-xs font-medium text-amber-600">
                                    ยังไม่ได้กรอกรายละเอียดการเดินทาง
                                  </div>
                                );
                              }
                              const driverLabel = ta.drivers?.name ?? ta.driver_name;
                              return (
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                                  {driverLabel ? (
                                    <span className="flex items-center gap-1 font-medium text-slate-700">
                                      <User className="h-3 w-3" />
                                      {driverLabel}
                                    </span>
                                  ) : (
                                    <span className="font-medium text-amber-600">ยังไม่ได้มอบหมายคนขับ</span>
                                  )}
                                  {ta.vehicle ? (
                                    <span className="flex items-center gap-1">
                                      <Car className="h-3 w-3" />
                                      {ta.vehicle}
                                    </span>
                                  ) : null}
                                  <span className="flex items-center gap-1 truncate">
                                    <MapPin className="h-3 w-3 shrink-0" />
                                    {ta.pickup_location} → {ta.dropoff_location}
                                  </span>
                                </div>
                              );
                            })()
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setEventModal({ mode: 'create' })}
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-transform active:scale-95"
        aria-label="เพิ่มกิจกรรม"
      >
        <Plus className="h-6 w-6" />
      </button>

      {showEditTrip ? (
        <EditTripSheet trip={trip} onClose={() => setShowEditTrip(false)} onSaved={load} />
      ) : null}

      {eventModal ? (
        <EventSheet
          tripId={tripId}
          partners={partners}
          initial={eventModal.mode === 'edit' ? eventModal.event : null}
          onClose={() => setEventModal(null)}
          onSaved={() => {
            setEventModal(null);
            load();
          }}
        />
      ) : null}

      {showImportSheet ? (
        <OrderItemImportSheet
          tripId={tripId}
          onClose={() => setShowImportSheet(false)}
          onImported={() => {
            setShowImportSheet(false);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function EditTripSheet({ trip, onClose, onSaved }: { trip: Trip; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<TripStatus>(trip.status);
  const [startDate, setStartDate] = useState(trip.start_date);
  const [endDate, setEndDate] = useState(trip.end_date);
  const [origin, setOrigin] = useState(trip.origin ?? '');
  const [destination, setDestination] = useState(trip.destination ?? '');
  const [notes, setNotes] = useState(trip.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${trip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          start_date: startDate,
          end_date: endDate,
          origin,
          destination,
          notes,
        }),
      });
      if (!res.ok) throw new Error('บันทึกไม่สำเร็จ');
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">แก้ไขทริป</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">สถานะ</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as TripStatus)} className="form-input">
              {(['planned', 'in_progress', 'completed', 'cancelled'] as const).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">วันที่เริ่ม</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="form-input" required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">วันที่สิ้นสุด</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="form-input" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ต้นทาง</label>
              <input value={origin} onChange={(e) => setOrigin(e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ปลายทาง</label>
              <input value={destination} onChange={(e) => setDestination(e.target.value)} className="form-input" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">หมายเหตุ</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="form-input" />
          </div>
          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>
          ) : null}
          <button type="submit" disabled={submitting} className="btn-primary w-full justify-center">
            {submitting ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Trip Builder — import the customer's existing order_items as events
// ---------------------------------------------------------------------

interface ImportableOrderItem {
  id: string;
  order_id: string;
  order_number: string | null;
  service_type: 'clinic' | 'hotel' | 'transport' | 'wellness' | 'insurance';
  status: string;
  price: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  packages: { id: string; title: string } | null;
  partners: { id: string; name: string } | null;
  linked_trip_event: { id: string; trip_id: string; trip_number: string | null } | null;
}

const SERVICE_TYPE_LABEL: Record<ImportableOrderItem['service_type'], string> = {
  clinic: 'คลินิก',
  hotel: 'ที่พัก',
  transport: 'การเดินทาง',
  wellness: 'เวลเนส',
  insurance: 'ประกันภัย',
};
const SERVICE_TYPE_ICON: Record<ImportableOrderItem['service_type'], React.ElementType> = {
  clinic: HeartPulse,
  hotel: Building2,
  transport: Car,
  wellness: Sparkles,
  insurance: Calendar,
};
const ORDER_ITEM_STATUS_LABEL: Record<string, string> = {
  pending: 'รอดำเนินการ',
  confirmed: 'ยืนยันแล้ว',
  checked_in: 'เช็คอินแล้ว',
  completed: 'เสร็จสิ้น',
};

function OrderItemImportSheet({
  tripId,
  onClose,
  onImported,
}: {
  tripId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [items, setItems] = useState<ImportableOrderItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/trips/${tripId}/order-items`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((result) => {
        if (result?.error) throw new Error(result.error);
        setItems(result.items ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ'));
  }, [tripId]);

  const selectableIds = useMemo(
    () => (items ?? []).filter((i) => !i.linked_trip_event).map((i) => i.id),
    [items]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  async function handleImport() {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/order-items/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_item_ids: Array.from(selected) }),
      });
      const result = await res.json().catch(() => null);
      const createdCount: number = result?.created_count ?? 0;
      if (createdCount === 0) {
        const firstFail = result?.results?.find((r: { status: string }) => r.status === 'failed');
        throw new Error(firstFail?.detail ?? 'นำเข้าไม่สำเร็จ');
      }
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'นำเข้าไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center">
      <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:max-w-md sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">นำเข้าจากคำสั่งจอง</h2>
            <p className="mt-0.5 text-xs text-slate-400">เลือกรายการที่ลูกค้าจองไว้แล้ว เพื่อเพิ่มเป็นกิจกรรมในทริปนี้</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error ? (
            <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>
          ) : null}

          {items === null ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 py-10 text-center text-sm text-slate-400">
              ลูกค้าคนนี้ยังไม่มีคำสั่งจองที่นำเข้าได้
            </div>
          ) : (
            <>
              {selectableIds.length > 0 ? (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="mb-3 text-xs font-medium text-primary-dark"
                >
                  {allSelected ? 'ยกเลิกเลือกทั้งหมด' : `เลือกทั้งหมด (${selectableIds.length})`}
                </button>
              ) : null}
              <div className="space-y-2">
                {items.map((item) => {
                  const Icon = SERVICE_TYPE_ICON[item.service_type];
                  const isLinked = !!item.linked_trip_event;
                  const isSelected = selected.has(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={isLinked}
                      onClick={() => toggle(item.id)}
                      className={`flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
                        isLinked
                          ? 'border-slate-100 bg-slate-50 opacity-60'
                          : isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-slate-100 bg-white'
                      }`}
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                          isSelected ? 'bg-primary text-white' : 'bg-primary/10 text-primary-dark'
                        }`}
                      >
                        {isLinked ? <CheckCircle2 className="h-4.5 w-4.5" /> : <Icon className="h-4.5 w-4.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900">
                            {item.packages?.title ?? SERVICE_TYPE_LABEL[item.service_type]}
                          </span>
                          <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                            {ORDER_ITEM_STATUS_LABEL[item.status] ?? item.status}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                          <span>{SERVICE_TYPE_LABEL[item.service_type]}</span>
                          {item.partners?.name ? <span>· {item.partners.name}</span> : null}
                          {item.scheduled_date ? <span>· {formatShortDate(item.scheduled_date)}</span> : null}
                          {item.order_number ? <span className="text-slate-400">· {item.order_number}</span> : null}
                        </div>
                        {isLinked ? (
                          <div className="mt-1 text-[11px] font-medium text-primary-dark">
                            อยู่ในทริปแล้ว{item.linked_trip_event?.trip_number ? ` (${item.linked_trip_event.trip_number})` : ''}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {items && items.length > 0 ? (
          <div className="border-t border-slate-100 p-5 pt-4">
            <button
              onClick={handleImport}
              disabled={selected.size === 0 || submitting}
              className="btn-primary w-full justify-center disabled:opacity-50"
            >
              {submitting ? 'กำลังนำเข้า...' : `เพิ่ม ${selected.size || ''} รายการเข้าทริป`.trim()}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EventSheet({
  tripId,
  partners,
  initial,
  onClose,
  onSaved,
}: {
  tripId: string;
  partners: PartnerOption[];
  initial: TripEvent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [eventType, setEventType] = useState<EventType>(initial?.event_type ?? 'transport');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [eventDate, setEventDate] = useState(initial?.event_date ?? '');
  const [endDate, setEndDate] = useState(initial?.end_date ?? '');
  const [startTime, setStartTime] = useState(initial?.start_time?.slice(0, 5) ?? '');
  const [endTime, setEndTime] = useState(initial?.end_time?.slice(0, 5) ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [partnerId, setPartnerId] = useState(initial?.partner_id ?? '');
  const [contactName, setContactName] = useState(initial?.contact_name ?? '');
  const [contactPhone, setContactPhone] = useState(initial?.contact_phone ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Transport assignment fields (only relevant when eventType === 'transport') ---
  const initialTransport = initial?.transport_assignments ?? null;
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverId, setDriverId] = useState(initialTransport?.driver_id ?? '');
  const [adhocDriverName, setAdhocDriverName] = useState(
    !initialTransport?.driver_id ? initialTransport?.driver_name ?? '' : ''
  );
  const [adhocDriverPhone, setAdhocDriverPhone] = useState(
    !initialTransport?.driver_id ? initialTransport?.driver_phone ?? '' : ''
  );
  const [vehicle, setVehicle] = useState(initialTransport?.vehicle ?? '');
  const [pickupLocation, setPickupLocation] = useState(initialTransport?.pickup_location ?? '');
  const [dropoffLocation, setDropoffLocation] = useState(initialTransport?.dropoff_location ?? '');
  const [pickupTime, setPickupTime] = useState(toDatetimeLocal(initialTransport?.pickup_time ?? null));
  const [dropoffTimeEstimated, setDropoffTimeEstimated] = useState(
    toDatetimeLocal(initialTransport?.dropoff_time_estimated ?? null)
  );
  const [transportStatus, setTransportStatus] = useState<TransportStatus>(
    initialTransport?.status ?? 'pending'
  );
  // UI-only distinction — not a separate DB column. A "daily charter" is
  // just a transport_assignment whose pickup_time/dropoff_time_estimated
  // span multiple days instead of one precise pickup/dropoff moment; the
  // driver-overlap exclusion constraints (migration 076) already work
  // correctly either way since they operate on the same tstzrange. When
  // editing an existing assignment, infer which mode it was likely
  // entered as from whether the two dates differ.
  const [transportKind, setTransportKind] = useState<'one_way' | 'daily'>(() => {
    if (!initialTransport?.dropoff_time_estimated) return 'one_way';
    const pickupDate = splitLocal(toDatetimeLocal(initialTransport.pickup_time)).date;
    const dropoffDate = splitLocal(toDatetimeLocal(initialTransport.dropoff_time_estimated)).date;
    return pickupDate && dropoffDate && pickupDate !== dropoffDate ? 'daily' : 'one_way';
  });
  // Inclusive day count for daily-charter mode ("9–11 ก.ย." = 3 days),
  // display-only — derived from the same pickup_time/dropoff_time_estimated
  // fields used for the one-way mode, just without a clock-time component.
  const dailyDaysCount = (() => {
    const startDate = splitLocal(pickupTime).date;
    const endDate = splitLocal(dropoffTimeEstimated).date;
    if (!startDate || !endDate) return 0;
    const diffMs = new Date(endDate).getTime() - new Date(startDate).getTime();
    if (Number.isNaN(diffMs) || diffMs < 0) return 0;
    return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
  })();

  useEffect(() => {
    fetch('/api/admin/drivers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((result) => {
        if (result?.drivers) setDrivers(result.drivers);
      })
      .catch(() => {});
  }, []);

  // Business rule from migration 076: a driver with partner_id set can only
  // serve that partner's events; partner_id null (shared pool) serves any
  // event; and an event with no partner is logistics-only, so any driver OK.
  const availableDrivers = drivers.filter(
    (d) => d.status === 'active' && (!partnerId || !d.partner_id || d.partner_id === partnerId)
  );

  const isEdit = !!initial;
  const nextStatuses = initial ? EVENT_STATUS_TRANSITIONS[initial.status] : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (
      eventType === 'transport' &&
      pickupTime &&
      dropoffTimeEstimated &&
      dropoffTimeEstimated < pickupTime
    ) {
      setError('เวลาส่งโดยประมาณต้องอยู่หลังเวลารับ กรุณาตรวจสอบวันที่และเวลาอีกครั้ง');
      return;
    }

    // Previously: if these three were missing, the transport_assignment
    // PUT below was just skipped — the trip_event itself still saved fine,
    // so it looked like "save worked" while "รายละเอียดการเดินทาง" quietly
    // never got created. Fail loudly instead, in the section people
    // actually need to fill (จุดรับ/จุดส่ง/เวลารับ ในกล่อง "รายละเอียดการเดินทาง"
    // ด้านล่าง — คนละช่องกับ "เริ่ม/สิ้นสุด" ด้านบน).
    if (eventType === 'transport' && !(pickupLocation && dropoffLocation && pickupTime)) {
      setError('กรุณากรอก จุดรับ, จุดส่ง และเวลารับ ในส่วน "รายละเอียดการเดินทาง" ด้านล่างก่อนบันทึก');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        event_type: eventType,
        title,
        event_date: eventDate,
        end_date: eventType === 'hotel' ? endDate || null : null,
        start_time: eventType === 'hotel' ? null : startTime || null,
        end_time: eventType === 'hotel' ? null : endTime || null,
        location: location || null,
        partner_id: partnerId || null,
        contact_name: contactName || null,
        contact_phone: contactPhone || null,
        notes: notes || null,
      };
      const res = isEdit
        ? await fetch(`/api/trips/${tripId}/events/${initial!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/trips/${tripId}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const result = await res.json().catch(() => null);
        throw new Error(result?.detail ?? result?.error ?? 'บันทึกไม่สำเร็จ');
      }
      const savedEventId = isEdit ? initial!.id : ((await res.json()) as { event: { id: string } }).event.id;

      if (eventType === 'transport' && pickupLocation && dropoffLocation && pickupTime) {
        const transportPayload = {
          driver_id: driverId || null,
          driver_name: driverId ? null : adhocDriverName || null,
          driver_phone: driverId ? null : adhocDriverPhone || null,
          vehicle: vehicle || null,
          pickup_location: pickupLocation,
          dropoff_location: dropoffLocation,
          pickup_time: fromDatetimeLocal(pickupTime),
          dropoff_time_estimated: fromDatetimeLocal(dropoffTimeEstimated),
          status: transportStatus,
        };
        const transportRes = await fetch(`/api/trips/${tripId}/events/${savedEventId}/transport`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(transportPayload),
        });
        if (!transportRes.ok) {
          const result = await transportRes.json().catch(() => null);
          throw new Error(result?.detail ?? result?.error ?? 'บันทึกรายละเอียดการเดินทางไม่สำเร็จ');
        }
      }

      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(next: EventStatus) {
    if (!initial) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/events/${initial.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error('เปลี่ยนสถานะไม่สำเร็จ');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!initial) return;
    if (!confirm('ลบกิจกรรมนี้?')) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/events/${initial.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('ลบไม่สำเร็จ');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ลบไม่สำเร็จ');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{isEdit ? 'แก้ไขกิจกรรม' : 'เพิ่มกิจกรรม'}</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isEdit && nextStatuses.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {nextStatuses.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleStatusChange(s)}
                disabled={submitting}
                className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary-dark disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                เปลี่ยนเป็น{EVENT_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">ประเภทกิจกรรม</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(EVENT_TYPE_LABEL) as EventType[]).map((t) => {
                const Icon = EVENT_TYPE_ICON[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setEventType(t)}
                    className={`flex flex-col items-center gap-1 rounded-xl border py-2 text-[11px] font-medium transition-colors ${
                      eventType === t
                        ? 'border-primary bg-primary/5 text-primary-dark'
                        : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {EVENT_TYPE_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">ชื่อกิจกรรม</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="form-input" required />
          </div>

          {eventType === 'hotel' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">เช็คอิน</label>
                <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="form-input" required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">เช็คเอาท์</label>
                <input
                  type="date"
                  value={endDate}
                  min={eventDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">วันที่</label>
                <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="form-input" required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">เริ่ม</label>
                <Time24Input value={startTime} onChange={setStartTime} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">สิ้นสุด</label>
                <Time24Input value={endTime} onChange={setEndTime} />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">สถานที่</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="form-input" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">พาร์ทเนอร์ (ถ้ามี)</label>
            <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="form-input">
              <option value="">— ไม่ระบุ —</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {eventType === 'transport' ? (
            <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <Car className="h-3.5 w-3.5" />
                รายละเอียดการเดินทาง
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">ประเภทการเดินทาง</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTransportKind('one_way')}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                      transportKind === 'one_way'
                        ? 'border-primary bg-primary/5 text-primary-dark'
                        : 'border-slate-200 bg-white text-slate-500'
                    }`}
                  >
                    เที่ยวเดียว / รับส่ง
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransportKind('daily')}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                      transportKind === 'daily'
                        ? 'border-primary bg-primary/5 text-primary-dark'
                        : 'border-slate-200 bg-white text-slate-500'
                    }`}
                  >
                    เหมารายวัน
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">จุดรับ</label>
                  <input
                    value={pickupLocation}
                    onChange={(e) => setPickupLocation(e.target.value)}
                    className="form-input"
                    placeholder="เช่น สนามบินอุดรธานี"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">จุดส่ง</label>
                  <input
                    value={dropoffLocation}
                    onChange={(e) => setDropoffLocation(e.target.value)}
                    className="form-input"
                    placeholder="เช่น โรงพยาบาล..."
                  />
                </div>
              </div>

              {transportKind === 'daily' ? (
                <div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">วันที่เริ่ม</label>
                      <input
                        type="date"
                        value={splitLocal(pickupTime).date}
                        onChange={(e) => setPickupTime(joinLocal(e.target.value, '08:00'))}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">วันที่สิ้นสุด</label>
                      <input
                        type="date"
                        min={splitLocal(pickupTime).date || undefined}
                        value={splitLocal(dropoffTimeEstimated).date}
                        onChange={(e) => setDropoffTimeEstimated(joinLocal(e.target.value, '20:00'))}
                        className="form-input"
                      />
                    </div>
                  </div>
                  {dailyDaysCount > 0 ? (
                    <p className="mt-1.5 text-[11px] font-medium text-primary-dark">
                      รวม {dailyDaysCount} วัน
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">เวลารับ</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={splitLocal(pickupTime).date}
                        onChange={(e) =>
                          setPickupTime(joinLocal(e.target.value, splitLocal(pickupTime).time || '00:00'))
                        }
                        className="form-input flex-1"
                      />
                      <Time24Input
                        value={splitLocal(pickupTime).time}
                        onChange={(t) =>
                          setPickupTime(joinLocal(splitLocal(pickupTime).date || todayStr(), t))
                        }
                      />
                      <span className="shrink-0 text-xs text-slate-400">น.</span>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">เวลาส่งโดยประมาณ</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={splitLocal(dropoffTimeEstimated).date}
                        onChange={(e) =>
                          setDropoffTimeEstimated(
                            joinLocal(e.target.value, splitLocal(dropoffTimeEstimated).time || '00:00')
                          )
                        }
                        className="form-input flex-1"
                      />
                      <Time24Input
                        value={splitLocal(dropoffTimeEstimated).time}
                        onChange={(t) =>
                          setDropoffTimeEstimated(
                            joinLocal(splitLocal(dropoffTimeEstimated).date || todayStr(), t)
                          )
                        }
                      />
                      <span className="shrink-0 text-xs text-slate-400">น.</span>
                    </div>
                  </div>
                </div>
              )}
              {dropoffTimeEstimated && pickupTime && dropoffTimeEstimated < pickupTime ? (
                <p className="text-[11px] text-rose-600">
                  {transportKind === 'daily'
                    ? 'วันที่สิ้นสุดต้องอยู่หลังวันที่เริ่ม'
                    : 'เวลาส่งโดยประมาณต้องอยู่หลังเวลารับ'}
                </p>
              ) : null}

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">คนขับ</label>
                <select
                  value={driverId}
                  onChange={(e) => {
                    setDriverId(e.target.value);
                    if (e.target.value) {
                      setAdhocDriverName('');
                      setAdhocDriverPhone('');
                    }
                  }}
                  className="form-input"
                >
                  <option value="">— ไม่ระบุ (กรอกชื่อคนขับเอง) —</option>
                  {availableDrivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.partner_id ? '' : ' (พูลกลาง WOS)'}
                    </option>
                  ))}
                </select>
                {partnerId && drivers.some((d) => d.partner_id && d.partner_id !== partnerId) ? (
                  <p className="mt-1 text-[11px] text-slate-400">
                    ซ่อนคนขับที่สังกัดพาร์ทเนอร์อื่นไว้ — เลือกได้เฉพาะพูลกลาง WOS หรือคนขับของพาร์ทเนอร์นี้
                  </p>
                ) : null}
              </div>

              {!driverId ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">ชื่อคนขับ (ถ้าไม่อยู่ในระบบ)</label>
                    <input
                      value={adhocDriverName}
                      onChange={(e) => setAdhocDriverName(e.target.value)}
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">เบอร์โทรคนขับ</label>
                    <input
                      value={adhocDriverPhone}
                      onChange={(e) => setAdhocDriverPhone(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">รถ / ทะเบียน</label>
                  <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="form-input" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">สถานะการเดินทาง</label>
                  <select
                    value={transportStatus}
                    onChange={(e) => setTransportStatus(e.target.value as TransportStatus)}
                    className="form-input"
                  >
                    {(Object.keys(TRANSPORT_STATUS_LABEL) as TransportStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {TRANSPORT_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!pickupLocation || !dropoffLocation || !pickupTime ? (
                <p className="text-[11px] text-amber-600">
                  ต้องกรอกจุดรับ จุดส่ง และเวลารับ ให้ครบ ถึงจะบันทึกรายละเอียดการเดินทางได้
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ผู้ติดต่อ</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">เบอร์โทรผู้ติดต่อ</label>
              <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="form-input" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">หมายเหตุ</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="form-input" />
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>
          ) : null}

          <div className="flex gap-2">
            {isEdit ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 px-4 py-2.5 text-xs font-medium text-rose-600 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                ลบ
              </button>
            ) : null}
            <button type="submit" disabled={submitting} className="btn-primary flex-1 justify-center">
              {submitting ? 'กำลังบันทึก...' : isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มกิจกรรม'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
