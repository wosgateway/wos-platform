'use client';

// src/components/admin/JourneysManager.tsx
//
// Admin — Journey Control Center (list view).
// iOS-style: segmented status filter, rounded card rows with a
// disclosure chevron, a floating "+" to create a trip, bottom-sheet
// modal for the create form. Talks to the Trip CRUD API
// (/api/trips, /api/admin/customers/search) — never queries `trips`
// or `customers` directly from the browser (both are service-role-only
// tables, see sql/076_wos_trip_journey_core_v6.sql / 011_create_customers_table.sql).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, X, MapPin, Calendar, AlertTriangle, Clock } from 'lucide-react';

type TripStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

// Mirrors AttentionCase['code'] in src/lib/journey/attention.ts — kept as a
// plain string union here rather than importing the server-only type, since
// this component only ever reads it off the API response.
type AttentionCaseCode =
  | 'OVERDUE'
  | 'UNASSIGNED_PARTNER'
  | 'PENDING_CONFIRMATION'
  | 'FAILED_REMINDER'
  | 'MISSING_LOCATION'
  | 'MISSING_CUSTOMER_CONTACT'
  | 'TRANSPORT_INCOMPLETE';

interface AttentionSummary {
  cases: { code: AttentionCaseCode; eventId: string | null; message: string }[];
  overallStatus: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ATTENTION_REQUIRED';
  progress: { completed: number; total: number };
  nextEvent: { id: string; title: string; event_date: string; start_time: string | null } | null;
}

interface TripRow {
  id: string;
  trip_number: string;
  customer_id: string;
  start_date: string;
  end_date: string;
  origin: string | null;
  destination: string | null;
  status: TripStatus;
  created_at: string;
  customers: { id: string; full_name: string; phone: string } | null;
  attention: AttentionSummary;
}

interface CustomerHit {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
}

// One customer order, reduced to what CreateTripSheet needs to
// pre-fill a new trip's dates instead of the admin re-typing dates
// that already exist on an order (see /api/admin/customers/[id]/orders).
interface CustomerOrderHint {
  id: string;
  order_number: string;
  status: string;
  suggested_start_date: string | null;
  suggested_end_date: string | null;
  pickup_location_hint: string | null;
  dropoff_location_hint: string | null;
}

const STATUS_LABEL: Record<TripStatus, string> = {
  planned: 'วางแผน',
  in_progress: 'กำลังเดินทาง',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
};

const STATUS_DOT: Record<TripStatus, string> = {
  planned: 'bg-sky-500',
  in_progress: 'bg-primary',
  completed: 'bg-slate-400',
  cancelled: 'bg-rose-500',
};

const STATUS_PILL: Record<TripStatus, string> = {
  planned: 'bg-sky-100 text-sky-700',
  in_progress: 'bg-primary/15 text-primary-dark',
  completed: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-rose-100 text-rose-700',
};

