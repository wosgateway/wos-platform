'use client';

// src/app/[locale]/my-trip/[orderNumber]/payment/page.tsx
//
// P0-4 "Payment / Upload Slip" from the roadmap. Flow:
//   1. Customer picks currency + method (bank transfer / QR)
//   2. Sees the relevant account/QR details (see PAYMENT_INFO below)
//   3. Uploads a slip image/PDF — uploaded client-side straight to the
//      `payment-slips` Supabase Storage bucket (same pattern as
//      BookingForm.tsx's attachment upload), same as booking-attachments.
//   4. Submits { amount, currency, method, slip_url } to
//      POST /api/quote/[orderNumber]/payments
//
// No customer login — this page is only reachable via the secure
// order_number link, same trust model as /quote/[orderNumber].
//
// UPDATED:
//   - THB now has a real bank_transfer account (หจก. รอยัล บริดจ์ 99,
//     KBank 230-3-60611-7). LAK/USD only have a QR (BCEL/LAPNet
//     multi-currency wallet) — no bank_transfer details exist for
//     those yet, so the method picker below degrades gracefully
//     instead of showing blank/placeholder account fields.
//   - Access to this page is no longer limited to
//     pending_deposit/deposit_paid. It now mirrors the backend's
//     blockedStatuses in /api/quote/[orderNumber]/payments (draft /
//     cancelled / refunded / completed), so a customer who still has
//     a balance_remaining after the order is 'confirmed' (deposit met
//     but total not fully paid) can still reach this page and pay it
//     off — previously this was blocked here even though the API
//     itself already allowed it.

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Link } from '@/i18n/navigation';

type Currency = 'THB' | 'LAK' | 'USD';
type Method = 'bank_transfer' | 'qr';

interface OrderSummary {
  order_number: string;
  status: string;
  currency: string | null;
  total_deposit_required: number | null;
  total_deposit_paid: number | null;
  total_balance_remaining: number | null;
}

// Statuses where paying is definitely not applicable — kept in sync
// with `blockedStatuses` in POST /api/quote/[orderNumber]/payments.
// Anything NOT in this list is fine to attempt, as long as there's
// still a balance_remaining > 0 — including 'confirmed', 'checked_in'
// etc, since 'confirmed' only means the deposit was met, not that the
// full total is paid.
const NON_PAYABLE_STATUSES = ['draft', 'cancelled', 'refunded', 'completed'];

interface BankTransferInfo {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

interface CurrencyPaymentInfo {
  bankTransfer?: BankTransferInfo;
  qrImage?: string;
}

// Thai account is a real bank_transfer account. LAK/USD currently
// only have a QR (BCEL/LAPNet wallet, screenshotted from the app) —
// no bank_transfer account exists for those yet, so `bankTransfer` is
// left undefined rather than filled with placeholder text.
const PAYMENT_INFO: Record<Currency, CurrencyPaymentInfo> = {
  THB: {
    bankTransfer: {
      bankName: 'ธนาคารกสิกรไทย (KBank)',
      accountName: 'หจก. รอยัล บริดจ์ 99',
      accountNumber: '230-3-60611-7',
    },
    qrImage: '/payments/qr-thb.jpg',
  },
  LAK: {
    qrImage: '/payments/qr-lak.jpg',
  },
  USD: {
    qrImage: '/payments/qr-usd.jpg',
  },
};

function formatMoney(amount: number | null, currency: string | null) {
  const value = (amount ?? 0).toLocaleString('th-TH');
  return `${value} ${currency || 'THB'}`;
}

export default function PaymentPage() {
  const t = useTranslations('payment');
  const params = useParams();
  const orderNumber = params?.orderNumber as string;
  // Required alongside order_number — see migration 021 /
  // payments/route.ts header for why order_number alone isn't
  // treated as a secret. Comes from the secure link the customer was
  // sent, e.g. /my-trip/WOS-.../payment?token=...
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';

  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currency, setCurrency] = useState<Currency>('THB');
  const [method, setMethod] = useState<Method>('bank_transfer');
  const [amount, setAmount] = useState<string>('');
  // 'full' matches the old default behaviour (prefilled with the full
  // balance). 'custom' is the only mode where the input is editable —
  // this stops a customer accidentally typing over a preset amount.
  const [amountMode, setAmountMode] = useState<'deposit' | 'full' | 'custom'>('full');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/quote/${orderNumber}/payments?token=${encodeURIComponent(token)}`);
        const result = await res.json();
        if (!res.ok) throw new Error(result?.error ?? t('errorLoad'));
        setOrder(result.order);
        const remaining =
          result.order.total_balance_remaining ??
          Math.max((result.order.total_deposit_required ?? 0) - (result.order.total_deposit_paid ?? 0), 0);
        setAmount(String(remaining || ''));
        if (result.order.currency) setCurrency(result.order.currency as Currency);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'unknown error');
      } finally {
        setLoading(false);
      }
    }
    if (orderNumber) load();
    // token is included so a changed/late-arriving token re-fetches
    // with the correct value, instead of the effect being pinned to
    // whatever token happened to be present on first render.
  }, [orderNumber, token]);

  // Whenever the currency changes, default to whichever method
  // actually has data for it (prefer bank_transfer, fall back to qr)
  // instead of leaving the picker stuck on a method with nothing to
  // show for the newly-selected currency.
  useEffect(() => {
    const info = PAYMENT_INFO[currency];
    setMethod(info.bankTransfer ? 'bank_transfer' : 'qr');
  }, [currency]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      setSubmitError(t('errorAmount'));
      return;
    }
    if (!file) {
      setSubmitError(t('errorFile'));
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const path = `${orderNumber}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from('payment-slips').upload(path, file);
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabase.storage.from('payment-slips').getPublicUrl(path);

