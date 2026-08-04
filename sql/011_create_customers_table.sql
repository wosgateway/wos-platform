-- ============================================================
-- MIGRATION 010: customers — org-agnostic customer identity for
-- the multi-partner `orders` model.
--
-- Why not reuse `patients`: `patients.organization_id` is NOT NULL
-- (migration 001) — every patient row belongs to exactly one
-- partner org, matching the old single-partner `bookings` flow.
-- But migration 008 explicitly designed `orders` to span multiple
-- partner orgs in one order (order_items.organization_id varies
-- per line item), with a single `orders.patient_id` anchoring the
-- whole order. An org-scoped patient can't represent a customer
-- whose order includes items from 2-3 different partners at once.
--
-- `patients` is left completely untouched — it keeps serving the
-- legacy `bookings` table and any per-org CRM/dashboard views.
-- `customers` is the new, separate identity used only by
-- orders/order_items/payments going forward. The two are
-- intentionally NOT merged or synced in this migration; if you
-- later want "same phone number = same person" across both tables,
-- that's a deliberate follow-up decision, not implied here.
--
-- No RLS policies are added (table stays RLS-enabled, zero
-- policies) — same "service role only" pattern already used for
-- `payment_attachments` and `invoices` in migration 008, since
-- there's still no customer-facing Supabase Auth session to key a
-- policy off of.
-- ============================================================

CREATE TABLE public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    line_id TEXT,
    country TEXT,
    preferred_language TEXT DEFAULT 'th',

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Lookup index only — deliberately NOT a unique constraint. A phone
-- number isn't guaranteed to map 1:1 to a person (shared household
-- phones, re-issued numbers), so "find or create" logic in the API
-- route does an explicit SELECT-then-INSERT rather than relying on
-- a DB-level uniqueness guarantee.
CREATE INDEX idx_customers_phone ON public.customers(phone);

CREATE TRIGGER set_updated_at_customers
    BEFORE UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
-- No policies added on purpose — see header comment. All access
-- goes through the service-role client (src/lib/supabase/service.ts).

-- ============================================================
-- Repoint orders.patient_id from patients -> customers.
--
-- Safe to run even if `orders` already has rows: this only changes
-- which table the FK checks against, not the column itself. If any
-- orders already exist with a patient_id that only exists in
-- `patients` (not yet in `customers`), this ALTER will fail loudly
-- with a FK violation rather than silently corrupting data — in
-- that case those rows need a corresponding `customers` row
-- inserted first (one-off backfill, not included here).
-- ============================================================

ALTER TABLE public.orders
    DROP CONSTRAINT IF EXISTS orders_patient_id_fkey;

ALTER TABLE public.orders
    ADD CONSTRAINT orders_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

-- Note: the column is still literally named `patient_id` (not
-- renamed to `customer_id`) to avoid touching every other place in
-- migration 008/009/the app layer that already references it by
-- that name. Purely cosmetic — worth a follow-up rename later if it
-- causes confusion, but not required for correctness.
