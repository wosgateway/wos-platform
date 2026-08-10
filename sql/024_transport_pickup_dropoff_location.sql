-- ============================================================
-- 024_transport_pickup_dropoff_location.sql
--
-- Adds what the new pickup/dropoff location fields on the
-- customer-facing booking forms need
-- (BookingForm.tsx / JourneyBookingForm.tsx, transport add-on
-- section): a dropdown of common Laos↔Thailand corridor points
-- (Nong Khai border checkpoint, Udon Thani Airport) plus "hotel"
-- and "other", each of which reveals a free-text input. The
-- resolved label (e.g. "🛂 ด่านหนองคาย (สะพานมิตรภาพไทย-ลาว)" or
-- "🏨 โรงแรม (ระบุชื่อ): Some Hotel") is sent to /api/orders as
-- transport_pickup_location / transport_dropoff_location on the
-- transport item.
--
-- Safe to re-run.
-- ============================================================

alter table public.order_items
  add column if not exists pickup_location text,
  add column if not exists dropoff_location text;

comment on column public.order_items.pickup_location is
  'Free text describing where the transport partner should pick the customer up — either a standardized corridor point (border checkpoint, airport) or a customer-typed hotel name/spot. Set from BookingForm.tsx / JourneyBookingForm.tsx via /api/orders; only meaningful when service_type = ''transport''.';
comment on column public.order_items.dropoff_location is
  'Free text describing where the transport partner should drop the customer off. Same source/shape as pickup_location.';

-- ------------------------------------------------------------
-- create_order_with_items() update
-- ------------------------------------------------------------
-- create_order_with_items() (migration 012, extended by 013/014)
-- builds each order_items row from the p_items JSONB array passed in
-- by /api/orders/route.ts. See
-- 025_create_order_with_items_pickup_dropoff.sql, which updates that
-- function to read transport_pickup_location / transport_dropoff_location
-- off each item and write them into the columns added above — run
-- 025 immediately after this migration, before deploying route.ts.
--
-- Also check BookingsManager.tsx (admin orders list/detail) and any
-- driver-facing view of order_items — they'll want to display these
-- two new columns once populated; no code was changed there in this
-- pass.
-- ============================================================
