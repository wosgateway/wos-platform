-- ============================================================
-- 005_booking_payment_engine.sql
-- ============================================================
-- š ï¸ RECONSTRUCTED SNAPSHOT €” à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¹„à¸Ÿà¸¥à¹Œ migration à¸•à¹‰à¸™à¸‰à¸šà¸±à¸šà¸ˆà¸£à¸´à¸‡
-- à¸›à¸£à¸°à¸à¸­à¸šà¸‚à¸¶à¹‰à¸™à¸¢à¹‰à¸­à¸™à¸«à¸¥à¸±à¸‡à¸ˆà¸²à¸ schema à¸ˆà¸£à¸´à¸‡à¸šà¸™ Supabase à¹€à¸¡à¸·à¹ˆà¸­ 2026-08-02
-- (à¹€à¸”à¸´à¸¡à¹€à¸£à¸µà¸¢à¸à¸à¸±à¸™à¸§à¹ˆà¸² migration "008_booking_payment_engine.sql" à¹ƒà¸™à¸šà¸±à¸™à¸—à¸¶à¸
-- à¸à¸²à¸£à¸—à¸”à¸ªà¸­à¸š à¹à¸•à¹ˆà¹„à¸¡à¹ˆà¹€à¸„à¸¢à¸–à¸¹à¸ commit à¹€à¸‚à¹‰à¸² repo €” à¹„à¸Ÿà¸¥à¹Œà¸™à¸µà¹‰à¹ƒà¸«à¹‰à¹€à¸¥à¸‚à¸•à¹ˆà¸­à¸ˆà¸²à¸ 004
-- à¸•à¸²à¸¡à¸¥à¸³à¸”à¸±à¸šà¹„à¸Ÿà¸¥à¹Œà¸ˆà¸£à¸´à¸‡à¹ƒà¸™à¹‚à¸›à¸£à¹€à¸ˆà¸à¸•à¹Œ à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆà¹€à¸¥à¸‚à¹€à¸”à¸´à¸¡à¸—à¸µà¹ˆà¹€à¸„à¸¢à¸­à¹‰à¸²à¸‡à¸–à¸¶à¸‡à¸à¸±à¸™à¸”à¹‰à¸§à¸¢à¸§à¸²à¸ˆà¸²)
--
-- à¸„à¸£à¸­à¸šà¸„à¸¥à¸¸à¸¡: deposit_rules, orders, order_items, payments,
-- payment_attachments, invoices, settlements
--
-- à¸­à¸­à¸à¹à¸šà¸šà¹„à¸§à¹‰à¸§à¹ˆà¸² payments/orders "à¹„à¸¡à¹ˆà¹€à¸›à¸´à¸” RLS à¹ƒà¸«à¹‰à¹€à¸‚à¸µà¸¢à¸™à¸•à¸£à¸‡à¹† à¹‚à¸”à¸¢à¹€à¸ˆà¸•à¸™à¸²"
-- (à¸”à¸¹ comment à¹ƒà¸™à¹„à¸Ÿà¸¥à¹Œ src/app/api/partner/payments/[id]/verify/route.ts)
-- à¸à¸²à¸£à¹€à¸‚à¸µà¸¢à¸™à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”à¸•à¹‰à¸­à¸‡à¸œà¹ˆà¸²à¸™ API route à¸—à¸µà¹ˆà¹ƒà¸Šà¹‰ service-role client
-- à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™ €” à¸›à¸¸à¹ˆà¸¡ verify/reject à¸„à¸·à¸­à¸—à¸²à¸‡à¹€à¸”à¸µà¸¢à¸§à¸—à¸µà¹ˆ partner staff à¹à¸à¹‰à¹„à¸‚
-- payments à¹„à¸”à¹‰ à¸ªà¹ˆà¸§à¸™ SELECT à¹€à¸›à¸´à¸”à¹ƒà¸«à¹‰à¸œà¹ˆà¸²à¸™ RLS à¸•à¸£à¸‡à¹† à¹„à¸”à¹‰à¸•à¸²à¸¡à¸•à¸²à¸£à¸²à¸‡à¸—à¸µà¹ˆà¸£à¸°à¸šà¸¸
--
-- à¸›à¸¥à¸­à¸”à¸ à¸±à¸¢à¸—à¸µà¹ˆà¸ˆà¸°à¸£à¸±à¸™à¸‹à¹‰à¸³ (idempotent) €” à¹ƒà¸Šà¹‰ IF NOT EXISTS / OR REPLACE à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”
-- ============================================================

