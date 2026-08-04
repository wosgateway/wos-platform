-- ============================================================
-- MIGRATION 008: BOOKING & PAYMENT ENGINE (MVP v1.0)
-- Ref: WOS Backend Brief — Booking & Payment Management System
--
-- Design notes:
-- - Introduces a NEW multi-item order model, deliberately named
--   `orders` / `order_items` (NOT `bookings`) to avoid repeating
--   the packages/bookings collision from migrations 004-005.
-- - The existing public `bookings` table (single package_id,
--   boolean transport/hotel add-ons) is left untouched. Migration
--   path: each existing `bookings` row becomes one `order` with
--   1-3 `order_items` (clinic/transport/hotel). Do that as a
--   separate data-migration script once the app layer is ready —
--   not included here.
-- - `order_items.organization_id` is the PARTNER fulfilling that
--   line item. `orders` itself is NOT organization-scoped — it's
--   owned by the customer/patient and can span multiple partners.
--   This is why RLS on orders differs from the partner-portal
--   pattern used in migration 007 (org-scoped tables).
-- - Payment Provider is stored as free text (`payment_provider`)
--   on purpose — per the brief, provider-specific logic (One Bank,
--   PromptPay, future gateways) must live in an app-layer Payment
--   Provider abstraction, never hardcoded into the schema.
-- ============================================================

-- ============================================================
-- 0. Booking number sequence + generator
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TEXT AS $$
DECLARE
    next_val BIGINT;
BEGIN
    next_val := nextval('public.order_number_seq');
    RETURN 'WOS-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(next_val::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. deposit_rules — configurable deposit/refund/cancellation
--    policy per service_type, optionally overridden per partner.
--    Resolution order: exact (service_type + organization_id)
--    match first, then (service_type + organization_id IS NULL)
--    as the global default. `priority` breaks ties if needed.
-- ============================================================
CREATE TABLE public.deposit_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE, -- NULL = global default

    service_type TEXT NOT NULL,                   -- clinic | hotel | transport | wellness | insurance

    deposit_type TEXT NOT NULL DEFAULT 'percentage', -- percentage | fixed | none
    deposit_value NUMERIC(12, 2) NOT NULL DEFAULT 0,  -- % (0-100) if percentage, THB amount if fixed

    pay_later_allowed BOOLEAN DEFAULT false,
    refund_policy TEXT,                            -- free-text policy description shown to customer
    cancellation_policy TEXT,

    priority INTEGER DEFAULT 0,                    -- higher wins if multiple rules match
    active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT chk_deposit_type CHECK (deposit_type IN ('percentage', 'fixed', 'none')),
    CONSTRAINT chk_service_type CHECK (service_type IN ('clinic', 'hotel', 'transport', 'wellness', 'insurance'))
);

CREATE INDEX idx_deposit_rules_lookup ON public.deposit_rules(service_type, organization_id) WHERE active = true;

-- ============================================================
-- 2. orders — the "Booking" header. Owned by a patient, can
--    contain items fulfilled by different partners.
-- ============================================================
CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT UNIQUE NOT NULL DEFAULT public.generate_order_number(),

    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,

    status TEXT NOT NULL DEFAULT 'draft',
    currency TEXT NOT NULL DEFAULT 'THB',

    -- Denormalized totals, kept in sync by app layer / trigger (see below)
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_deposit_required NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_deposit_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_balance_remaining NUMERIC(12, 2) NOT NULL DEFAULT 0,

    notes TEXT,
    cancelled_reason TEXT,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT chk_order_status CHECK (status IN (
        'draft', 'pending_deposit', 'deposit_paid', 'confirmed',
        'checked_in', 'completed', 'cancelled', 'refunded'
    )),
    CONSTRAINT chk_order_currency CHECK (currency IN ('THB', 'LAK', 'USD'))
);

CREATE INDEX idx_orders_patient_id ON public.orders(patient_id);
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_order_number ON public.orders(order_number);

-- ============================================================
-- 3. order_items — the "Booking Item". One per service, each
--    tied to exactly one partner organization.
-- ============================================================
CREATE TABLE public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,

    service_type TEXT NOT NULL,                    -- clinic | hotel | transport | wellness | insurance

    price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    deposit_required NUMERIC(12, 2) NOT NULL DEFAULT 0,  -- resolved snapshot from deposit_rules at booking time
    deposit_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
    balance_remaining NUMERIC(12, 2) NOT NULL DEFAULT 0, -- price - deposit_paid, kept in sync

    scheduled_date DATE,
    scheduled_time TIME,

    status TEXT NOT NULL DEFAULT 'pending',

    -- snapshot of which deposit rule was applied, for auditability
    deposit_rule_id UUID REFERENCES public.deposit_rules(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT chk_item_service_type CHECK (service_type IN ('clinic', 'hotel', 'transport', 'wellness', 'insurance')),
    CONSTRAINT chk_item_status CHECK (status IN (
        'pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'refunded'
    ))
);

CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX idx_order_items_org_id ON public.order_items(organization_id);
CREATE INDEX idx_order_items_status ON public.order_items(status);

