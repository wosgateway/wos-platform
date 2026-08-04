-- ============================================================
-- MIGRATION 010: link the payment engine to `partners`, not
-- `organizations`.
--
-- Context (confirmed against the live Supabase schema, not a
-- reconstructed file): the customer-facing catalog is real and
-- live — `partners` (12 rows), `packages` (9 rows, `partner_id` NOT
-- NULL, no `organization_id` column at all), `bookings` (5 rows).
-- `organizations` (2 rows), `partner_packages` (1 row), and
-- `partner_bookings` (0 rows) are an unlaunched parallel portal
-- build with essentially no real data.
--
-- Migration 008 built order_items/deposit_rules/settlements against
-- `organizations`, assuming that was the partner identity. It
-- isn't — `packages.partner_id` points at `partners`, and there is
-- no mapping between the 12 real partners and the 2 organizations
-- rows. Since none of this is live yet, we fix it at the root
-- instead of adding a translation layer: order_items/deposit_rules/
-- settlements now reference `partners` directly.
--
-- `organizations` gains a nullable `partner_id` link so that, later,
-- when a partner gets portal login access, their staff accounts
-- (via `users.organization_id`) resolve back to the real partner
-- whose orders/settlements they should see. Until that link is
-- populated for a given organizations row, that portal account sees
-- zero order_items/payments/settlements — RLS defaults closed, not
-- open, which is the safe direction for a payments table.
-- ============================================================

-- ------------------------------------------------------------
-- 1. organizations -> partners link (nullable; populate manually
--    per portal account as partners get onboarded to the portal)
-- ------------------------------------------------------------
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_partner_id ON public.organizations(partner_id);

-- ------------------------------------------------------------
-- 2. order_items.organization_id -> partner_id (references partners)
-- ------------------------------------------------------------
ALTER TABLE public.order_items RENAME COLUMN organization_id TO partner_id;
ALTER INDEX IF EXISTS idx_order_items_org_id RENAME TO idx_order_items_partner_id;

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_organization_id_fkey;
ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_partner_id_fkey
    FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE RESTRICT;
-- If this fails with a FK violation: some existing order_items row
-- references an organizations.id that isn't also a partners.id.
-- Given order_items has near-zero real rows right now, the fix is
-- almost certainly to delete that test row, not to preserve it.

-- ------------------------------------------------------------
-- 3. deposit_rules.organization_id -> partner_id (references partners)
-- ------------------------------------------------------------
ALTER TABLE public.deposit_rules RENAME COLUMN organization_id TO partner_id;

ALTER TABLE public.deposit_rules DROP CONSTRAINT IF EXISTS deposit_rules_organization_id_fkey;
ALTER TABLE public.deposit_rules
    ADD CONSTRAINT deposit_rules_partner_id_fkey
    FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_deposit_rules_lookup;
CREATE INDEX idx_deposit_rules_lookup ON public.deposit_rules(service_type, partner_id) WHERE active = true;

-- ------------------------------------------------------------
-- 4. settlements.organization_id -> partner_id (references partners)
-- ------------------------------------------------------------
ALTER TABLE public.settlements RENAME COLUMN organization_id TO partner_id;
ALTER INDEX IF EXISTS idx_settlements_org_id RENAME TO idx_settlements_partner_id;

ALTER TABLE public.settlements DROP CONSTRAINT IF EXISTS settlements_organization_id_fkey;
ALTER TABLE public.settlements
    ADD CONSTRAINT settlements_partner_id_fkey
    FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;

-- ------------------------------------------------------------
-- 5. Update RLS policies that referenced the old organization_id
--    columns / direct JWT-to-organization_id comparison. New logic:
--    a portal user's JWT still carries their organizations.id, but
--    that must now be translated to the linked partners.id (step 1)
--    before comparing to the renamed partner_id columns below.
-- ------------------------------------------------------------
ALTER POLICY "Partners can view their organization's order items" ON public.order_items
    USING (
        partner_id = (
            SELECT partner_id FROM public.organizations
            WHERE id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID
        )
    );

ALTER POLICY "Partners can update their organization's order items" ON public.order_items
    USING (
        partner_id = (
            SELECT partner_id FROM public.organizations
            WHERE id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID
        )
    );

ALTER POLICY "Partners can view their organization's settlements" ON public.settlements
    USING (
        partner_id = (
            SELECT partner_id FROM public.organizations
            WHERE id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID
        )
    );

-- payments policy from migration 009 — same two-branch item-level /
-- order-level logic, just repointed at the renamed column.
ALTER POLICY "Partners can view payments for their order items" ON public.payments
    USING (
        (
            order_item_id IS NOT NULL
            AND order_item_id IN (
                SELECT id FROM public.order_items
                WHERE partner_id = (
                    SELECT partner_id FROM public.organizations
                    WHERE id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID
                )
            )
        )
        OR
        (
            order_item_id IS NULL
            AND order_id IN (
                SELECT order_id FROM public.order_items
                WHERE partner_id = (
                    SELECT partner_id FROM public.organizations
                    WHERE id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID
                )
            )
        )
    );

-- ------------------------------------------------------------
-- NOTE: deposit_rules keeps its existing "Anyone can view active
-- deposit rules" public SELECT policy (migration 008) unchanged —
-- it was never organization_id-scoped to begin with, so nothing to
-- update there.
-- ------------------------------------------------------------