-- ------------------------------------------------------------
-- Sequence à¸ªà¸³à¸«à¸£à¸±à¸šà¹€à¸¥à¸‚ order (à¹ƒà¸Šà¹‰à¹ƒà¸™ generate_order_number())
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq;

-- ------------------------------------------------------------
-- deposit_rules
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deposit_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL,
    deposit_type TEXT NOT NULL DEFAULT 'percentage',
    deposit_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
    pay_later_allowed BOOLEAN DEFAULT false,
    refund_policy TEXT,
    cancellation_policy TEXT,
    priority INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_service_type CHECK (service_type = ANY (ARRAY['clinic','hotel','transport','wellness','insurance'])),
    CONSTRAINT chk_deposit_type CHECK (deposit_type = ANY (ARRAY['percentage','fixed','none']))
);

CREATE INDEX IF NOT EXISTS idx_deposit_rules_lookup ON public.deposit_rules(service_type, organization_id) WHERE (active = true);

DROP TRIGGER IF EXISTS set_updated_at_deposit_rules ON public.deposit_rules;
CREATE TRIGGER set_updated_at_deposit_rules BEFORE UPDATE ON public.deposit_rules
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.deposit_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active deposit rules" ON public.deposit_rules;
CREATE POLICY "Anyone can view active deposit rules" ON public.deposit_rules
    FOR SELECT USING (active = true);

-- ------------------------------------------------------------
-- generate_order_number()
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_order_number()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
    next_val BIGINT;
BEGIN
    next_val := nextval('public.order_number_seq');
    RETURN 'WOS-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(next_val::TEXT, 5, '0');
END;
$function$;

-- ------------------------------------------------------------
-- orders
-- à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸: à¹„à¸¡à¹ˆà¸¡à¸µ RLS policy à¹ƒà¸”à¹† à¸šà¸™à¸•à¸²à¸£à¸²à¸‡à¸™à¸µà¹‰à¹‚à¸”à¸¢à¹€à¸ˆà¸•à¸™à¸² (à¸•à¸£à¸‡à¸à¸±à¸š payments) €”
-- à¹€à¸‚à¹‰à¸²à¸–à¸¶à¸‡/à¹à¸à¹‰à¹„à¸‚à¹„à¸”à¹‰à¸œà¹ˆà¸²à¸™ service-role client à¸ˆà¸²à¸ API routes à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL DEFAULT public.generate_order_number(),
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft',
    currency TEXT NOT NULL DEFAULT 'THB',
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_deposit_required NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_deposit_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_balance_remaining NUMERIC(12, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    cancelled_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT orders_order_number_key UNIQUE (order_number),
    CONSTRAINT chk_order_status CHECK (status = ANY (ARRAY['draft','pending_deposit','deposit_paid','confirmed','checked_in','completed','cancelled','refunded'])),
    CONSTRAINT chk_order_currency CHECK (currency = ANY (ARRAY['THB','LAK','USD']))
);

CREATE INDEX IF NOT EXISTS idx_orders_patient_id ON public.orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON public.orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);

DROP TRIGGER IF EXISTS set_updated_at_orders ON public.orders;
CREATE TRIGGER set_updated_at_orders BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
-- (à¹„à¸¡à¹ˆà¸¡à¸µ policy €” service-role only à¸•à¸²à¸¡à¸—à¸µà¹ˆà¸­à¸­à¸à¹à¸šà¸šà¹„à¸§à¹‰)

