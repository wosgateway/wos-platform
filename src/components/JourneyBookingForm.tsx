'use client';

// src/components/JourneyBookingForm.tsx
//
// Multi-partner counterpart to BookingForm.tsx. That component takes
// a single `pkg` prop; this one reads several main items from the
// Journey cart (lib/journey/context.tsx) and gives every item the
// same scheduled_date/scheduled_time (one shared "trip start" date —
// keeps the form simple; per-item scheduling can be added later if
// customers need it). Hotel/Transport add-on logic below is copied
// as-is from BookingForm.tsx so behavior/pricing stays identical.
//
// Submits to the SAME /api/orders endpoint and the SAME
// create_order_with_items() RPC — that endpoint already accepted an
// arbitrary-length items[] array (see its validate() function), so
// no backend change was needed for this feature.

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { uploadBookingAttachment } from '@/lib/booking/upload-attachment';
import { formatTHB } from '@/lib/format';
import { normalizeImageSrc } from '@/lib/image';
import type { Package } from '@/lib/data';
import { DatePicker } from '@/components/ui/DatePicker';
import { TimePicker } from '@/components/ui/TimePicker';
import { Link } from '@/i18n/navigation';
import { useJourney } from '@/lib/journey/context';
import { distinctProvinces, normalizeProvince } from '@/lib/province';
import Image from 'next/image';

type TransportMode = 'one_way' | 'round_trip' | 'daily' | 'medical_assistance';

// Vehicle type: free-text on the DB side (migration 037 — no CHECK
// constraint, since Partner fleet composition varies) but the UI
// still offers a fixed dropdown as the source of truth for valid
// values, same reasoning as the pickup/dropoff LocationType below.
// Kept identical to BookingForm.tsx's version.
type VehicleType = '' | 'sedan' | 'suv' | 'vip_van' | 'medical_transport' | 'other';

// Pickup/dropoff location: dropdown of the common Laos↔Thailand
// corridor points WOS actually sees, plus 'hotel' and 'other' which
// reveal a free-text input for the specific name/spot. Keeps common
// cases standardized (reporting, driver dispatch) while still
// covering the long tail of real pickup/dropoff spots. Kept identical
// to BookingForm.tsx's version so both flows behave the same way.
type LocationType =
  | ''
  | 'nongkhai_bridge'
  | 'nakhon_phanom_bridge'
  | 'mukdahan_bridge'
  | 'chong_mek'
  | 'udon_airport'
  | 'hotel'
  | 'other'
  | 'per_itinerary';

interface FormState {
  tripDate: string;
  tripTime: string;
  needTransport: boolean;
  needHotel: boolean;
  transportPartnerId: string;
  transportMode: TransportMode;
  transportVehicleType: VehicleType;
  transportVehicleTypeDetail: string;
  transportPassengerCount: number;
  transportPickupDate: string;
  transportPickupTime: string;
  transportPickupLocationType: LocationType;
  transportPickupLocationDetail: string;
  transportDropoffLocationType: LocationType;
  transportDropoffLocationDetail: string;
  transportReturnDate: string;
  transportReturnTime: string;
  transportDays: number;
  hotelPartnerId: string;
  hotelCheckinDate: string;
  hotelCheckoutDate: string;
  roomQuantity: number;
  customerName: string;
  customerPhone: string;
  customerLine: string;
  country: '' | 'Laos' | 'Thailand' | 'Other';
  attachment: File | null;
}

const initialState: FormState = {
  tripDate: '',
  tripTime: '',
  needTransport: false,
  needHotel: false,
  transportPartnerId: '',
  transportMode: 'one_way',
  transportVehicleType: '',
  transportVehicleTypeDetail: '',
  transportPassengerCount: 1,
  transportPickupDate: '',
  transportPickupTime: '',
  transportPickupLocationType: '',
  transportPickupLocationDetail: '',
  transportDropoffLocationType: '',
  transportDropoffLocationDetail: '',
  transportReturnDate: '',
  transportReturnTime: '',
  transportDays: 1,
  hotelPartnerId: '',
  hotelCheckinDate: '',
  hotelCheckoutDate: '',
  roomQuantity: 1,
  customerName: '',
  customerPhone: '',
  customerLine: '',
  country: '',
  attachment: null,
};

