-- ============================================================
-- MIGRATION 105: WOS Settlement Engine — FINAL
--
-- BUSINESS RULES
-- ------------------------------------------------------------
-- 1. Money direction:
--    Partner owes WOS commission.
--
-- 2. Settlement amount:
--    settlement_items.commission_amount
--    NOT partner_balance
--    NOT partner_balance_confirmed
--
-- 3. Eligibility:
--    order_items.status = 'completed'
--    AND completed_at IS NOT NULL
--    AND commission_amount > 0
--
-- 4. Settlement period:
--    Admin chooses arbitrary period_start / period_end.
--
-- 5. Commission:
--    Use the existing frozen order_items.commission_amount.
--    DO NOT recalculate historical commission.
--
-- 6. One order_item can only belong to one settlement.
--
-- 7. Existing completed items:
--    Because completed_at did not previously exist, existing
--    completed rows are backfilled from updated_at.
--    This is an approximation of completion time.
--
-- STATUS
--    CALCULATED -> APPROVED -> PAID -> LOCKED
--
-- ============================================================

BEGIN;

-- ============================================================
-- 0. PRE-FLIGHT SAFETY CHECKS
-- ============================================================

DO $$
DECLARE
    v_bad_completed_partner INTEGER;
    v_bad_completed_commission INTEGER;
    v_negative_commission INTEGER;
BEGIN

    -- Completed item must have a partner.
    SELECT COUNT(*)
    INTO v_bad_completed_partner
    FROM public.order_items
    WHERE status = 'completed'
      AND partner_id IS NULL;

    IF v_bad_completed_partner > 0 THEN
        RAISE EXCEPTION
            'MIGRATION 105 STOPPED: % completed order_items have NULL partner_id.',
            v_bad_completed_partner;
    END IF;


    -- Completed item must have commission_amount.
    SELECT COUNT(*)
    INTO v_bad_completed_commission
    FROM public.order_items
    WHERE status = 'completed'
      AND (
          commission_amount IS NULL
          OR commission_amount <= 0
      );

    IF v_bad_completed_commission > 0 THEN
        RAISE EXCEPTION
            'MIGRATION 105 STOPPED: % completed order_items have NULL/zero/negative commission_amount.',
            v_bad_completed_commission;
    END IF;


    -- No negative commission anywhere.
    SELECT COUNT(*)
    INTO v_negative_commission
    FROM public.order_items
    WHERE commission_amount < 0;

    IF v_negative_commission > 0 THEN
        RAISE EXCEPTION
            'MIGRATION 105 STOPPED: % order_items have negative commission_amount.',
            v_negative_commission;
    END IF;

END $$;


-- ============================================================
-- 1. ADD completed_at
-- ============================================================

ALTER TABLE public.order_items
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;


-- ============================================================
-- 2. BACKFILL EXISTING COMPLETED ITEMS
--
-- Existing rows do not have historical first-completed timestamp.
-- Use updated_at as the best available historical timestamp.
--
-- Future status transitions will use the trigger below.
-- ============================================================

UPDATE public.order_items
SET completed_at = COALESCE(completed_at, updated_at)
WHERE status = 'completed'
  AND completed_at IS NULL;


-- ============================================================
-- 3. completed_at TRIGGER
--
-- Set only on first transition to completed.
-- Never overwrite an existing completed_at.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_order_item_completed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN

    IF NEW.status = 'completed'
       AND (
            OLD.status IS DISTINCT FROM 'completed'
       )
       AND NEW.completed_at IS NULL
    THEN
        NEW.completed_at := NOW();
    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_order_item_completed_at
ON public.order_items;


CREATE TRIGGER trg_order_item_completed_at
BEFORE UPDATE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.set_order_item_completed_at();


-- Also handle INSERT of an already-completed item.
DROP TRIGGER IF EXISTS trg_order_item_completed_at_insert
ON public.order_items;


