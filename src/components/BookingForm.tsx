'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { formatTHB } from '@/lib/format';
import type { Package } from '@/lib/data';
import { DatePicker } from '@/components/ui/DatePicker';
import { TimePicker } from '@/components/ui/TimePicker';
import { Link } from '@/i18n/navigation';

type TransportMode = 'one_way' | 'round_trip' | 'daily';

// Pickup/dropoff location: dropdown of the common Laos↔Thailand
// corridor points WOS actually sees, plus 'hotel' and 'other' which
// reveal a free-text input for the specific name/spot. Keeps common
// cases standardized (reporting, driver dispatch) while still
// covering the long tail of real pickup/dropoff spots.
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
  bookingDate: string;
  bookingTime: string;
  needTransport: boolean;
  needHotel: boolean;
  transportPartnerId: string;
  transportMode: TransportMode;
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
  bookingDate: '',
  bookingTime: '',
  needTransport: false,
  needHotel: false,
  transportPartnerId: '',
  transportMode: 'one_way',
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
// to the backend and shown to staff/drivers. 'hotel' and 'other' fall
// back to the label alone if the customer somehow leaves detail empty
// (validation normally prevents this before submit).
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

// Formats a YYYY-MM-DD string as วัน/เดือน/ปี (DD/MM/YYYY) for display only.
// The underlying form/payload value stays ISO (YYYY-MM-DD) — this is purely
// cosmetic for the review step.
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

// Calculates number of nights between two YYYY-MM-DD date strings.
// Returns 0 if either date is missing or checkout is not after checkin,
// so the UI/price never shows a bogus value while the customer is still
// picking dates.
function calcNights(checkin: string, checkout: string): number {
  if (!checkin || !checkout) return 0;
  const start = new Date(checkin);
  const end = new Date(checkout);
  const diffMs = end.getTime() - start.getTime();
  if (Number.isNaN(diffMs) || diffMs <= 0) return 0;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export function BookingForm({
  pkg,
  hotelOptions,
  transportOptions,
}: {
  pkg: Package;
  hotelOptions: Package[];
  transportOptions: Package[];
}) {
  const t = useTranslations('booking');
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [orderResult, setOrderResult] = useState<{
    order_number: string;
    total_deposit_required: number;
    currency: string;
    payment_access_token?: string;
  } | null>(null);

  // Step 1 used to cram schedule + transport (up to ~8 fields) + hotel
  // (up to ~4 fields) into one screen — up to 15-18 fields before the
  // customer could even reach step 2, especially painful on mobile.
  // Now each concern gets its own step, and transport/hotel steps only
  // exist at all when the customer actually opted into them.
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

  const hotelNights = useMemo(
    () => calcNights(form.hotelCheckinDate, form.hotelCheckoutDate),
    [form.hotelCheckinDate, form.hotelCheckoutDate]
  );

  const priceBreakdown = useMemo(() => {
    const main = packagePrice(pkg);
    const hotel = form.needHotel
      ? packagePrice(selectedHotel) * hotelNights * (form.roomQuantity || 1)
      : 0;
    const transport =
      form.needTransport && form.transportMode === 'daily'
        ? packagePrice(selectedTransport) * (form.transportDays || 1)
        : form.needTransport
          ? packagePrice(selectedTransport)
          : 0;
    return { main, hotel, transport, total: main + hotel + transport };
  }, [
    pkg,
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
      if (!form.bookingDate || !form.bookingTime) {
        setError(t('errorSchedule'));
        return false;
      }
      return true;
    }
    if (key === 'transport') {
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
    const supabase = createClient();

    try {
      let attachmentUrl: string | null = null;
      if (form.attachment) {
        const path = `${Date.now()}-${form.attachment.name}`;
        const { error: uploadError } = await supabase.storage
          .from('booking-attachments')
          .upload(path, form.attachment);
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('booking-attachments').getPublicUrl(path);
        attachmentUrl = data.publicUrl;
      }

      const nights = calcNights(form.hotelCheckinDate, form.hotelCheckoutDate);

      // Main package is always a resolved, priced item.
      const items: Record<string, unknown>[] = [
        {
          package_id: pkg.id,
          quantity: 1,
          scheduled_date: form.bookingDate,
          scheduled_time: form.bookingTime,
        },
      ];

      if (form.needHotel) {
        items.push({
          // Empty hotelPartnerId = "let team decide" -> send
          // service_type instead of package_id (see migration
          // 013/014). Otherwise send the chosen package_id.
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
        attachment_url: attachmentUrl,
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

      setOrderResult({
        order_number: result.order_number,
        total_deposit_required: result.total_deposit_required,
        currency: result.currency,
        // Required by /my-trip/[orderNumber] and its /payment page —
        // order_number alone isn't a secret (predictable sequence),
        // so this token is what actually lets the customer (and only
        // the customer) view/pay their own order. See migration 021.
        payment_access_token: result.payment_access_token,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="card-shadow rounded-2xl border border-slate-100 bg-white p-8 text-center">
        <div className="mb-3 text-4xl">✅</div>
        <h2 className="text-lg font-bold text-slate-900">{t('successTitle')}</h2>
        <p className="mt-2 text-sm text-slate-500">{t('successBody')}</p>
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

      <h1 className="mb-1 text-lg font-bold text-slate-900">{pkg.title as string}</h1>
      <p className="mb-6 text-sm text-slate-400">{formatTHB(packagePrice(pkg))}</p>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {/* Step: schedule + opt-in toggles only. Transport/hotel details
          moved to their own dedicated steps below. */}
      {currentStepKey === 'schedule' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t('fields.date')} *</label>
              <DatePicker
                value={form.bookingDate}
                onChange={(v) => update('bookingDate', v)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div>
              <label className="form-label">{t('fields.time')} *</label>
              <TimePicker
                value={form.bookingTime}
                onChange={(v) => update('bookingTime', v)}
              />
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
                    implies (e.g. next stop on plan) — lets the customer
                    skip picking a specific point when one isn't needed. */}
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
          <select
            className="form-input"
            value={form.hotelPartnerId}
            onChange={(e) => update('hotelPartnerId', e.target.value)}
          >
            <option value="">{t('fields.letTeamDecide')}</option>
            {hotelOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title as string}
              </option>
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
                  // If checkout is no longer after the new checkin, clear it
                  // so the customer can't submit an invalid range.
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
              <span>{t('summary.main')}</span>
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
              {t('summary.reviewDate')}: {formatDisplayDate(form.bookingDate)} {form.bookingTime}
            </p>
            <p>
              {t('summary.reviewContact')}: {form.customerName} · {form.customerPhone}
            </p>
            {form.needTransport ? (
              <>
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
