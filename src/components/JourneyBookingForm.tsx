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

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { formatTHB } from '@/lib/format';
import { normalizeImageSrc } from '@/lib/image';
import type { Package } from '@/lib/data';
import { DatePicker } from '@/components/ui/DatePicker';
import { TimePicker } from '@/components/ui/TimePicker';
import { Link } from '@/i18n/navigation';
import { useJourney } from '@/lib/journey/context';
import Image from 'next/image';

type TransportMode = 'one_way' | 'round_trip' | 'daily';

interface FormState {
  tripDate: string;
  tripTime: string;
  needTransport: boolean;
  needHotel: boolean;
  transportPartnerId: string;
  transportMode: TransportMode;
  transportPickupDate: string;
  transportPickupTime: string;
  transportReturnDate: string;
  transportReturnTime: string;
  transportDays: number;
  hotelPartnerId: string;
  hotelCheckinDate: string;
  hotelCheckoutDate: string;
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
  transportPickupDate: '',
  transportPickupTime: '',
  transportReturnDate: '',
  transportReturnTime: '',
  transportDays: 1,
  hotelPartnerId: '',
  hotelCheckinDate: '',
  hotelCheckoutDate: '',
  customerName: '',
  customerPhone: '',
  customerLine: '',
  country: '',
  attachment: null,
};

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [orderResult, setOrderResult] = useState<{
    order_number: string;
    total_deposit_required: number;
    currency: string;
  } | null>(null);

  const totalSteps = 3;

  const selectedHotel = hotelOptions.find((p) => p.id === form.hotelPartnerId);
  const selectedTransport = transportOptions.find((p) => p.id === form.transportPartnerId);

  const hotelNights = useMemo(
    () => calcNights(form.hotelCheckinDate, form.hotelCheckoutDate),
    [form.hotelCheckinDate, form.hotelCheckoutDate]
  );

  const mainTotal = useMemo(
    () => journeyItems.reduce((sum, i) => sum + (i.price || 0), 0),
    [journeyItems]
  );

  const priceBreakdown = useMemo(() => {
    const hotel = form.needHotel ? packagePrice(selectedHotel) * hotelNights : 0;
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
    form.needTransport,
    form.transportMode,
    form.transportDays,
    selectedHotel,
    selectedTransport,
  ]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validateStep(n: number): boolean {
    setError(null);
    if (n === 1) {
      if (!form.tripDate || !form.tripTime) {
        setError(t('errorSchedule'));
        return false;
      }
      if (form.needHotel) {
        const nights = calcNights(form.hotelCheckinDate, form.hotelCheckoutDate);
        if (!form.hotelCheckinDate || !form.hotelCheckoutDate || nights <= 0) {
          setError(t('errorHotelDates'));
          return false;
        }
      }
    }
    if (n === 2) {
      if (!form.customerName.trim() || !form.customerPhone.trim() || !form.country) {
        setError(t('errorContact'));
        return false;
      }
    }
    return true;
  }

  function next() {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(totalSteps, s + 1));
  }

  function back() {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  }

  async function handleSubmit() {
    if (!validateStep(1) || !validateStep(2)) {
      setStep(!validateStep(1) ? 1 : 2);
      return;
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
        {orderResult ? (
          <div className="mt-4 rounded-xl bg-primary-light/40 px-4 py-3 text-sm text-slate-600">
            <p className="font-medium text-slate-800">{orderResult.order_number}</p>
            <p className="mt-1">
              {t('summary.total')}: {formatTHB(orderResult.total_deposit_required)}{' '}
              {orderResult.currency}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card-shadow rounded-2xl border border-slate-100 bg-white p-6">
      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-2">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                n <= step ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {n}
            </div>
            {n < 3 ? (
              <div className={`h-0.5 flex-1 ${n < step ? 'bg-primary' : 'bg-slate-100'}`} />
            ) : null}
          </div>
        ))}
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

      {/* Step 1: shared trip date/time + optional hotel/transport */}
      {step === 1 ? (
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

          {form.needTransport ? (
            <div className="space-y-4 rounded-xl bg-primary-light/40 p-4">
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
              {form.transportMode === 'round_trip' ? (
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

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={form.needHotel}
              onChange={(e) => update('needHotel', e.target.checked)}
            />
            {t('fields.needHotel')}
          </label>

          {form.needHotel ? (
            <div className="space-y-4 rounded-xl bg-primary-light/40 p-4">
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

              {hotelNights > 0 ? (
                <p className="text-sm font-medium text-primary">
                  {t('summary.nightsCount', { count: hotelNights })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Step 2: contact info + attachment */}
      {step === 2 ? (
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

      {/* Step 3: review + price summary + submit */}
      {step === 3 ? (
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
                  {hotelNights > 0 ? ` (${t('summary.nightsCount', { count: hotelNights })})` : ''}
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