CREATE TRIGGER trg_order_item_completed_at_insert
BEFORE INSERT ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.set_order_item_completed_at();


-- ============================================================
-- 4. INDEX FOR SETTLEMENT ELIGIBILITY
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_order_items_settlement_eligibility
ON public.order_items (
    partner_id,
    completed_at
)
WHERE status = 'completed'
  AND commission_amount > 0;


-- ============================================================
-- 5. REMOVE OLD SETTLEMENT STRUCTURE
--
-- Old settlement model encoded:
-- gross_revenue / platform_fee / net_payable
--
-- New model:
-- partner owes WOS commission.
-- ============================================================

DROP TABLE IF EXISTS public.settlement_items CASCADE;

DROP TABLE IF EXISTS public.settlements CASCADE;


-- ============================================================
-- 6. CREATE NEW settlements
-- ============================================================

CREATE TABLE public.settlements (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    partner_id UUID NOT NULL
        REFERENCES public.partners(id)
        ON DELETE RESTRICT,

    period_start DATE NOT NULL,

    period_end DATE NOT NULL,

    total_commission_due NUMERIC(14,2)
        NOT NULL DEFAULT 0,

    item_count INTEGER
        NOT NULL DEFAULT 0,

    status TEXT NOT NULL DEFAULT 'CALCULATED'
        CHECK (
            status IN (
                'CALCULATED',
                'APPROVED',
                'PAID',
                'LOCKED'
            )
        ),

    created_by UUID NULL,

    approved_at TIMESTAMPTZ NULL,

    paid_at TIMESTAMPTZ NULL,

    locked_at TIMESTAMPTZ NULL,

    created_at TIMESTAMPTZ
        NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        NOT NULL DEFAULT NOW(),

    CONSTRAINT settlements_period_valid
        CHECK (period_end >= period_start),

    CONSTRAINT settlements_total_nonnegative
        CHECK (total_commission_due >= 0),

    CONSTRAINT settlements_item_count_nonnegative
        CHECK (item_count >= 0)
);


-- ============================================================
-- 7. CREATE settlement_items
--
-- Freeze the financial values at settlement creation.
-- ============================================================

CREATE TABLE public.settlement_items (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    settlement_id UUID NOT NULL
        REFERENCES public.settlements(id)
        ON DELETE CASCADE,

    order_item_id UUID NOT NULL
        REFERENCES public.order_items(id)
        ON DELETE RESTRICT,

    -- Snapshot only.
    -- This is NOT the settlement amount.
    partner_balance NUMERIC(14,2)
        NOT NULL DEFAULT 0,

    -- Actual amount partner owes WOS.
    commission_amount NUMERIC(14,2)
        NOT NULL,

    created_at TIMESTAMPTZ
        NOT NULL DEFAULT NOW(),

    CONSTRAINT settlement_items_commission_nonnegative
        CHECK (commission_amount >= 0),

    CONSTRAINT settlement_items_partner_balance_nonnegative
        CHECK (partner_balance >= 0),

    CONSTRAINT settlement_items_unique_order_item
        UNIQUE (order_item_id)
);


-- ============================================================
-- 8. INDEXES
-- ============================================================

CREATE INDEX idx_settlements_partner
ON public.settlements(partner_id);


CREATE INDEX idx_settlements_period
ON public.settlements(period_start, period_end);


CREATE INDEX idx_settlements_status
ON public.settlements(status);


CREATE INDEX idx_settlement_items_settlement
ON public.settlement_items(settlement_id);


CREATE INDEX idx_settlement_items_order_item
ON public.settlement_items(order_item_id);


-- ============================================================
-- 9. UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_settlement_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_settlement_updated_at
ON public.settlements;


CREATE TRIGGER trg_settlement_updated_at
BEFORE UPDATE ON public.settlements
FOR EACH ROW
EXECUTE FUNCTION public.set_settlement_updated_at();