// Resolves a pickup/dropoff selection into the free-text string sent
// to the backend and shown to staff/drivers. Identical to
// BookingForm.tsx's helper.
function resolveLocationLabel(
  type: LocationType,
  detail: string,
  t: (key: string) => string
): string {
  const trimmed = detail.trim();
  switch (type) {
    case 'nongkhai_bridge':
      return t('fields.locationNongkhaiBridge');
    case 'nakhon_phanom_bridge':
      return t('fields.locationNakhonPhanomBridge');
    case 'mukdahan_bridge':
      return t('fields.locationMukdahanBridge');
    case 'chong_mek':
      return t('fields.locationChongMek');
    case 'udon_airport':
      return t('fields.locationUdonAirport');
    case 'hotel':
      return trimmed ? `${t('fields.locationHotel')}: ${trimmed}` : t('fields.locationHotel');
    case 'other':
      return trimmed || t('fields.locationOther');
    case 'per_itinerary':
      return t('fields.locationPerItinerary');
    default:
      return '';
  }
}

// Resolves the vehicle type dropdown into the free-text value stored
// in order_items.vehicle_type. Identical to BookingForm.tsx's helper.
function resolveVehicleType(type: VehicleType, detail: string): string | null {
  if (type === 'other') return detail.trim() || null;
  if (type === '') return null;
  return type;
}

// Display label for the review step. Identical to BookingForm.tsx's helper.
function vehicleTypeLabel(type: VehicleType, detail: string, t: (key: string) => string): string {
  switch (type) {
    case 'sedan':
      return t('fields.vehicleTypeSedan');
    case 'suv':
      return t('fields.vehicleTypeSuv');
    case 'vip_van':
      return t('fields.vehicleTypeVipVan');
    case 'medical_transport':
      return t('fields.vehicleTypeMedicalTransport');
    case 'other':
      return detail.trim() || t('fields.locationOther');
    default:
      return '';
  }
}

function formatDisplayDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function packagePrice(pkg: Package | undefined): number {
  if (!pkg) return 0;
  return Number((pkg.special_price as number) ?? (pkg.original_price as number) ?? 0);
}