function formatDateRange(start: string, end: string) {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatEventTime(startTime: string | null) {
  return startTime ? startTime.slice(0, 5) : null; // 'HH:MM:SS' -> 'HH:MM'
}

export function JourneysManager() {
  const router = useRouter();
  const [trips, setTrips] = useState<TripRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | TripStatus>('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setError(null);
    try {
      const url = statusFilter === 'all' ? '/api/trips' : `/api/trips?status=${statusFilter}`;
      const res = await fetch(url, { cache: 'no-store' });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? 'failed to load');
      setTrips(result.trips);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const visibleTrips = useMemo(() => {
    if (!trips) return [];
    const q = search.trim().toLowerCase();
    if (!q) return trips;
    return trips.filter((t) => {
      const haystack = `${t.trip_number} ${t.customers?.full_name ?? ''} ${t.customers?.phone ?? ''} ${t.origin ?? ''} ${t.destination ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [trips, search]);

  return (
    <div className="mx-auto max-w-2xl p-4 pb-28">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">ทริป</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow-sm transition-transform active:scale-95"
          aria-label="สร้างทริปใหม่"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาทริป ลูกค้า หรือปลายทาง"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/10"
        />
      </div>

      {/* Segmented status filter — iOS style */}
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-slate-100 p-1">
        {(['all', 'planned', 'in_progress', 'completed', 'cancelled'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {s === 'all' ? 'ทั้งหมด' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* List */}
      {error ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-600">
          โหลดข้อมูลไม่สำเร็จ: {error}{' '}
          <button onClick={load} className="underline">
            ลองใหม่
          </button>
        </div>
      ) : !trips ? (
        <div className="py-16 text-center text-sm text-slate-400">กำลังโหลด...</div>
      ) : visibleTrips.length === 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white py-14 text-center text-sm text-slate-400">
          {search ? 'ไม่พบทริปที่ตรงกับคำค้นหา' : 'ยังไม่มีทริปในหมวดนี้'}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleTrips.map((trip) => {
            const attentionCount = trip.attention?.cases.length ?? 0;
            const progress = trip.attention?.progress;
            const nextEvent = trip.attention?.nextEvent;
            return (
              <button
                key={trip.id}
                onClick={() => router.push(`/admin/journeys/${trip.id}`)}
                className="card-shadow flex w-full flex-col gap-2 rounded-2xl border border-slate-100 bg-white p-4 text-left transition-transform active:scale-[0.99]"
              >
                <div className="flex w-full items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[trip.status]}`} />
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {trip.customers?.full_name ?? 'ไม่ทราบชื่อลูกค้า'}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-slate-400">{trip.trip_number}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDateRange(trip.start_date, trip.end_date)}
                      </span>
                      {trip.destination ? (
                        <span className="flex min-w-0 items-center gap-1 truncate">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{trip.destination}</span>
                        </span>
                      ) : null}
                      {progress && progress.total > 0 ? (
                        <span className="shrink-0 text-slate-400">
                          {progress.completed}/{progress.total} completed
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_PILL[trip.status]}`}>
                    {STATUS_LABEL[trip.status]}
                  </span>
                </div>

                {nextEvent ? (
                  <div className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="font-medium text-slate-700">NEXT</span>
                    <span className="truncate">{nextEvent.title}</span>
                    {formatEventTime(nextEvent.start_time) ? (
                      <span className="ml-auto shrink-0 text-slate-400">{formatEventTime(nextEvent.start_time)}</span>
                    ) : null}
                  </div>
                ) : null}

                {attentionCount > 0 ? (
                  <div className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {attentionCount === 1
                      ? '1 item requires attention'
                      : `${attentionCount} items require attention`}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {showCreate ? (
        <CreateTripSheet
          onClose={() => setShowCreate(false)}
          onCreated={(tripId) => {
            setShowCreate(false);
            router.push(`/admin/journeys/${tripId}`);
          }}
        />
      ) : null}
    </div>
  );
}

function CreateTripSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (tripId: string) => void;
}) {
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerHits, setCustomerHits] = useState<CustomerHit[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerHit | null>(null);
  const [searching, setSearching] = useState(false);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('th');
  const [requiresPassport, setRequiresPassport] = useState(false);
  const [requiresVisa, setRequiresVisa] = useState(false);
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once a customer is picked, pull their existing orders and use them
  // to pre-fill start/end date — previously this always started blank,
  // forcing the admin to re-type dates that were already on the order
  // from booking time. Dates stay fully editable either way; this is
  // just a starting point, not a lock. See
  // /api/admin/customers/[id]/orders for how suggested_start_date /
  // suggested_end_date are derived per order.
  const [customerOrders, setCustomerOrders] = useState<CustomerOrderHint[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [appliedOrderId, setAppliedOrderId] = useState<string | null>(null);

  function applyOrderDates(order: CustomerOrderHint) {
    if (order.suggested_start_date) setStartDate(order.suggested_start_date);
    if (order.suggested_end_date) setEndDate(order.suggested_end_date);
    setAppliedOrderId(order.id);
  }

  useEffect(() => {
    if (!selectedCustomer) {
      setCustomerOrders([]);
      setAppliedOrderId(null);
      return;
    }
    let cancelled = false;
    setLoadingOrders(true);
    fetch(`/api/admin/customers/${selectedCustomer.id}/orders`)
      .then((r) => (r.ok ? r.json() : null))
      .then((result) => {
        if (cancelled) return;
        const orders: CustomerOrderHint[] = result?.orders ?? [];
        setCustomerOrders(orders);
        // Auto-apply the most recent order's dates (orders are already
        // sorted newest-first by the API) so the common case — one
        // active order per customer — needs zero extra clicks. With
        // more than one order, the admin picks explicitly below instead
        // of silently guessing which one this trip is for.
        if (orders.length === 1 && orders[0].suggested_start_date) {
          applyOrderDates(orders[0]);
        }
      })
      .catch(() => {
        if (!cancelled) setCustomerOrders([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingOrders(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer]);

  useEffect(() => {
    if (selectedCustomer) return;
    const q = customerQuery.trim();
    if (q.length < 2) {
      setCustomerHits([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(q)}`);
        const result = await res.json();
        setCustomerHits(result.customers ?? []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [customerQuery, selectedCustomer]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedCustomer) {
      setError('กรุณาเลือกลูกค้าก่อน');
      return;
    }
    if (!startDate || !endDate) {
      setError('กรุณาระบุวันที่เริ่มและวันที่สิ้นสุด');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: selectedCustomer.id,
          start_date: startDate,
          end_date: endDate,
          origin: origin || null,
          destination: destination || null,
          preferred_language: preferredLanguage,
          requires_passport: requiresPassport,
          requires_visa: requiresVisa,
          notes: notes || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.detail ?? result?.error ?? 'สร้างทริปไม่สำเร็จ');
      onCreated(result.trip.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สร้างทริปไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">สร้างทริปใหม่</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer picker */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">ลูกค้า</label>
            {selectedCustomer ? (
              <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-slate-900">{selectedCustomer.full_name}</div>
                  <div className="text-xs text-slate-500">{selectedCustomer.phone}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setCustomerQuery('');
                  }}
                  className="text-xs font-medium text-primary-dark underline"
                >
                  เปลี่ยน
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="พิมพ์ชื่อหรือเบอร์โทรลูกค้า"
                  className="form-input"
                />
                {customerQuery.trim().length >= 2 ? (
                  <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-100 bg-white shadow-lg">
                    {searching ? (
                      <div className="p-3 text-xs text-slate-400">กำลังค้นหา...</div>
                    ) : customerHits.length === 0 ? (
                      <div className="p-3 text-xs text-slate-400">ไม่พบลูกค้า</div>
                    ) : (
                      customerHits.map((c) => (
                        <button
                          type="button"
                          key={c.id}
                          onClick={() => {
                            setSelectedCustomer(c);
                            setCustomerHits([]);
                          }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                        >
                          <div className="font-medium text-slate-900">{c.full_name}</div>
                          <div className="text-xs text-slate-400">{c.phone}</div>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Order date auto-fill — only relevant once a customer is
              picked and has more than one active order, since the
              single-order case already auto-applies above. */}
          {selectedCustomer && loadingOrders ? (
            <div className="text-xs text-slate-400">กำลังตรวจสอบออเดอร์ของลูกค้า...</div>
          ) : null}
          {selectedCustomer && !loadingOrders && customerOrders.length > 1 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="mb-2 text-xs font-medium text-amber-800">
                ลูกค้ามีหลายออเดอร์ — เลือกออเดอร์เพื่อดึงวันที่มาใส่อัตโนมัติ
              </p>
              <div className="space-y-1.5">
                {customerOrders.map((o) => (
                  <button
                    type="button"
                    key={o.id}
                    onClick={() => applyOrderDates(o)}
                    className={`block w-full rounded-lg border px-2.5 py-1.5 text-left text-xs ${
                      appliedOrderId === o.id
                        ? 'border-primary bg-primary/5 text-primary-dark'
                        : 'border-amber-200 bg-white text-slate-700 hover:bg-amber-100/50'
                    }`}
                  >
                    <span className="font-medium">{o.order_number}</span>
                    {o.suggested_start_date ? (
                      <span className="ml-2 text-slate-500">
                        {o.suggested_start_date}
                        {o.suggested_end_date && o.suggested_end_date !== o.suggested_start_date
                          ? ` – ${o.suggested_end_date}`
                          : ''}
                      </span>
                    ) : (
                      <span className="ml-2 text-slate-400">ไม่มีวันที่ในออเดอร์</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {selectedCustomer && !loadingOrders && appliedOrderId ? (
            <p className="text-xs text-emerald-600">✓ ดึงวันที่จากออเดอร์แล้ว — แก้ไขด้านล่างได้ตามจริง</p>
          ) : null}
          {selectedCustomer && !loadingOrders && customerOrders.length === 0 ? (
            <p className="text-xs text-slate-400">ลูกค้ารายนี้ยังไม่มีออเดอร์ที่ใช้งานอยู่ — กรอกวันที่เองด้านล่าง</p>
          ) : null}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">วันที่เริ่ม</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="form-input"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">วันที่สิ้นสุด</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="form-input"
                required
              />
            </div>
          </div>

          {/* Origin / destination */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ต้นทาง</label>
              <input value={origin} onChange={(e) => setOrigin(e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">ปลายทาง</label>
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="form-input"
              />
            </div>
          </div>

          {/* Language */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">ภาษาที่ลูกค้าใช้</label>
            <select
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value)}
              className="form-input"
            >
              <option value="th">ไทย</option>
              <option value="lo">ลาว</option>
              <option value="en">English</option>
            </select>
          </div>

          {/* Toggles */}
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={requiresPassport}
                onChange={(e) => setRequiresPassport(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
              />
              ต้องใช้พาสปอร์ต
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={requiresVisa}
                onChange={(e) => setRequiresVisa(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
              />
              ต้องใช้วีซ่า
            </label>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">หมายเหตุ (ถ้ามี)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="form-input"
            />
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
              {error}
            </div>
          ) : null}

          <button type="submit" disabled={submitting} className="btn-primary w-full justify-center">
            {submitting ? 'กำลังสร้าง...' : 'สร้างทริป'}
          </button>
        </form>
      </div>
    </div>
  );
}
