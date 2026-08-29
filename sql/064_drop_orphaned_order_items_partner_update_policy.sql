-- ============================================================
-- 064_drop_orphaned_order_items_partner_update_policy.sql
--
-- Finding (STEP 1 audit, live pg_policies dump):
--   Policy "Partners can update their organization's order items"
--   (UPDATE, USING/CHECK: partner_id = current_user_partner_id())
--   is row-scoped only. There is no column-level GRANT/REVOKE on
--   public.order_items anywhere in the migration history, so any
--   partner-role JWT can call:
--
--     supabase.from('order_items').update({ price, deposit_required,
--       deposit_paid, status }).eq('id', <own order_item>)
--
--   directly via PostgREST, bypassing /api/partner/order-items/[id]/status
--   and /notes entirely -- including the state-machine and ownership
--   checks those RPC-backed routes enforce.
--
-- Why this is safe to just DROP (not narrow):
--   As of migration 035, every legitimate partner write path
--   (partner_update_order_item_status, partner_update_order_item_notes)
--   already runs through SECURITY DEFINER RPCs that are
--   REVOKEd from anon/authenticated and GRANTed to service_role only.
--   grep across src/ confirms there is no direct
--   `.from('order_items').update(...)` call anywhere in the app under
--   an authenticated (non-service-role) context. This policy has had
--   no legitimate caller since 035 shipped -- it's dead surface area,
--   not a narrower permission to carve down.
--
-- Effect: partners lose the ability to write to order_items directly
-- via REST. They keep read access (SELECT policy untouched) and keep
-- all existing functionality through the two RPCs above, which is the
-- only path the app ever actually uses.
-- ============================================================

DROP POLICY IF EXISTS "Partners can update their organization's order items" ON public.order_items;

-- Explicit belt-and-suspenders: even if some future policy is added
-- back carelessly, authenticated should not hold blanket table-level
-- UPDATE on order_items. All legitimate mutation happens through
-- SECURITY DEFINER RPCs running as service_role, which bypasses RLS
-- and table grants entirely -- so authenticated does not need this.
REVOKE UPDATE ON public.order_items FROM authenticated;
REVOKE UPDATE ON public.order_items FROM anon;

-- Sanity check to run after applying, expected: 0 rows
-- (no UPDATE policy left on order_items for authenticated/anon)
--
-- select policyname, roles, cmd
-- from pg_policies
-- where schemaname = 'public' and tablename = 'order_items' and cmd = 'UPDATE';
