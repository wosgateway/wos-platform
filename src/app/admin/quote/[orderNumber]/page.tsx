'use client';

// src/app/admin/quote/[orderNumber]/page.tsx
//
// Admin-side mirror of the public quotation page a customer opens
// from the WhatsApp/LINE/SMS link. Shows the program + total/deposit,
// and lets staff confirm the order (draft -> pending_deposit) or
// print it. Deliberately lives outside src/app/[locale]/ — see
// middleware.ts's PUBLIC_NON_LOCALE_ROUTES — so it manages its own
// locale state rather than relying on a [locale] URL segment (see theimport { NextIntlClientProvider
// BUG FIX note below).
//
// Print button + print-friendly layout: "printing" the quotation just
// means window.print() on this page (no server-side PDF generation),
// so getting this right is a matter of (a) the page rendering in the
// correct language before print is triggered, and (b) print-only CSS
// (Tailwind `print:` variants) hiding interactive chrome and
// flattening card shadows/borders for print.
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import type { AbstractIntlMessages } from 'next-intl';
import thMessages from '@/messages/th.json';
import loMessages from '@/messages/lo.json';
import enMessages from '@/messages/en.json';

type ServiceType = 'clinic' | 'hotel' | 'transport' | 'wellness' | 'insurance';
type Locale = 'th' | 'lo' | 'en';

// BUG FIX: this page lives at /admin/quote/[orderNumber] — NOT under
// src/app/[locale]/ — and middleware.ts deliberately puts /admin in
// PUBLIC_NON_LOCALE_ROUTES, so it never passes through next-intl's
// middleware and never gets a locale segment in its URL. The old
// version of this file called useLocale()/useTranslations() assuming
// the NextIntlClientProvider from src/app/[locale]/layout.tsx was an
// ancestor — it isn't (src/app/admin/layout.tsx only renders
// <AdminGate>), so next-intl had no context to read and the language
// switcher had nothing to switch (at best it silently no-op'd and
// stayed on the default locale; at worst next-intl throws for missing
// context). Fix: keep locale as local component state and supply our
// own NextIntlClientProvider scoped to just this page, fed directly
// from the three messages JSON files — no dependency on URL routing.
const MESSAGES: Record<Locale, { quote: Record<string, unknown> }> = {
  th: thMessages as { quote: Record<string, unknown> },
  lo: loMessages as { quote: Record<string, unknown> },
  en: enMessages as { quote: Record<string, unknown> },
};

interface QuoteItem {
  id: string;
  service_type: ServiceType;
  price: number | null;
  // true while still awaiting admin assignment (migrations 013/014/
  // 036/037) — see src/app/[locale]/quote/[orderNumber]/page.tsx for
  // the full rationale; kept in sync here since this is that page's
  // admin-side mirror.
  needs_assignment: boolean | null;
  quantity: number | null;
  room_quantity: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  hotel_checkout_date: string | null;
  transport_mode: string | null;
  transport_return_date: string | null;
  transport_return_time: string | null;
  pickup_location: string | null;
  dropoff_location: string | null;
  package: { title: string } | null;
  partner: { name: string } | null;
}

// Same convention as BookingForm.tsx's calcNights: number of nights
// between two YYYY-MM-DD date strings, 0 if either is missing or the
// range is invalid (never render a bogus night count).
function calcNights(checkin: string | null, checkout: string | null): number {
  if (!checkin || !checkout) return 0;
  const start = new Date(checkin);
  const end = new Date(checkout);
  const diffMs = end.getTime() - start.getTime();
  if (Number.isNaN(diffMs) || diffMs <= 0) return 0;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

interface Quote {
  order_number: string;
  status: string;
  currency: string | null;
  total_amount: number | null;
  total_deposit_required: number | null;
  total_deposit_paid: number | null;
  total_balance_remaining: number | null;
  customer_name: string | null;
  items: QuoteItem[];
}

const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'th', label: 'ไทย' },
  { value: 'lo', label: 'ລາວ' },
  { value: 'en', label: 'English' },
];