-- ============================================================
-- 10. ENABLE RLS
--
-- No client policies.
-- Settlement financial data is service-role/admin controlled.
-- ============================================================

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.settlement_items ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 11. COMMENTS
-- ============================================================

COMMENT ON TABLE public.settlements IS
'WOS partner commission settlement. Partner owes WOS the commission amount.';

COMMENT ON COLUMN public.settlements.total_commission_due IS
'Frozen total commission owed by partner to WOS.';

COMMENT ON COLUMN public.settlements.period_start IS
'Admin-selected settlement period start date.';

COMMENT ON COLUMN public.settlements.period_end IS
'Admin-selected settlement period end date.';

COMMENT ON TABLE public.settlement_items IS
'Frozen order-item level records included in a WOS settlement.';

COMMENT ON COLUMN public.settlement_items.commission_amount IS
'Actual amount owed by partner to WOS for this order item.';

COMMENT ON COLUMN public.settlement_items.partner_balance IS
'Snapshot of customer/partner balance at settlement creation. Not the WOS commission amount.';

COMMENT ON COLUMN public.order_items.completed_at IS
'Timestamp when order item first became completed. Existing historical completed rows were backfilled from updated_at by Migration 105.';


-- ============================================================
-- 12. VALIDATION AFTER STRUCTURE CREATION
-- ============================================================

DO $$
DECLARE
    v_completed_without_date INTEGER;
BEGIN

    SELECT COUNT(*)
    INTO v_completed_without_date
    FROM public.order_items
    WHERE status = 'completed'
      AND completed_at IS NULL;

    IF v_completed_without_date > 0 THEN
        RAISE EXCEPTION
            'MIGRATION 105 STOPPED: % completed items still have NULL completed_at.',
            v_completed_without_date;
    END IF;

END $$;


-- ============================================================
-- 13. FINAL COMMENT
-- ============================================================

COMMENT ON TABLE public.settlements IS
'WOS Settlement Engine v105. Partner owes WOS commission. Settlement amount = settlement_items.commission_amount.';


COMMIT;


-- ============================================================
-- POST-MIGRATION CHECKS
-- Run these AFTER migration 105 succeeds.
-- ============================================================

-- 1. Settlement table structure
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'settlements'
ORDER BY ordinal_position;


-- 2. Settlement items structure
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'settlement_items'
ORDER BY ordinal_position;


-- 3. Completed items
SELECT
    COUNT(*) AS completed_items,
    COUNT(*) FILTER (
        WHERE completed_at IS NULL
    ) AS missing_completed_at,
    COUNT(*) FILTER (
        WHERE commission_amount IS NULL
           OR commission_amount <= 0
    ) AS invalid_commission
FROM public.order_items
WHERE status = 'completed';


-- 4. Commission summary by status
SELECT
    status,
    COUNT(*) AS item_count,
    COALESCE(SUM(price), 0) AS total_price,
    COALESCE(SUM(commission_amount), 0) AS total_commission
FROM public.order_items
GROUP BY status
ORDER BY status;


-- 5. Commission snapshot quality
SELECT
    COUNT(*) AS completed_items,
    COUNT(*) FILTER (
        WHERE commission_rate_snapshot IS NULL
    ) AS rate_snapshot_null,
    COUNT(*) FILTER (
        WHERE commission_rate_snapshot IS NOT NULL
    ) AS rate_snapshot_present,
    COALESCE(SUM(commission_amount), 0) AS total_commission
FROM public.order_items
WHERE status = 'completed';


-- 6. Eligible settlement pool
SELECT
    partner_id,
    COUNT(*) AS eligible_items,
    SUM(commission_amount) AS commission_due
FROM public.order_items oi
WHERE oi.status = 'completed'
  AND oi.completed_at IS NOT NULL
  AND oi.commission_amount > 0
GROUP BY partner_id
ORDER BY commission_due DESC;