-- ============================================================
-- 4. payments — NOT tied 1:1 to orders. Many payments per order,
--    each optionally scoped to a single order_item.
-- ============================================================
CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES public.order_items(id) ON DELETE SET NULL, -- optional: NULL = applies to whole order

    currency TEXT NOT NULL DEFAULT 'THB',
    amount NUMERIC(12, 2) NOT NULL,

    payment_method TEXT NOT NULL,                  -- one_bank_qr | bank_transfer | promptpay | cash_at_clinic | cash_at_hotel
    payment_provider TEXT NOT NULL DEFAULT 'manual_transfer', -- free text: one_bank | manual_transfer | <future gateway id>
    transaction_reference TEXT,

    status TEXT NOT NULL DEFAULT 'pending',

    verified_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    rejection_reason TEXT,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT chk_payment_currency CHECK (currency IN ('THB', 'LAK', 'USD')),
    CONSTRAINT chk_payment_method CHECK (payment_method IN (
        'one_bank_qr', 'bank_transfer', 'promptpay', 'cash_at_clinic', 'cash_at_hotel'
    )),
    CONSTRAINT chk_payment_status CHECK (status IN (
        'pending', 'waiting_verification', 'verified', 'rejected',
        'refunded', 'cancelled', 'expired'
    ))
);

CREATE INDEX idx_payments_order_id ON public.payments(order_id);
CREATE INDEX idx_payments_order_item_id ON public.payments(order_item_id);
CREATE INDEX idx_payments_status ON public.payments(status);

-- ============================================================
-- 5. payment_attachments — uploaded slips / proof of payment
-- ============================================================
CREATE TABLE public.payment_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,

    file_url TEXT NOT NULL,
    file_type TEXT,                                -- pdf | jpg | png
    file_size INTEGER,

    uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_payment_attachments_payment_id ON public.payment_attachments(payment_id);

-- ============================================================
-- 6. settlements — partner payout accounting (Phase 1: computed
--    only, no actual transfer). One row per partner per period.
-- ============================================================
CREATE TABLE public.settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    gross_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
    platform_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
    net_payable NUMERIC(12, 2) NOT NULL DEFAULT 0,

    status TEXT NOT NULL DEFAULT 'pending',         -- pending | paid

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT chk_settlement_status CHECK (status IN ('pending', 'paid'))
);

CREATE INDEX idx_settlements_org_id ON public.settlements(organization_id);
CREATE INDEX idx_settlements_period ON public.settlements(period_start, period_end);

-- ============================================================
-- 7. invoices — Phase 2 stub (minimal columns, extend later)
-- ============================================================
CREATE TABLE public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    invoice_number TEXT UNIQUE,
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'THB',
    file_url TEXT,                                  -- generated PDF, once Phase 2 lands
    status TEXT NOT NULL DEFAULT 'draft',            -- draft | issued | paid | void
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT chk_invoice_status CHECK (status IN ('draft', 'issued', 'paid', 'void'))
);

CREATE INDEX idx_invoices_order_id ON public.invoices(order_id);

-- ============================================================
-- TRIGGERS: updated_at (reuses handle_updated_at() from migration 001)
-- ============================================================
CREATE TRIGGER set_updated_at_deposit_rules BEFORE UPDATE ON public.deposit_rules FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_orders BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_order_items BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_payments BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_settlements BEFORE UPDATE ON public.settlements FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_invoices BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- TRIGGER: keep order_items.balance_remaining in sync
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_order_item_balance()
RETURNS TRIGGER AS $$
BEGIN
    NEW.balance_remaining := NEW.price - NEW.deposit_paid;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_order_item_balance_trigger
    BEFORE INSERT OR UPDATE OF price, deposit_paid ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public.sync_order_item_balance();

-- ============================================================
-- TRIGGER: roll order_items totals up into parent orders
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_order_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_order_id UUID;
BEGIN
    v_order_id := COALESCE(NEW.order_id, OLD.order_id);

    UPDATE public.orders o
    SET
        total_amount = agg.total_amount,
        total_deposit_required = agg.total_deposit_required,
        total_deposit_paid = agg.total_deposit_paid,
        total_balance_remaining = agg.total_balance_remaining
    FROM (
        SELECT
            COALESCE(SUM(price), 0) AS total_amount,
            COALESCE(SUM(deposit_required), 0) AS total_deposit_required,
            COALESCE(SUM(deposit_paid), 0) AS total_deposit_paid,
            COALESCE(SUM(balance_remaining), 0) AS total_balance_remaining
        FROM public.order_items
        WHERE order_id = v_order_id
    ) agg
    WHERE o.id = v_order_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_order_totals_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public.sync_order_totals();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.deposit_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- deposit_rules: public read (needed by the booking UI to show pricing/policy)
CREATE POLICY "Anyone can view active deposit rules" ON public.deposit_rules
    FOR SELECT USING (active = true);

-- order_items: partner staff see items belonging to their org (uses the
-- same user_metadata JWT claim pattern as migration 007 / RLS Policy.sql)
CREATE POLICY "Partners can view their organization's order items" ON public.order_items
    FOR SELECT USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

CREATE POLICY "Partners can update their organization's order items" ON public.order_items
    FOR UPDATE USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- payments: partner staff can view payments tied to their own order_items
CREATE POLICY "Partners can view payments for their order items" ON public.payments
    FOR SELECT USING (
        order_item_id IN (
            SELECT id FROM public.order_items
            WHERE organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID
        )
    );

-- settlements: partner staff see only their own org's settlements
CREATE POLICY "Partners can view their organization's settlements" ON public.settlements
    FOR SELECT USING (organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID);

-- orders / invoices: NOT organization-scoped (customer-owned, cross-partner).
-- No customer-facing RLS policy yet — customers currently authenticate via
-- phone/Line, not Supabase Auth, so there's no auth.uid() to key off of.
-- Until customer accounts exist, orders/invoices/payment_attachments reads
-- for the customer portal MUST go through a server-side route using the
-- service role key (bypasses RLS), never the anon key directly.
-- TODO: once customer auth exists, add:
--   CREATE POLICY "Customers can view their own orders" ON public.orders
--     FOR SELECT USING (patient_id = (SELECT id FROM patients WHERE auth_user_id = auth.uid()));