-- ------------------------------------------------------------
-- order_items
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,
    service_type TEXT NOT NULL,
    price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    deposit_required NUMERIC(12, 2) NOT NULL DEFAULT 0,
    deposit_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
    balance_remaining NUMERIC(12, 2) NOT NULL DEFAULT 0,
    scheduled_date DATE,
    scheduled_time TIME,
    status TEXT NOT NULL DEFAULT 'pending',
    deposit_rule_id UUID REFERENCES public.deposit_rules(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_item_service_type CHECK (service_type = ANY (ARRAY['clinic','hotel','transport','wellness','insurance'])),
    CONSTRAINT chk_item_status CHECK (status = ANY (ARRAY['pending','confirmed','checked_in','completed','cancelled','refunded']))
);

CREATE INDEX IF NOT EXISTS idx_order_items_org_id ON public.order_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_order_items_status ON public.order_items(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);

-- sync_order_item_balance(): à¸„à¸³à¸™à¸§à¸“ balance_remaining = price - deposit_paid
-- à¹ƒà¸«à¹‰à¸•à¸±à¸§à¹€à¸­à¸‡à¸—à¸¸à¸à¸„à¸£à¸±à¹‰à¸‡à¸—à¸µà¹ˆ insert/update à¹à¸–à¸§ (BEFORE, à¹€à¸žà¸·à¹ˆà¸­ set à¸„à¹ˆà¸²à¹ƒà¸™ NEW à¸à¹ˆà¸­à¸™à¸šà¸±à¸™à¸—à¸¶à¸)
CREATE OR REPLACE FUNCTION public.sync_order_item_balance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.balance_remaining := NEW.price - NEW.deposit_paid;
    RETURN NEW;
END;
$function$;

-- sync_order_totals(): à¸£à¸§à¸¡à¸¢à¸­à¸”à¸ˆà¸²à¸ order_items à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”à¸‚à¸­à¸‡ order à¹€à¸”à¸µà¸¢à¸§à¸à¸±à¸™
-- à¹à¸¥à¹‰à¸§à¸­à¸±à¸›à¹€à¸”à¸•à¸à¸¥à¸±à¸šà¹„à¸›à¸—à¸µà¹ˆ orders (AFTER, à¹€à¸žà¸£à¸²à¸°à¸•à¹‰à¸­à¸‡à¸­à¹ˆà¸²à¸™à¸„à¹ˆà¸²à¸—à¸µà¹ˆ commit à¹à¸¥à¹‰à¸§à¸‚à¸­à¸‡
-- order_items à¸—à¸¸à¸à¹à¸–à¸§à¹ƒà¸™ order à¸™à¸±à¹‰à¸™à¹€à¸žà¸·à¹ˆà¸­ SUM à¹ƒà¸«à¹‰à¸–à¸¹à¸à¸•à¹‰à¸­à¸‡ à¸£à¸§à¸¡à¸–à¸¶à¸‡à¸•à¸­à¸™ DELETE
-- à¸—à¸µà¹ˆà¹ƒà¸Šà¹‰ OLD.order_id)
CREATE OR REPLACE FUNCTION public.sync_order_totals()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

DROP TRIGGER IF EXISTS set_updated_at_order_items ON public.order_items;
CREATE TRIGGER set_updated_at_order_items BEFORE UPDATE ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS sync_order_item_balance_trigger ON public.order_items;
CREATE TRIGGER sync_order_item_balance_trigger BEFORE INSERT OR UPDATE ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public.sync_order_item_balance();

DROP TRIGGER IF EXISTS sync_order_totals_trigger ON public.order_items;
CREATE TRIGGER sync_order_totals_trigger AFTER INSERT OR UPDATE OR DELETE ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public.sync_order_totals();

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partners can view their organization's order items" ON public.order_items;
CREATE POLICY "Partners can view their organization's order items" ON public.order_items
    FOR SELECT USING (organization_id = (((auth.jwt() -> 'user_metadata'::text) ->> 'organization_id'::text))::uuid);

DROP POLICY IF EXISTS "Partners can update their organization's order items" ON public.order_items;
CREATE POLICY "Partners can update their organization's order items" ON public.order_items
    FOR UPDATE USING (organization_id = (((auth.jwt() -> 'user_metadata'::text) ->> 'organization_id'::text))::uuid);

