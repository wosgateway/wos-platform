// src/lib/phone.ts
//
// Canonicalizes a customer-entered phone number before it's used as
// an identity key: customers.phone lookups, the rate-limit key in
// app/api/orders/route.ts, and the advisory-lock key inside
// find_or_create_customer() (migration 034). Without this,
// "0812345678", "081-234-5678", " 0812345678 ", and "+66812345678"
// all compare as different phones — not a race condition, an
// identity-normalization gap (flagged in the migration 034 review).
//
// Scope of the guess: WOS/VITH HUB's customer base is overwhelmingly
// Thai mobile numbers (BookingForm.tsx's phone field is free-text,
// no country picker). A local 10-digit number starting with 0 and a
// mobile prefix (06/08/09) is rewritten to +66 E.164 form, so it
// matches a customer who later types the +66 form instead. Anything
// that doesn't match that specific shape — already has a country
// code, is a Lao/other-country number, wrong length, landline, etc.
// — is left as digits-only with NO guessed country code. A wrong
// guess would silently merge two different people's order history,
// which is worse than leaving them as two separate customers (the
// documented, acceptable status quo per migration 011 — phone was
// never meant to be a hard 1:1 identity key).
//
// This is a UX/data-quality normalization, never a security or
// authorization boundary — nothing downstream trusts a client-sent
// "already normalized" value as-is; the server re-derives this
// itself from the raw input every time.
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasLeadingPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (!digits) return '';

  if (hasLeadingPlus) {
    // Already has an explicit country code — trust the customer's
    // own '+', just strip formatting noise (spaces/dashes/parens).
    return `+${digits}`;
  }

  // Thai local mobile shape: 0 + 9 digits (10 total), first digit
  // after the 0 is 6, 8, or 9 (the actual Thai mobile prefixes).
  if (/^0[689]\d{8}$/.test(digits)) {
    return `+66${digits.slice(1)}`;
  }

  // Anything else (landline, Lao number, already-bare digits with no
  // recognizable Thai-mobile shape): strip formatting only, no
  // country-code guess.
  return digits;
}
