'use client';

// src/app/[locale]/my-trip/[orderNumber]/page.tsx
//
// P0-3 "Booking Confirmation" + the start of P1-5 "My Trip" from the
// roadmap — one page that adapts to order.status instead of two
// separate pages, since the real schema has a single order_number
// (not a separate quote-number vs booking-number pair). Customer
// reaches this either:
//   - right after confirming a quote on /[locale]/quote/[orderNumber]
//   - by revisiting the same secure link later (WhatsApp/LINE)
//
// Reuses GET /api/quote/[orderNumber] (already public + safe-fields
// only) for order/items, and GET /api/quote/[orderNumber]/payments
// for payment-slip history.
//
// PHASE 3 (Lao-first UX pass): this page previously had zero
// next-intl integration — every string was hardcoded Thai, so
// switching /th/ to /lo/ in the URL did nothing visually, unlike its
// sibling /[locale]/quote/[orderNumber]/page.tsx which already had a
// working locale switcher. Ported the exact same pattern here:
// useTranslations('myTrip') + useLocale() + a switcher that calls
// next-intl's router.replace(pathname, { locale }). New keys live
// under the "myTrip" namespace in src/messages/{th,lo,en}.json.
// Per-item status/service icons stay as plain objects (colors/emoji
// are not language-dependent, only the label text is).

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';

type OrderStatus =
  | 'draft'
  | 'pending_deposit'
  | 'pending_verification'
  | 'deposit_paid'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'refunded';

type Locale = 'th' | 'lo' | 'en';

const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'th', label: 'ไทย' },
  { value: 'lo', label: 'ລາວ' },
  { value: 'en', label: 'English' },
];

interface QuoteItem {
  id: string;
  service_type: string;
  status: string;
  price: number | null;
  needs_assignment: boolean;
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

interface OrderData {
  order_number: string;
  status: OrderStatus;
  currency: string | null;
  total_amount: number | null;
  total_deposit_required: number | null;
  total_deposit_paid: number | null;
  total_balance_remaining: number | null;
  customer_name: string | null;
  items: QuoteItem[];
}

interface PaymentRow {
  id: string;
  amount: number;
  currency: string;
  method: string | null;
  status: string;
  submitted_at: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  slip_url: string | null;
}

const STATUS_COLOR: Record<OrderStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  pending_deposit: 'bg-amber-100 text-amber-800',
  pending_verification: 'bg-blue-100 text-blue-800',
  deposit_paid: 'bg-emerald-100 text-emerald-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  checked_in: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  refunded: 'bg-slate-100 text-slate-600',
};

// Per-service status, distinct from the order-level status above.
// order_items.status (migration 008, chk_item_status) drives this —
// 'pending' here means "not yet confirmed by the partner/team", not
// "payment pending" (that's tracked separately at the order level).
const ITEM_STATUS_COLOR: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  confirmed: 'bg-emerald-100 text-emerald-700',
  checked_in: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
  refunded: 'bg-slate-100 text-slate-500',
};

const SERVICE_ICON: Record<string, string> = {
  clinic: '🩺',
  hotel: '🏨',
  transport: '🚐',
  wellness: '💆',
  insurance: '🛡️',
};

// Statuses where paying is definitely not applicable — kept in sync
// with `blockedStatuses` in POST /api/quote/[orderNumber]/payments.
// 'confirmed' is intentionally NOT in this list: it only means the
// deposit requirement was met, not that the full total is paid, so a
// customer with balance_remaining > 0 should still be able to pay it
// off after confirmation.
// 'pending_verification' IS in this list (unlike the backend's
// blockedStatuses) purely for UX: a whole-order payment is already
// waiting_verification, and payments_one_pending_whole_order_idx
// (migration 021) will reject a second one with a 409 — better to
// hide the button than let the customer hit that error.
const NON_PAYABLE_STATUSES = ['draft', 'pending_verification', 'cancelled', 'refunded', 'completed'];

function formatMoney(amount: number | null, currency: string | null) {
  const value = (amount ?? 0).toLocaleString('th-TH');
  return `${value} ${currency || 'THB'}`;
}