function calcNights(checkin: string, checkout: string): number {
  if (!checkin || !checkout) return 0;
  const start = new Date(checkin);
  const end = new Date(checkout);
  const diffMs = end.getTime() - start.getTime();
  if (Number.isNaN(diffMs) || diffMs <= 0) return 0;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export function JourneyBookingForm({
  hotelOptions,
  transportOptions,
}: {
  hotelOptions: Package[];
  transportOptions: Package[];
}) {
  const t = useTranslations('booking');
  const tj = useTranslations('journey');
  const { items: journeyItems, clear: clearJourney } = useJourney();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(initialState);
  // Client-side province filter for the hotel step — filters
  // hotelOptions in the browser rather than re-querying, since the
  // hotel list here is still small (see src/lib/province.ts for the
  // "กรุงเทพฯ" vs "กรุงเทพ" normalization this relies on). Revisit with
  // a server-side province param on fetchPackagesByCategory if the
  // partner count grows into the hundreds.
  const [hotelProvinceFilter, setHotelProvinceFilter] = useState<string>('all');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachmentWarning, setAttachmentWarning] = useState(false);
  const [done, setDone] = useState(false);
  const [orderResult, setOrderResult] = useState<{
    order_number: string;
    total_deposit_required: number;
    currency: string;
    payment_access_token?: string;
  } | null>(null);
  // Same reasoning as BookingForm.tsx — stable id across retries of
  // one booking attempt, see route.ts / migration 036.
  const clientRequestIdRef = useRef<string | null>(null);
  if (clientRequestIdRef.current === null) {
    clientRequestIdRef.current = crypto.randomUUID();
  }

  // Same step-splitting as BookingForm.tsx — see comment there.
  type StepKey = 'schedule' | 'transport' | 'hotel' | 'contact' | 'review';
  const stepKeys = useMemo<StepKey[]>(() => {
    const keys: StepKey[] = ['schedule'];
    if (form.needTransport) keys.push('transport');
    if (form.needHotel) keys.push('hotel');
    keys.push('contact', 'review');
    return keys;
  }, [form.needTransport, form.needHotel]);

  const totalSteps = stepKeys.length;
  const currentStepKey = stepKeys[step - 1] ?? 'schedule';

  const selectedHotel = hotelOptions.find((p) => p.id === form.hotelPartnerId);
  const selectedTransport = transportOptions.find((p) => p.id === form.transportPartnerId);

  // Distinct hotel provinces, derived from hotelOptions' joined partner
  // row (see fetchPackagesByCategory's province select) and normalized
  // so alias spellings collapse into one dropdown option.
  const hotelProvinces = useMemo(
    () => distinctProvinces(hotelOptions.map((pkg) => (pkg.partners as { province?: string | null } | undefined) ?? {})),
    [hotelOptions]
  );

  // hotelOptions narrowed by the province filter above — feeds hotelGroups
  // below, same "filter first, then group" order as the admin panel.
  const hotelOptionsInProvince = useMemo(() => {
    if (hotelProvinceFilter === 'all') return hotelOptions;
    return hotelOptions.filter(
      (pkg) => normalizeProvince((pkg.partners as { province?: string | null } | undefined)?.province) === hotelProvinceFilter
    );
  }, [hotelOptions, hotelProvinceFilter]);

  // Group hotel room packages by their hotel (partner) — same approach as
  // BookingForm.tsx, keep both in sync if this grouping logic changes.
  const hotelGroups = useMemo(() => {
    const groups = new Map<string, { label: string; options: Package[] }>();
    for (const pkg of hotelOptionsInProvince) {
      const partnerName = (pkg.partners as { name?: string } | undefined)?.name;
      const key = partnerName || pkg.partner_id;
      const label = partnerName || 'โรงแรม';
      if (!groups.has(key)) groups.set(key, { label, options: [] });
      groups.get(key)!.options.push(pkg);
    }
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label, 'th'));
  }, [hotelOptionsInProvince]);

  const hotelNights = useMemo(
    () => calcNights(form.hotelCheckinDate, form.hotelCheckoutDate),
    [form.hotelCheckinDate, form.hotelCheckoutDate]
  );

  const mainTotal = useMemo(
    () => journeyItems.reduce((sum, i) => sum + (i.price || 0), 0),
    [journeyItems]
  );

  const priceBreakdown = useMemo(() => {
    const hotel = form.needHotel
      ? packagePrice(selectedHotel) * hotelNights * (form.roomQuantity || 1)
      : 0;
    const transport =
      form.needTransport && form.transportMode === 'daily'
        ? packagePrice(selectedTransport) * (form.transportDays || 1)
        : form.needTransport
          ? packagePrice(selectedTransport)
          : 0;
    return { main: mainTotal, hotel, transport, total: mainTotal + hotel + transport };
  }, [
    mainTotal,
    form.needHotel,
    hotelNights,
    form.roomQuantity,
    form.needTransport,
    form.transportMode,
    form.transportDays,
    selectedHotel,
    selectedTransport,
  ]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validateStep(key: StepKey): boolean {
    setError(null);
    if (key === 'schedule') {
      if (!form.tripDate || !form.tripTime) {
        setError(t('errorSchedule'));
        return false;
      }
      return true;
    }
    if (key === 'transport') {
      if (!form.transportVehicleType || (form.transportVehicleType === 'other' && !form.transportVehicleTypeDetail.trim())) {
        setError(t('errorVehicleType'));
        return false;
      }
      if (!form.transportPassengerCount || form.transportPassengerCount <= 0) {
        setError(t('errorPassengerCount'));
        return false;
      }
      const pickupNeedsDetail =
        form.transportPickupLocationType === 'hotel' || form.transportPickupLocationType === 'other';
      if (!form.transportPickupLocationType || (pickupNeedsDetail && !form.transportPickupLocationDetail.trim())) {
        setError(t('errorPickupLocation'));
        return false;
      }
      const dropoffNeedsDetail =
        form.transportDropoffLocationType === 'hotel' || form.transportDropoffLocationType === 'other';
      if (!form.transportDropoffLocationType || (dropoffNeedsDetail && !form.transportDropoffLocationDetail.trim())) {
        setError(t('errorDropoffLocation'));
        return false;
      }
      return true;
    }
    if (key === 'hotel') {
      const nights = calcNights(form.hotelCheckinDate, form.hotelCheckoutDate);
      if (!form.hotelCheckinDate || !form.hotelCheckoutDate || nights <= 0) {
        setError(t('errorHotelDates'));
        return false;
      }
      return true;
    }
    if (key === 'contact') {
      if (!form.customerName.trim() || !form.customerPhone.trim() || !form.country) {
        setError(t('errorContact'));
        return false;
      }
      return true;
    }
    return true;
  }

  function next() {
    if (!validateStep(currentStepKey)) return;
    setStep((s) => Math.min(totalSteps, s + 1));
  }

  function back() {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  }

  async function handleSubmit() {
    const keysToCheck = stepKeys.filter((k) => k !== 'review');
    for (let i = 0; i < keysToCheck.length; i++) {
      if (!validateStep(keysToCheck[i])) {
        setStep(i + 1);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    setAttachmentWarning(false);

    try {
      // Attachment upload moved to AFTER order creation (migration 069)
      // — booking-attachments no longer accepts direct client uploads
      // before an order exists. See uploadBookingAttachment() below.
      const nights = calcNights(form.hotelCheckinDate, form.hotelCheckoutDate);

      // Every journey item shares the same trip date/time for now —
      // price/partner are still resolved server-side from package_id
      // exactly like the single-package flow, so this stays safe even
      // if the customer's cart is stale.
      const items: Record<string, unknown>[] = journeyItems.map((item) => ({
        package_id: item.id,
        quantity: 1,
        scheduled_date: form.tripDate,
        scheduled_time: form.tripTime,
      }));

      if (form.needHotel) {
        items.push({
          ...(form.hotelPartnerId
            ? { package_id: form.hotelPartnerId }
            : { service_type: 'hotel' as const }),
          quantity: nights || 1,
          room_quantity: form.roomQuantity || 1,
          scheduled_date: form.hotelCheckinDate || null,
          hotel_checkout_date: form.hotelCheckoutDate || null,
        });
      }

      if (form.needTransport) {
        items.push({
          ...(form.transportPartnerId
            ? { package_id: form.transportPartnerId }
            : { service_type: 'transport' as const }),
          quantity: form.transportMode === 'daily' ? form.transportDays || 1 : 1,
          scheduled_date: form.transportPickupDate || null,
          scheduled_time: form.transportPickupTime || null,
          transport_mode: form.transportMode,
          vehicle_type: resolveVehicleType(form.transportVehicleType, form.transportVehicleTypeDetail),
          passenger_count: form.transportPassengerCount || null,
          transport_return_date:
            form.transportMode === 'round_trip' ? form.transportReturnDate || null : null,
          transport_return_time:
            form.transportMode === 'round_trip' ? form.transportReturnTime || null : null,
          transport_pickup_location: resolveLocationLabel(
            form.transportPickupLocationType,
            form.transportPickupLocationDetail,
            t
          ),
          transport_dropoff_location: resolveLocationLabel(
            form.transportDropoffLocationType,
            form.transportDropoffLocationDetail,
            t
          ),
        });
      }

      const payload = {
        customer: {
          full_name: form.customerName.trim(),
          phone: form.customerPhone.trim(),
          line_id: form.customerLine.trim() || null,
          country: form.country,
        },
        items,
        attachment_url: null,
        client_request_id: clientRequestIdRef.current,
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result?.error ?? t('errorGeneric'));
      }

      // Order exists now — attach the file if the customer picked
      // one. A failure here does NOT roll back or fail the booking;
      // the order is already real. Best-effort, surfaced as a soft
      // warning only.
      if (form.attachment) {
        try {
          await uploadBookingAttachment(
            result.order_number,
            result.payment_access_token,
            form.attachment
          );
        } catch (attachErr) {
          console.error('attachment upload failed:', attachErr);
          setAttachmentWarning(true);
        }
      }

      setOrderResult({
        order_number: result.order_number,
        total_deposit_required: result.total_deposit_required,
        currency: result.currency,
        // Required by /my-trip/[orderNumber] and its /payment page —
        // order_number alone isn't a secret (predictable sequence),
        // so this token is what actually lets the customer (and only
        // the customer) view/pay their own order. See migration 021.
        // (Ported from BookingForm.tsx — this field was missing here,
        // which is why the payment link never showed up on this flow.)
        payment_access_token: result.payment_access_token,
      });
      setDone(true);
      clearJourney();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  if (journeyItems.length === 0 && !done) {
    return (
      <div className="card-shadow rounded-2xl border border-slate-100 bg-white p-8 text-center">
        <div className="mb-3 text-4xl">🧭</div>
        <h2 className="text-lg font-bold text-slate-900">{tj('emptyTitle')}</h2>
        <p className="mt-2 text-sm text-slate-500">{tj('emptyBody')}</p>
        <Link href="/" className="btn-primary mt-5 inline-flex justify-center text-base">
          {tj('emptyCta')}
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card-shadow rounded-2xl border border-slate-100 bg-white p-8 text-center">
        <div className="mb-3 text-4xl">✅</div>
        <h2 className="text-lg font-bold text-slate-900">{t('successTitle')}</h2>
        <p className="mt-2 text-sm text-slate-500">{t('successBody')}</p>
        {attachmentWarning ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {t('attachmentUploadFailedWarning')}
          </p>
        ) : null}
        {orderResult ? (
          <div className="mt-4 rounded-xl bg-primary-light/40 px-4 py-3 text-sm text-slate-600">
            <p className="font-medium text-slate-800">{orderResult.order_number}</p>
            <p className="mt-1">
              {t('summary.total')}: {formatTHB(orderResult.total_deposit_required)}{' '}
              {orderResult.currency}
            </p>
          </div>
        ) : null}
        {orderResult?.payment_access_token ? (
          <Link
            href={`/my-trip/${orderResult.order_number}?token=${encodeURIComponent(
              orderResult.payment_access_token
            )}`}
            className="mt-4 inline-block w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-white"
          >
            {t('viewOrderStatus')}
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card-shadow rounded-2xl border border-slate-100 bg-white p-6">
      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-2">
        {stepKeys.map((key, i) => {
          const n = i + 1;
          return (
            <div key={key} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  n <= step ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'
                }`}
              >
                {n}
              </div>
              {n < totalSteps ? (
                <div className={`h-0.5 flex-1 ${n < step ? 'bg-primary' : 'bg-slate-100'}`} />
              ) : null}
            </div>
          );
        })}
      </div>

      <h1 className="mb-1 text-lg font-bold text-slate-900">{tj('title')}</h1>
      <p className="mb-4 text-sm text-slate-400">
        {tj('itemsCount', { count: journeyItems.length })} · {formatTHB(mainTotal)}
      </p>

      {/* Selected journey items list — shown on every step so the
          customer always sees what's included in this Master Booking */}
      <ul className="mb-6 space-y-2">
        {journeyItems.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 rounded-xl border border-slate-100 p-2"
          >
            {item.image_url ? (
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg">
                <Image
                  src={normalizeImageSrc(item.image_url)}
                  alt={item.title}
                  fill
                  className="object-cover"
                  sizes="40px"
                />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
              {item.partnerName ? (
                <p className="truncate text-xs text-slate-400">{item.partnerName}</p>
              ) : null}
            </div>
            <span className="shrink-0 text-sm font-semibold text-slate-700">
              {formatTHB(item.price)}
            </span>
          </li>
        ))}
      </ul>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {/* Step: shared trip date/time + opt-in toggles only. Transport/
          hotel details moved to their own dedicated steps below. */}
      {currentStepKey === 'schedule' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">{tj('tripDate')} *</label>
              <DatePicker
                value={form.tripDate}
                onChange={(v) => update('tripDate', v)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div>
              <label className="form-label">{tj('tripTime')} *</label>
              <TimePicker value={form.tripTime} onChange={(v) => update('tripTime', v)} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={form.needTransport}
              onChange={(e) => update('needTransport', e.target.checked)}
            />
            {t('fields.needTransport')}
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={form.needHotel}
              onChange={(e) => update('needHotel', e.target.checked)}
            />
            {t('fields.needHotel')}
          </label>
        </div>
      ) : null}

      {/* Step: transport details — only reachable when needTransport is on */}
      {currentStepKey === 'transport' ? (
        <div className="space-y-4">
          {/* Vehicle type + passenger count asked up front, independent
              of which Partner ends up fulfilling the trip — see
              migration 037. Kept identical to BookingForm.tsx. */}
          <div>
            <label className="form-label">{t('fields.vehicleType')} *</label>
            <select
              className="form-input"
              value={form.transportVehicleType}
              onChange={(e) => update('transportVehicleType', e.target.value as VehicleType)}
            >
              <option value="">{t('fields.select')}</option>
              <option value="sedan">{t('fields.vehicleTypeSedan')}</option>
              <option value="suv">{t('fields.vehicleTypeSuv')}</option>
              <option value="vip_van">{t('fields.vehicleTypeVipVan')}</option>
              <option value="medical_transport">{t('fields.vehicleTypeMedicalTransport')}</option>
              <option value="other">{t('fields.locationOther')}</option>
            </select>
            {form.transportVehicleType === 'other' ? (
              <input
                type="text"
                className="form-input mt-2"
                placeholder={t('fields.vehicleTypeOtherPlaceholder')}
                value={form.transportVehicleTypeDetail}
                onChange={(e) => update('transportVehicleTypeDetail', e.target.value)}
              />
            ) : null}
          </div>
          <div>
            <label className="form-label">{t('fields.passengerCount')} *</label>
            <input
              type="number"
              min={1}
              className="form-input"
              value={form.transportPassengerCount}
              onChange={(e) => update('transportPassengerCount', parseInt(e.target.value, 10) || 1)}
            />
          </div>

          <select
            className="form-input"
            value={form.transportPartnerId}
            onChange={(e) => update('transportPartnerId', e.target.value)}
          >
            <option value="">{t('fields.letTeamDecide')}</option>
            {transportOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title as string}
              </option>
            ))}
          </select>
          <select
            className="form-input"
            value={form.transportMode}
            onChange={(e) => update('transportMode', e.target.value as TransportMode)}
          >
            <option value="one_way">{t('fields.oneWay')}</option>
            <option value="round_trip">{t('fields.roundTrip')}</option>
            <option value="daily">{t('fields.daily')}</option>
            <option value="medical_assistance">{t('fields.medicalAssistance')}</option>
          </select>

          <div className="space-y-3 rounded-lg border border-primary/20 bg-white p-3">
            <p className="text-sm font-semibold text-primary-dark">{t('fields.pickupSectionTitle')}</p>
            <div>
              <label className="form-label">{t('fields.pickupLocation')} *</label>
              <select
                className="form-input"
                value={form.transportPickupLocationType}
                onChange={(e) => update('transportPickupLocationType', e.target.value as LocationType)}
              >
                <option value="">{t('fields.select')}</option>
                <option value="nongkhai_bridge">{t('fields.locationNongkhaiBridge')}</option>
                <option value="nakhon_phanom_bridge">{t('fields.locationNakhonPhanomBridge')}</option>
                <option value="mukdahan_bridge">{t('fields.locationMukdahanBridge')}</option>
                <option value="chong_mek">{t('fields.locationChongMek')}</option>
                <option value="udon_airport">{t('fields.locationUdonAirport')}</option>
                <option value="hotel">{t('fields.locationHotel')}</option>
                <option value="other">{t('fields.locationOther')}</option>
              </select>
              {form.transportPickupLocationType === 'hotel' || form.transportPickupLocationType === 'other' ? (
                <input
                  type="text"
                  className="form-input mt-2"
                  placeholder={
                    form.transportPickupLocationType === 'hotel'
                      ? t('fields.locationHotelPlaceholder')
                      : t('fields.locationOtherPlaceholder')
                  }
                  value={form.transportPickupLocationDetail}
                  onChange={(e) => update('transportPickupLocationDetail', e.target.value)}
                />
              ) : null}
            </div>
            <div className="space-y-2">
              <DatePicker
                value={form.transportPickupDate}
                onChange={(v) => update('transportPickupDate', v)}
                min={new Date().toISOString().slice(0, 10)}
              />
              <TimePicker
                value={form.transportPickupTime}
                onChange={(v) => update('transportPickupTime', v)}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-primary/20 bg-white p-3">
            <p className="text-sm font-semibold text-primary-dark">{t('fields.dropoffSectionTitle')}</p>
            <div>
              <label className="form-label">{t('fields.dropoffLocation')} *</label>
              <select
                className="form-input"
                value={form.transportDropoffLocationType}
                onChange={(e) => update('transportDropoffLocationType', e.target.value as LocationType)}
              >
                <option value="">{t('fields.select')}</option>
                {/* Follows whatever drop-off the booked itinerary already
                    implies — lets the customer skip picking a specific
                    point when one isn't needed. */}
                <option value="per_itinerary">{t('fields.locationPerItinerary')}</option>
                <option value="nongkhai_bridge">{t('fields.locationNongkhaiBridge')}</option>
                <option value="nakhon_phanom_bridge">{t('fields.locationNakhonPhanomBridge')}</option>
                <option value="mukdahan_bridge">{t('fields.locationMukdahanBridge')}</option>
                <option value="chong_mek">{t('fields.locationChongMek')}</option>
                <option value="udon_airport">{t('fields.locationUdonAirport')}</option>
                <option value="hotel">{t('fields.locationHotel')}</option>
                <option value="other">{t('fields.locationOther')}</option>
              </select>
              {form.transportDropoffLocationType === 'hotel' || form.transportDropoffLocationType === 'other' ? (
                <input
                  type="text"
                  className="form-input mt-2"
                  placeholder={
                    form.transportDropoffLocationType === 'hotel'
                      ? t('fields.locationHotelPlaceholder')
                      : t('fields.locationOtherPlaceholder')
                  }
                  value={form.transportDropoffLocationDetail}
                  onChange={(e) => update('transportDropoffLocationDetail', e.target.value)}
                />
              ) : null}
            </div>
            {/* Intentionally no date/time here — arrival time at
                the drop-off point isn't something the customer
                can set themselves (depends on route/traffic from
                the pickup time above). */}
          </div>

          {form.transportMode === 'round_trip' ? (
            <div className="space-y-3 rounded-lg border border-primary/20 bg-white p-3">
              <p className="text-sm font-semibold text-primary-dark">{t('fields.returnSectionTitle')}</p>
              <div className="space-y-2">
                <DatePicker
                  value={form.transportReturnDate}
                  onChange={(v) => update('transportReturnDate', v)}
                  min={form.transportPickupDate || new Date().toISOString().slice(0, 10)}
                />
                <TimePicker
                  value={form.transportReturnTime}
                  onChange={(v) => update('transportReturnTime', v)}
                />
              </div>
            </div>
          ) : null}
          {form.transportMode === 'daily' ? (
            <input
              type="number"
              min={1}
              className="form-input"
              value={form.transportDays}
              onChange={(e) => update('transportDays', parseInt(e.target.value, 10) || 1)}
            />
          ) : null}
        </div>
      ) : null}

      {/* Step: hotel details — only reachable when needHotel is on */}
      {currentStepKey === 'hotel' ? (
        <div className="space-y-4">
          {hotelProvinces.length > 1 ? (
            <select
              className="form-input"
              aria-label={t('fields.filterByProvince')}
              value={hotelProvinceFilter}
              onChange={(e) => {
                const nextProvince = e.target.value;
                setHotelProvinceFilter(nextProvince);
                // If the currently-picked hotel package falls outside the
                // newly chosen province, clear it — otherwise the review
                // step could show a hotel that no longer matches the
                // visible dropdown options.
                if (nextProvince !== 'all' && form.hotelPartnerId) {
                  const current = hotelOptions.find((p) => p.id === form.hotelPartnerId);
                  const currentProvince = normalizeProvince(
                    (current?.partners as { province?: string | null } | undefined)?.province
                  );
                  if (currentProvince !== nextProvince) {
                    update('hotelPartnerId', '');
                  }
                }
              }}
            >
              <option value="all">{t('fields.allProvinces')}</option>
              {hotelProvinces.map((prov) => (
                <option key={prov} value={prov}>
                  {prov}
                </option>
              ))}
            </select>
          ) : null}

          <select
            className="form-input"
            value={form.hotelPartnerId}
            onChange={(e) => update('hotelPartnerId', e.target.value)}
          >
            <option value="">{t('fields.letTeamDecide')}</option>
            {hotelGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title as string} · {formatTHB(packagePrice(p))}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('fields.hotelCheckin')} *</label>
              <DatePicker
                value={form.hotelCheckinDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(newCheckin) => {
                  update('hotelCheckinDate', newCheckin);
                  if (form.hotelCheckoutDate && calcNights(newCheckin, form.hotelCheckoutDate) <= 0) {
                    update('hotelCheckoutDate', '');
                  }
                }}
              />
            </div>
            <div>
              <label className="form-label">{t('fields.hotelCheckout')} *</label>
              <DatePicker
                value={form.hotelCheckoutDate}
                min={form.hotelCheckinDate || undefined}
                onChange={(v) => update('hotelCheckoutDate', v)}
              />
            </div>
          </div>

          <div>
            <label className="form-label">{t('fields.roomQuantity')}</label>
            <select
              className="form-input"
              value={form.roomQuantity}
              onChange={(e) => update('roomQuantity', Number(e.target.value))}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {hotelNights > 0 ? (
            <p className="text-sm font-medium text-primary-dark">
              {t('summary.nightsCount', { count: hotelNights })}
              {form.roomQuantity > 1
                ? ` · ${t('summary.roomsCount', { count: form.roomQuantity })}`
                : ''}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Step: contact info + attachment */}
      {currentStepKey === 'contact' ? (
        <div className="space-y-5">
          <div>
            <label className="form-label">{t('fields.name')} *</label>
            <input
              type="text"
              className="form-input"
              value={form.customerName}
              onChange={(e) => update('customerName', e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">{t('fields.phone')} *</label>
            <input
              type="tel"
              className="form-input"
              value={form.customerPhone}
              onChange={(e) => update('customerPhone', e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">{t('fields.line')}</label>
            <input
              type="text"
              className="form-input"
              value={form.customerLine}
              onChange={(e) => update('customerLine', e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">{t('fields.country')} *</label>
            <select
              className="form-input"
              value={form.country}
              onChange={(e) => update('country', e.target.value as FormState['country'])}
            >
              <option value="">{t('fields.select')}</option>
              <option value="Laos">Laos / ลาว / ລາວ</option>
              <option value="Thailand">Thailand / ไทย / ໄທ</option>
              <option value="Other">{t('fields.other')}</option>
            </select>
          </div>
          <div>
            <label className="form-label">{t('fields.attachment')}</label>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="form-input"
              onChange={(e) => update('attachment', e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
      ) : null}

      {/* Step: review + price summary + submit */}
      {currentStepKey === 'review' ? (
        <div className="space-y-5">
          <div className="space-y-1 rounded-2xl border border-primary/10 bg-primary-light/60 px-5 py-4 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>{tj('itemsCount', { count: journeyItems.length })}</span>
              <span className="font-medium text-slate-800">{formatTHB(priceBreakdown.main)}</span>
            </div>
            {form.needHotel ? (
              <div className="flex justify-between text-slate-600">
                <span>
                  🏨 {t('summary.hotel')}
                  {hotelNights > 0
                    ? ` (${t('summary.nightsCount', { count: hotelNights })}${
                        form.roomQuantity > 1
                          ? ` · ${t('summary.roomsCount', { count: form.roomQuantity })}`
                          : ''
                      })`
                    : ''}
                </span>
                <span className="font-medium text-slate-800">{formatTHB(priceBreakdown.hotel)}</span>
              </div>
            ) : null}
            {form.needTransport ? (
              <div className="flex justify-between text-slate-600">
                <span>🚗 {t('summary.transport')}</span>
                <span className="font-medium text-slate-800">
                  {formatTHB(priceBreakdown.transport)}
                </span>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between border-t border-primary/20 pt-2 text-base font-bold text-slate-900">
              <span>{t('summary.total')}</span>
              <span>{formatTHB(priceBreakdown.total)}</span>
            </div>
            <p className="pt-1 text-xs text-slate-400">{t('summary.disclaimer')}</p>
          </div>

          <div className="space-y-1 rounded-xl border border-slate-100 px-4 py-3 text-sm text-slate-600">
            <p>
              {t('summary.reviewDate')}: {formatDisplayDate(form.tripDate)} {form.tripTime}
            </p>
            <p>
              {t('summary.reviewContact')}: {form.customerName} · {form.customerPhone}
            </p>
            {form.needTransport ? (
              <>
                <p>
                  {t('fields.vehicleType')}:{' '}
                  {vehicleTypeLabel(form.transportVehicleType, form.transportVehicleTypeDetail, t)}
                  {' · '}
                  {t('fields.passengerCount')}: {form.transportPassengerCount}
                </p>
                <p>
                  {t('fields.pickupLocation')}:{' '}
                  {resolveLocationLabel(form.transportPickupLocationType, form.transportPickupLocationDetail, t)}
                </p>
                <p>
                  {t('fields.dropoffLocation')}:{' '}
                  {resolveLocationLabel(form.transportDropoffLocationType, form.transportDropoffLocationDetail, t)}
                </p>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Navigation */}
      <div className="mt-8 flex gap-3">
        {step > 1 ? (
          <button
            type="button"
            onClick={back}
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600"
          >
            {t('back')}
          </button>
        ) : null}
        {step < totalSteps ? (
          <button
            type="button"
            onClick={next}
            className="btn-primary flex-1 justify-center text-base"
          >
            {t('continue')}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary flex-1 justify-center text-base disabled:opacity-60"
          >
            {submitting ? t('submitting') : t('confirm')}
          </button>
        )}
      </div>
    </div>
  );
}