      const res = await fetch(`/api/quote/${orderNumber}/payments?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: numericAmount,
          // currency intentionally NOT sent — server always uses the
          // order's own currency now (see payments/route.ts)
          method,
          slip_url: publicUrlData.publicUrl,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result?.error ?? t('errorSubmitGeneric'));

      setSubmitted(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t('errorSubmitCatch'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-100" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  if (loadError || !order) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {loadError ?? t('errorNotFound')}
        </div>
      </div>
    );
  }

  const balanceRemaining =
    order.total_balance_remaining ??
    Math.max((order.total_deposit_required ?? 0) - (order.total_deposit_paid ?? 0), 0);

  // "ส่วนมัดจำที่ยังขาด" — confirmed business rule: deposit_required
  // minus deposit_paid, only offered as a preset when it's a genuinely
  // smaller amount than paying the full balance (if deposit is already
  // met, or there's no deposit concept for this order, don't show a
  // redundant "deposit" button next to "full").
  const depositRemaining = Math.max(
    (order.total_deposit_required ?? 0) - (order.total_deposit_paid ?? 0),
    0
  );
  const showDepositOption = depositRemaining > 0 && depositRemaining < balanceRemaining;

  if (NON_PAYABLE_STATUSES.includes(order.status)) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6 text-center">
        <p className="text-sm text-slate-500">{t('notPayableStatus')}</p>
        <Link
          href={`/my-trip/${orderNumber}?token=${encodeURIComponent(token)}`}
          className="inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white"
        >
          {t('backToStatus')}
        </Link>
      </div>
    );
  }

  if (balanceRemaining <= 0) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6 text-center">
        <p className="text-sm text-slate-500">{t('fullyPaid')}</p>
        <Link
          href={`/my-trip/${orderNumber}?token=${encodeURIComponent(token)}`}
          className="inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white"
        >
          {t('backToStatus')}
        </Link>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <p className="text-lg font-bold text-emerald-700">{t('submittedTitle')}</p>
          <p className="mt-1 text-sm text-emerald-600">{t('submittedBody')}</p>
        </div>
        <Link
          href={`/my-trip/${orderNumber}?token=${encodeURIComponent(token)}`}
          className="block w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-white"
        >
          {t('backToStatus')}
        </Link>
      </div>
    );
  }

  const info = PAYMENT_INFO[currency];

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('orderNumber', { orderNumber: order.order_number })}</p>
        <div className="mt-3 flex justify-between text-sm">
          <span className="text-slate-500">{t('balanceRemaining')}</span>
          <span className="font-semibold text-primary">{formatMoney(balanceRemaining, order.currency)}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Currency */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <label className="form-label">{t('currencyLabel')}</label>
          <div className="grid grid-cols-3 gap-2">
            {(['THB', 'LAK', 'USD'] as Currency[]).map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setCurrency(c)}
                className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  currency === c ? 'border-primary bg-primary-light text-primary' : 'border-slate-200 text-slate-600'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Method */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <label className="form-label">{t('methodLabel')}</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMethod('bank_transfer')}
              className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                method === 'bank_transfer' ? 'border-primary bg-primary-light text-primary' : 'border-slate-200 text-slate-600'
              }`}
            >
              {t('methodBankTransfer')}
            </button>
            <button
              type="button"
              onClick={() => setMethod('qr')}
              className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                method === 'qr' ? 'border-primary bg-primary-light text-primary' : 'border-slate-200 text-slate-600'
              }`}
            >
              {t('methodQr')}
            </button>
          </div>

          {/* Instructions */}
          <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            {method === 'bank_transfer' ? (
              info.bankTransfer ? (
                <div className="space-y-1">
                  <p>
                    <span className="text-slate-400">{t('bankName')}</span> {info.bankTransfer.bankName}
                  </p>
                  <p>
                    <span className="text-slate-400">{t('accountName')}</span> {info.bankTransfer.accountName}
                  </p>
                  <p>
                    <span className="text-slate-400">{t('accountNumber')}</span> {info.bankTransfer.accountNumber}
                  </p>
                </div>
              ) : (
                <p className="text-center text-slate-400">
                  {t('noBankAccount')}
                </p>
              )
            ) : info.qrImage ? (
              <img src={info.qrImage} alt={t('qrAlt', { currency })} className="mx-auto max-h-80 object-contain" />
            ) : (
              <p className="text-center text-slate-400">{t('noQr')}</p>
            )}
          </div>
        </div>

        {/* Amount */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <label className="form-label">{t('amountLabel', { currency })}</label>
          <div className={`grid gap-2 ${showDepositOption ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {showDepositOption ? (
              <button
                type="button"
                onClick={() => {
                  setAmountMode('deposit');
                  setAmount(String(depositRemaining));
                }}
                className={`rounded-xl border px-2 py-2 text-center text-xs font-medium transition-colors ${
                  amountMode === 'deposit'
                    ? 'border-primary bg-primary-light text-primary'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                <div>{t('presetDeposit')}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  {formatMoney(depositRemaining, order.currency)}
                </div>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setAmountMode('full');
                setAmount(String(balanceRemaining));
              }}
              className={`rounded-xl border px-2 py-2 text-center text-xs font-medium transition-colors ${
                amountMode === 'full'
                  ? 'border-primary bg-primary-light text-primary'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              <div>{t('presetFull')}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {formatMoney(balanceRemaining, order.currency)}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setAmountMode('custom')}
              className={`rounded-xl border px-2 py-2 text-center text-xs font-medium transition-colors ${
                amountMode === 'custom'
                  ? 'border-primary bg-primary-light text-primary'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              {t('presetCustom')}
            </button>
          </div>

          {amountMode === 'custom' ? (
            <input
              type="number"
              min={1}
              step="0.01"
              className="form-input mt-3"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              autoFocus
            />
          ) : (
            <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {t('amountToPay')}{' '}
              <span className="font-semibold text-primary">{formatMoney(Number(amount) || 0, order.currency)}</span>
            </div>
          )}
        </div>

        {/* Slip upload */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <label className="form-label">{t('slipLabel')}</label>
          <input
            type="file"
            accept="image/*,application/pdf"
            className="form-input"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </div>

        {submitError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
            {submitError}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary w-full justify-center text-base disabled:opacity-60"
        >
          {submitting ? t('submitting') : t('submitButton')}
        </button>
      </form>

      <p className="text-center text-xs text-slate-400">
        {t('contactFooter')}
      </p>
    </div>
  );
}