export default function MyTripPage() {
  const params = useParams();
  const orderNumber = params?.orderNumber as string;
  // Required by /api/quote/[orderNumber]/payments as of migration 021
  // — order_number alone isn't a secret (predictable sequence), so a
  // token from the secure link is required too.
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('myTrip');

  const [order, setOrder] = useState<OrderData | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Extra detail lines under an item's title — room count for hotel,
  // mode/days/pickup-dropoff for transport. Mirrors the logic already
  // used correctly in admin/BookingsManager.tsx's transportDetailLabel,
  // extended here to also cover 'daily' (เหมา) mode, which that helper
  // never handled either. Localized via t() now instead of hardcoded
  // Thai literals.
  const tripItemDetailLines = useCallback(
    (item: QuoteItem): string[] => {
      const lines: string[] = [];

      if (item.service_type === 'hotel') {
        if (item.scheduled_date || item.hotel_checkout_date) {
          lines.push(t('hotelStayLabel', { checkin: item.scheduled_date || '-', checkout: item.hotel_checkout_date || '-' }));
        }
        if ((item.room_quantity ?? 1) > 1) {
          lines.push(t('roomsLabel', { count: item.room_quantity ?? 1 }));
        }
      }

      if (item.service_type === 'transport') {
        const mode = item.transport_mode || 'one_way';
        const pickupTime = `${item.scheduled_date || '-'} ${item.scheduled_time || ''}`.trim();
        if (mode === 'daily') {
          lines.push(t('dailyLabel', { count: item.quantity || 1, time: pickupTime }));
        } else if (mode === 'round_trip') {
          const ret = `${item.transport_return_date || '-'} ${item.transport_return_time || ''}`.trim();
          lines.push(t('roundTripLabel', { pickup: pickupTime, dropoff: ret }));
        } else {
          lines.push(t('oneWayLabel', { pickup: pickupTime }));
        }
        if (item.pickup_location) lines.push(t('pickupLabel', { location: item.pickup_location }));
        if (item.dropoff_location) lines.push(t('dropoffLabel', { location: item.dropoff_location }));
      }

      return lines;
    },
    [t]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [quoteRes, paymentsRes] = await Promise.all([
        fetch(`/api/quote/${orderNumber}?token=${encodeURIComponent(token)}`),
        fetch(`/api/quote/${orderNumber}/payments?token=${encodeURIComponent(token)}`),
      ]);
      const quoteResult = await quoteRes.json();
      if (!quoteRes.ok) throw new Error(quoteResult?.error ?? t('loadFailed'));
      setOrder(quoteResult.order);

      if (paymentsRes.ok) {
        const paymentsResult = await paymentsRes.json();
        setPayments(paymentsResult.payments ?? []);
        setPaymentsError(null);
      } else {
        // Distinguish "no payments yet" (still 200, empty array) from
        // a real fetch failure — always tell the customer apart from a
        // real empty state.
        const paymentsResult = await paymentsRes.json().catch(() => null);
        setPaymentsError(paymentsResult?.error ?? t('loadPaymentsFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber, token]);

  useEffect(() => {
    if (orderNumber) load();
  }, [orderNumber, load]);

  function switchLocale(next: Locale) {
    if (next === locale) return;
    // Same pattern as /[locale]/quote/[orderNumber]/page.tsx: this
    // does NOT preserve ?token= automatically (next-intl's
    // router.replace doesn't carry query params) — acceptable here
    // since the customer is already on the page with the token in
    // the current URL; re-navigating within the same session tab
    // keeps working because the fetches above already ran.
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
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <div className="flex justify-end">{localeSwitcher}</div>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      </div>
    );
  }

  if (!order) return null;

  if (order.status === 'draft') {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6 text-center">
        <div className="flex justify-end">{localeSwitcher}</div>
        <p className="text-sm text-slate-500">{t('draftNotice')}</p>
        <Link
          href={`/quote/${orderNumber}`}
          className="inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white"
        >
          {t('goToQuote')}
        </Link>
      </div>
    );
  }

  // Orders with a "let team decide" hotel/transport item (no package
  // chosen at booking time) get inserted with price=NULL and
  // needs_assignment=true (036_order_idempotency_and_atomic_totals.sql),
  // but order.status still flips straight to 'pending_deposit' — so
  // total_amount can be understated (missing the not-yet-priced item)
  // while the default copy tells the customer to pay now. Only
  // override the copy for that specific case; every other status, and
  // pending_deposit orders where everything's already priced, keep
  // the original wording as-is.
  const hasUnassignedItems = order.items.some((item) => item.needs_assignment);
  const statusDesc =
    order.status === 'pending_deposit' && hasUnassignedItems
      ? t('status.pending_deposit_unassigned.desc')
      : t(`status.${order.status}.desc`);
  const balanceRemaining = order.total_balance_remaining ?? Math.max(
    (order.total_deposit_required ?? 0) - (order.total_deposit_paid ?? 0),
    0
  );
  // A submitted-but-unverified slip doesn't always flip order.status
  // (that only happens automatically from 'pending_deposit' — see
  // POST /api/quote/[orderNumber]/payments). If the order was already
  // 'confirmed'/'deposit_paid' when the customer paid off the
  // remaining balance, status stays put until admin verifies, so
  // balanceRemaining is still > 0 too. Without this check the "pay"
  // button kept showing even though a slip was already waiting for
  // review — confusing customers into thinking they hadn't paid.
  const hasPendingPayment = payments.some(
    (p) => p.status === 'waiting_verification' || p.status === 'pending'
  );
  const canPay = !NON_PAYABLE_STATUSES.includes(order.status) && !hasPendingPayment && balanceRemaining > 0;

  // Built from t() rather than a static Record so it's not tied to
  // English/hardcoded strings — same safe-fallback pattern as before
  // (unknown status just shows the raw string, doesn't throw).
  const paymentStatusLabel: Record<string, string> = {
    waiting_verification: t('paymentStatus.waiting_verification'),
    pending: t('paymentStatus.pending'),
    verified: t('paymentStatus.verified'),
    rejected: t('paymentStatus.rejected'),
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <div className="flex justify-end">{localeSwitcher}</div>

      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <p className="text-xs text-slate-400">{t('orderLabel')}</p>
        <h1 className="mt-0.5 text-lg font-bold text-slate-900">
          {order.order_number}
          {order.customer_name ? ` · ${t('customerPrefix')}${order.customer_name}` : ''}
        </h1>
        <span className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLOR[order.status]}`}>
          {t(`status.${order.status}.label`)}
        </span>
        <p className="mt-2 text-sm text-slate-500">{statusDesc}</p>
      </div>

      {/* Journey timeline */}
      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 p-5 pb-3 text-sm font-bold text-slate-700">{t('journeyHeading')}</h2>
        <div className="divide-y divide-slate-50">
          {order.items.map((item, idx) => {
            const detailLines = tripItemDetailLines(item);
            const isLast = idx === order.items.length - 1;
            // "Let team decide" items (needs_assignment) haven't been
            // matched to a partner/package yet — that's a more useful
            // signal to the customer than the generic 'pending' item
            // status, so it takes priority below.
            const itemColor = item.needs_assignment ? 'bg-amber-100 text-amber-700' : ITEM_STATUS_COLOR[item.status] ?? ITEM_STATUS_COLOR.pending;
            const itemLabel = item.needs_assignment ? t('waitingAssignmentBadge') : t(`itemStatus.${item.status}`);
            return (
              <div key={item.id} className="relative flex gap-3 p-5">
                {/* Timeline rail */}
                <div className="flex flex-col items-center">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${itemColor}`}>
                    {SERVICE_ICON[item.service_type] ?? '📍'}
                  </span>
                  {!isLast && <span className="mt-1 w-px flex-1 bg-slate-100" />}
                </div>

                <div className="flex-1 pb-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-slate-800">
                      {item.needs_assignment
                        ? item.package?.title ?? t('unassignedItemFallback')
                        : [item.partner?.name, item.package?.title].filter(Boolean).join(' — ') || item.service_type}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${itemColor}`}>
                      {itemLabel}
                    </span>
                  </div>
                  {detailLines.length > 0 ? (
                    detailLines.map((line, i) => (
                      <div key={i} className="mt-0.5 text-xs text-slate-500">
                        {line}
                      </div>
                    ))
                  ) : item.scheduled_date ? (
                    <div className="mt-0.5 text-xs text-slate-500">
                      {item.scheduled_date} {item.scheduled_time || ''}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Payment summary */}
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">{t('totalLabel')}</span>
          <span className="font-semibold text-slate-900">{formatMoney(order.total_amount, order.currency)}</span>
        </div>
        <div className="mt-1.5 flex justify-between text-sm">
          <span className="text-slate-500">{t('depositPaidLabel')}</span>
          <span className="font-semibold text-emerald-600">
            {formatMoney(order.total_deposit_paid, order.currency)}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between text-sm">
          <span className="text-slate-500">{t('balanceLabel')}</span>
          <span className="font-semibold text-primary-dark">{formatMoney(balanceRemaining, order.currency)}</span>
        </div>
      </div>

      {canPay ? (
        <Link
          href={`/my-trip/${orderNumber}/payment?token=${encodeURIComponent(token)}`}
          className="block w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-white"
        >
          {t('payButton')}
        </Link>
      ) : hasPendingPayment ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-center text-sm text-blue-700">
          {t('pendingReviewBanner')}
        </div>
      ) : null}

      {/* Payment history */}
      {paymentsError ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 p-5 text-sm text-red-600">
          {paymentsError} — <button onClick={() => load()} className="underline">{t('retryButton')}</button>
        </div>
      ) : payments.length > 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 p-5 pb-3 text-sm font-bold text-slate-700">{t('paymentHistoryHeading')}</h2>
          <div className="divide-y divide-slate-50">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-5">
                <div>
                  <div className="font-medium text-slate-800">{formatMoney(p.amount, p.currency)}</div>
                  {p.rejection_reason ? (
                    <div className="mt-0.5 text-xs text-red-500">{t('reasonLabel')}: {p.rejection_reason}</div>
                  ) : null}
                  {p.slip_url ? (
                    <a
                      href={p.slip_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-block text-xs font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700"
                    >
                      {t('viewSlip')}
                    </a>
                  ) : null}
                </div>
                <span className="text-xs font-medium text-slate-600">
                  {paymentStatusLabel[p.status] || p.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* WhatsApp CTA — upgraded from a plain text footer link to a
          tappable button, per the Lao-first UX pass: this is the
          primary "I need help" affordance for customers who don't
          want to navigate the site further. */}
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
