# Payment / Upload Slip €” security fixes applied

7 issues found in audit, all fixed in this pass. Run `migrations/`
files **in order** (019 before 021) against Supabase before deploying
the code.

## What changed

### `migrations/021_payment_security_fixes.sql` (new)
- Adds `orders.payment_access_token` €” a random per-order token. This
  is required because `order_number` (`WOS-YYYYMMDD-00001`, ...) is a
  **predictable sequence**, not a secret €” confirmed from the actual
  `generate_order_number()` function source. Anyone could previously
  enumerate order numbers and read/pay against someone else's order.
- Adds a **partial unique index** so the database itself refuses a
  second `waiting_verification` whole-order payment for the same
  order €” closes the duplicate-submission issue at the DB level
  (race-safe, not just an app-level check).
- Contains a manual step you need to do: check whether `orders.status`
  has a CHECK constraint, and if so add `'pending_verification'` to it
  (see the file €” the query and ALTER statement are written out, just
  needs your actual constraint name).

### `src/app/api/quote/[orderNumber]/payments/route.ts` (rewritten)
| # | Fix |
|---|---|
| Auth | GET and POST now require `?token=` matching `orders.payment_access_token`, checked before anything else. |
| `amount` | No longer trusted from the client. Server computes the real remaining balance and rejects any `amount` over it. |
| `currency` | No longer accepted from the client at all €” always `order.currency`. |
| Duplicate payments | POST relies on the new DB unique index; a 2nd concurrent submit gets a friendly 409, not a duplicate row. |
| `slip_url` | Validated as a real HTTPS URL whose host matches your Supabase project and whose path matches the actual public-storage path shape €” a spoofed `evil.com/payment-slips/x.jpg` no longer passes. |
| Status collision | Submitting a slip now sets `order.status = 'pending_verification'` instead of reusing `'deposit_paid'` (which verify/route.ts also uses for a *verified* partial payment €” those were indistinguishable before). |
| Info disclosure | Response no longer echoes `payment_access_token` back. |

### `src/app/api/admin/payments/[id]/verify/route.ts` (rewritten)
- The verify transition is now a single conditional `UPDATE ... WHERE
  status IN ('waiting_verification','pending')` instead of
  fetch-then-check-then-update. Two admins (or a double-click)
  verifying the same payment at once can no longer both succeed and
  double-count the deposit €” the loser gets a 409.
- Left a comment flagging a smaller, remaining race (two *different*
  payments on the same order verified simultaneously could still lose
  an update on `total_deposit_paid`) €” not closed here since it needs
  a Postgres function with row locking; noted as a follow-up.

### `src/app/api/admin/payments/[id]/reject/route.ts`
No changes €” reviewed, no issues found.

### Frontend (`my-trip/[orderNumber]/page.tsx`, `.../payment/page.tsx`)
- Both now read `?token=` from the URL and forward it on every call
  to `/api/quote/[orderNumber]/payments`.
- The payment page no longer sends `currency` in the POST body (server
  ignores it anyway now).
- All internal links between these two pages preserve `?token=`.

### `src/app/api/orders/route.ts` (added €” the missing link to the
whole thing)
- `payment_access_token` added to the final `select()` and returned in
  both the 201 success response and (implicitly available for retry
  on) the 207 partial-failure response.

### `src/components/BookingForm.tsx` (fixed)
- **Turned out there was no link to `/my-trip/[orderNumber]` anywhere
  in this file at all** €” the post-booking success screen only showed
  the order number as text. Added a button/link:
  `/my-trip/${order_number}?token=${payment_access_token}` €” this is
  the actual first time a customer gets a working link to their
  order-status/payment page.
- Button label is hardcoded Thai text (`à¸”à¸¹à¸ªà¸–à¸²à¸™à¸°à¸à¸²à¸£à¸ˆà¸­à¸‡ / à¸Šà¸³à¸£à¸°à¹€à¸‡à¸´à¸™`)
  with a TODO to move it into your `next-intl` locale JSON files €”
  didn't invent a translation key that doesn't exist in your locale
  files, since that would throw at runtime.

## Still open €” not fixed in this pass (out of scope: files not provided)

1. **`/api/quote/[orderNumber]` (the plain order-details route, not
   `/payments`) has no equivalent token check.** Same predictable
   `order_number` problem applies there. Apply the same
   `payment_access_token` pattern there €” the token is now available
   everywhere it's needed (orders.payment_access_token), this route
   just needs the same auth check added.
2. **The `/quote/[orderNumber]` page** still links to
   `/my-trip/${orderNumber}` without a token €” same reason as #1: that
   page doesn't have a token to forward until #1 is fixed.
3. If there's a SECOND place customers land after booking besides
   BookingForm.tsx (e.g. a confirmation email, an admin manually
   texting the customer) €” those need the same token treatment. I
   only found and fixed BookingForm.tsx's own success screen.
4. File-size / file-type validation on slip uploads €” still not
   implemented.
5. Image `onError` fallback for QR images €” still not implemented.
6. Translate the new BookingForm button text into your `next-intl`
   locale files and swap out the hardcoded string.

## Before deploying
1. Run migrations in order: `019` †’ `020b` †’ `021`.
2. Do the manual CHECK-constraint step inside 020b (already written
   for your actual `chk_order_status` constraint).
3. Deploy `orders/route.ts` and `BookingForm.tsx` together with the
   payments routes €” if only the payments routes go out first,
   customers who booked before this deploy have no token and can't
   reach their payment page until they re-visit a fresh booking flow.