-- ------------------------------------------------------------
-- payments
-- SELECT à¹€à¸›à¸´à¸”à¸œà¹ˆà¸²à¸™ RLS à¸•à¸£à¸‡à¹† à¹„à¸”à¹‰ à¹à¸•à¹ˆ INSERT/UPDATE à¹„à¸¡à¹ˆà¸¡à¸µ policy à¹€à¸¥à¸¢ €”
-- à¹‚à¸”à¸¢à¹€à¸ˆà¸•à¸™à¸² (à¸”à¸¹ comment à¸«à¸±à¸§à¹„à¸Ÿà¸¥à¹Œ) à¸•à¹‰à¸­à¸‡à¸œà¹ˆà¸²à¸™ /verify, /reject route à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES public.order_items(id) ON DELETE SET NULL,
    currency TEXT NOT NULL DEFAULT 'THB',
    amount NUMERIC(12, 2) NOT NULL,
    payment_method TEXT NOT NULL,
    payment_provider TEXT NOT NULL DEFAULT 'manual_transfer',
    transaction_reference TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    verified_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_payment_currency CHECK (currency = ANY (ARRAY['THB','LAK','USD'])),
    CONSTRAINT chk_payment_method CHECK (payment_method = ANY (ARRAY['one_bank_qr','bank_transfer','promptpay','cash_at_clinic','cash_at_hotel'])),
    CONSTRAINT chk_payment_status CHECK (status = ANY (ARRAY['pending','waiting_verification','verified','rejected','refunded','cancelled','expired']))
);

CREATE INDEX IF NOT EXISTS idx_payments_order_item_id ON public.payments(order_item_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments(order_id);

DROP TRIGGER IF EXISTS set_updated_at_payments ON public.payments;
CREATE TRIGGER set_updated_at_payments BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partners can view payments for their order items" ON public.payments;
CREATE POLICY "Partners can view payments for their order items" ON public.payments
    FOR SELECT USING (
        order_item_id IN (
            SELECT order_items.id FROM public.order_items
            WHERE order_items.organization_id = (((auth.jwt() -> 'user_metadata'::text) ->> 'organization_id'::text))::uuid
        )
    );

-- ------------------------------------------------------------
-- payment_attachments (à¸ªà¸¥à¸´à¸›à¹‚à¸­à¸™à¹€à¸‡à¸´à¸™ à¸¯à¸¥à¸¯) €” service-role only, à¹„à¸¡à¹ˆà¸¡à¸µ policy
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_attachments_payment_id ON public.payment_attachments(payment_id);

ALTER TABLE public.payment_attachments ENABLE ROW LEVEL SECURITY;
-- (à¹„à¸¡à¹ˆà¸¡à¸µ policy €” service-role only)

-- ------------------------------------------------------------
-- invoices €” service-role only, à¹„à¸¡à¹ˆà¸¡à¸µ policy
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    invoice_number TEXT,
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'THB',
    file_url TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number),
    CONSTRAINT chk_invoice_status CHECK (status = ANY (ARRAY['draft','issued','paid','void']))
);

CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON public.invoices(order_id);

DROP TRIGGER IF EXISTS set_updated_at_invoices ON public.invoices;
CREATE TRIGGER set_updated_at_invoices BEFORE UPDATE ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
-- (à¹„à¸¡à¹ˆà¸¡à¸µ policy €” service-role only)

-- ------------------------------------------------------------
-- settlements
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    gross_revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
    platform_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
    net_payable NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_settlement_status CHECK (status = ANY (ARRAY['pending','paid']))
);

CREATE INDEX IF NOT EXISTS idx_settlements_period ON public.settlements(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_settlements_org_id ON public.settlements(organization_id);

DROP TRIGGER IF EXISTS set_updated_at_settlements ON public.settlements;
CREATE TRIGGER set_updated_at_settlements BEFORE UPDATE ON public.settlements
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partners can view their organization's settlements" ON public.settlements;
CREATE POLICY "Partners can view their organization's settlements" ON public.settlements
    FOR SELECT USING (organization_id = (((auth.jwt() -> 'user_metadata'::text) ->> 'organization_id'::text))::uuid);
