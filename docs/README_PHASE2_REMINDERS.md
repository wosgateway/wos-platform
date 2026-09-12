# My Journey Phase 2 — Reminder Engine — delivery notes

## Files in this patch

```
sql/095_trip_reminder_deliveries.sql          new — idempotency table
src/lib/trips/reminders/types.ts              new
src/lib/trips/reminders/bangkok-time.ts       new
src/lib/trips/reminders/eligibility.ts        new
src/lib/trips/reminders/duplicate.ts          new
src/lib/trips/reminders/engine.ts             new
src/lib/notify/trip-reminder-whatsapp.ts      new
src/lib/notify/customer-whatsapp.ts           modified — 2 functions + 1 const exported for reuse, no behavior change
src/app/api/cron/trip-reminders/route.ts      new
src/app/api/partner-trip/[token]/events/[eventId]/status/route.ts   modified — fires R3 on confirm
src/app/api/trips/[tripId]/events/[eventId]/route.ts                modified — fires R3 on confirm
vercel.json                                   new — 10-min cron schedule
```

No changes to `trips`/`trip_events`/`/my-trip/[token]` — Phase 2 reads
that existing schema and token model as-is, per the brief's hard scope.

## Setup steps

1. Run `sql/095_trip_reminder_deliveries.sql` (additive only).
2. Create 3 WhatsApp message templates in Meta Business Manager, each
   approved in th/lo/en. Exact contract for each is documented at the
   top of `src/lib/notify/trip-reminder-whatsapp.ts` — 3 body variables
   (title/time/location) + a dynamic "View Journey" URL button, plus an
   optional second dynamic "Open Maps" URL button.
3. Set env vars:
   - `WHATSAPP_TEMPLATE_JOURNEY_REMINDER_24H`
   - `WHATSAPP_TEMPLATE_JOURNEY_REMINDER_1H`
   - `WHATSAPP_TEMPLATE_JOURNEY_REMINDER_CONFIRMED`
   - `CRON_SECRET` — any random string; Vercel Cron sends it automatically
     as `Authorization: Bearer $CRON_SECRET` once set as a project env var
   - (`WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` already exist
     from the Phase 4 WhatsApp work — reused as-is)
4. Deploy. Confirm `vercel.json`'s cron is actually running — **if the
   Vercel project is on the Hobby plan, cron only fires once a day**,
   which is too infrequent for the R2 "1 hour before" window. Either
   upgrade to Pro, or point an external scheduler at
   `POST/GET /api/cron/trip-reminders` with the same bearer header
   every 5–15 minutes instead of relying on `vercel.json`.

## What's genuinely done vs. deferred

Done, matching the brief's Definition of Done (§23): R1/R2 time-window
eligibility + late-skip, R3 on both partner and admin confirm paths,
duplicate protection via the claim-then-resolve pattern, cancelled/
completed/revoked/expired events never send, missing-contact and
WhatsApp-failure both degrade to a logged `skipped`/`failed` row
without throwing, Bangkok-time math, no internal ids in the outbound
link (only the trip access_token).

Deferred, matching the brief's explicit Out of Scope (§24): LINE/email
channels, cancellation notifications, an admin dashboard (delivery
state is queryable directly from `trip_reminder_deliveries` for now).

One thing worth your attention that the brief didn't spell out: a
`trip_reminder_deliveries` row stuck at `'pending'` (only possible if
the process crashes between claiming the slot and recording the
result) permanently blocks a retry of that exact event+reminder-type.
Documented in the migration's header comment — acceptable for v1 since
the brief has no retry requirement, but worth knowing before you rely
on this under real failure conditions.