function formatMoney(amount: number | null, currency: string | null) {
  // th-TH grouping (1,234) reads fine for lo/en too — this project
  // doesn't localize number formatting elsewhere (see
  // BookingsManager.tsx's formatTHB), so keeping one formatter here
  // avoids introducing a second convention. Revisit if lo/en number
  // formatting is ever explicitly requested.
  const value = (amount ?? 0).toLocaleString('th-TH');
  return `${value} ${currency || 'THB'}`;
}

export default function QuotePage() {
  // Locale lives here, in plain component state, instead of coming
  // from the URL/next-intl routing — this route has no [locale]
  // segment (see the BUG FIX note above the imports). Default 'th'
  // matches the rest of the non-locale admin surface.
  const [locale, setLocale] = useState<Locale>('th');

  return (
        <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as unknown as AbstractIntlMessages}>
      <QuoteContent locale={locale} onLocaleChange={setLocale} />
    </NextIntlClientProvider>
  );
}

function QuoteContent({
  locale,
  onLocaleChange,
}: {
  locale: Locale;
  onLocaleChange: (next: Locale) => void;
}) {
  const params = useParams();
  const orderNumber = params?.orderNumber as string;
  const searchParams = useSearchParams();
  // Required alongside order_number by /api/quote/[orderNumber] and
  // its /confirm sibling — order_number is a predictable sequence,
  // not a secret. See src/lib/orders/authorize-order.ts.
  const token = searchParams?.get('token') ?? '';
  const t = useTranslations('quote');

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
    clinic: t('serviceType.clinic'),
    wellness: t('serviceType.wellness'),
    insurance: t('serviceType.insurance'),
    hotel: t('serviceType.hotel'),
    transport: t('serviceType.transport'),
  };

  function itemLabel(item: QuoteItem): string {
    return [item.partner?.name, item.package?.title].filter(Boolean).join(' — ') || t('programFallback');
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/quote/${orderNumber}?token=${encodeURIComponent(token)}`);
        const result = await res.json();
        if (!res.ok) throw new Error(result?.error ?? t('errors.loadFailed'));
        setQuote(result.order);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown error');
      } finally {
        setLoading(false);
      }
    }
    if (orderNumber) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber, token]);

  async function handleConfirm() {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/quote/${orderNumber}/confirm?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? t('errors.confirmFailed'));
      setConfirmed(true);
      setQuote((prev) => (prev ? { ...prev, status: 'pending_deposit' } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setConfirming(false);
    }
  }

  function switchLocale(next: Locale) {
    if (next === locale) return;
    // No URL to change here (this route is intentionally locale-
    // prefix-free, see middleware.ts) — just re-render this subtree
    // under the other locale's NextIntlClientProvider.
    onLocaleChange(next);
  }

  function handlePrint() {
    window.print();
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-100" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (error && !quote) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      </div>
    );
  }

  if (!quote) return null;

  const canConfirm = quote.status === 'draft' && !confirmed;
  const isConfirmedOrLater = confirmed || quote.status !== 'draft';

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6 print:max-w-full print:p-0">
      {/* Locale switcher + print button — both interactive chrome,
          hidden on the printed page itself (print:hidden). */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex gap-1 rounded-full border border-slate-200 bg-white p-1">
          {LOCALE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => switchLocale(opt.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                locale === opt.value
                  ? 'bg-primary text-white'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={handlePrint}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-primary hover:bg-primary-light"
        >
          🖨️ {t('printButton')}
        </button>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <h1 className="text-lg font-bold text-slate-900">🏥 {t('title')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t('orderNumberLabel')}: {quote.order_number}
          {quote.customer_name ? ` · ${t('customerPrefix')}${quote.customer_name}` : ''}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm print:rounded-none print:border print:shadow-none">
        <h2 className="border-b border-slate-100 p-5 pb-3 text-sm font-bold text-slate-700 print:p-2 print:pb-2">
          {t('itemsHeading')}
        </h2>
        <div className="divide-y divide-slate-50">
          {quote.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between p-5 print:p-2">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>{SERVICE_TYPE_LABEL[item.service_type]}</span>
                  {item.needs_assignment ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 print:bg-transparent print:px-0 print:text-amber-700">
                      ⏳ {t('pendingAssignmentBadge')}
                    </span>
                  ) : null}
                </div>
                <div className="font-medium text-slate-800">{itemLabel(item)}</div>
                {item.scheduled_date ? (
                  <div className="text-xs text-slate-500">
                    {item.scheduled_date}
                    {item.service_type === 'hotel' && item.hotel_checkout_date
                      ? ` ${t('checkoutLabel')} ${item.hotel_checkout_date}`
                      : ` ${item.scheduled_time || ''}`}
                    {item.service_type === 'hotel' && item.hotel_checkout_date
                      ? ` · ${t('nightsLabel', { count: calcNights(item.scheduled_date, item.hotel_checkout_date) })}`
                      : null}
                  </div>
                ) : null}
                {item.service_type === 'hotel' && (item.room_quantity ?? 1) > 1 ? (
                  <div className="text-xs text-slate-500">{t('roomsLabel', { count: item.room_quantity })}</div>
                ) : null}
                {item.service_type === 'transport' ? (
                  <div className="text-xs text-slate-500">
                    {item.transport_mode === 'daily'
                      ? t('dailyLabel', { count: item.quantity || 1 })
                      : item.transport_mode === 'round_trip'
                      ? `${t('roundTripLabel')} · ${t('returnLabel')} ${item.transport_return_date || '-'} ${
                          item.transport_return_time || ''
                        }`.trim()
                      : t('oneWayLabel')}
                  </div>
                ) : null}
                {item.pickup_location || item.dropoff_location ? (
                  <div className="text-xs text-slate-400">
                    {item.pickup_location ? `${t('pickupLabel')} ${item.pickup_location}` : ''}
                    {item.pickup_location && item.dropoff_location ? ' · ' : ''}
                    {item.dropoff_location ? `${t('dropoffLabel')} ${item.dropoff_location}` : ''}
                  </div>
                ) : null}
              </div>
              <div className="font-semibold text-slate-900">
                {formatMoney(item.price, quote.currency)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {quote.items.some((item) => item.needs_assignment) ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:border print:border-amber-300">
          ⏳ {t('pendingAssignmentBanner')}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm print:rounded-none print:border print:p-2 print:shadow-none">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">{t('totalLabel')}</span>
          <span className="font-semibold text-slate-900">
            {formatMoney(quote.total_amount, quote.currency)}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between text-sm">
          <span className="text-slate-500">{t('depositRequiredLabel')}</span>
          <span className="font-semibold text-primary-dark print:text-slate-900">
            {formatMoney(quote.total_deposit_required, quote.currency)}
          </span>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 print:hidden">
          {error}
        </div>
      ) : null}

      {/* Confirm / status block and the "go to my-trip" CTA are both
          actions, not information the printed page needs to carry —
          hidden on print. */}
      {isConfirmedOrLater ? (
        <div className="space-y-3 print:hidden">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center text-sm text-emerald-700">
            ✅ {t('confirmedBanner')}
          </div>
          <Link
            href={`/my-trip/${orderNumber}`}
            className="block w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-white"
          >
            {t('goToMyTrip')} →
          </Link>
        </div>
      ) : (
        <button
          onClick={handleConfirm}
          disabled={!canConfirm || confirming}
          className="w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-white disabled:opacity-60 print:hidden"
        >
          {confirming ? t('confirming') : `✅ ${t('confirmButton')}`}
        </button>
      )}

      <p className="text-center text-xs text-slate-400 print:mt-4 print:text-slate-500">
        {t('contactLine')}
      </p>
    </div>
  );
}
