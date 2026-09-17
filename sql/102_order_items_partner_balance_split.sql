-- ============================================================
-- 102_order_items_partner_balance_split.sql
--
-- Phase 5 — แยกเงิน 3 ก้อน (wos_business_rules_lock.md ข้อ 1):
--   package_price = wos_booking_fee + partner_balance, เสมอ
--
-- WHAT THIS ACTUALLY CHANGES vs. what the roadmap doc originally
-- described — read this before touching order_items again:
--
-- The roadmap (wos_phased_roadmap.md, Phase 5) describes this as
-- "เลิกใช้ deposit_amount ก้อนเดียว แยกเป็น package_price /
-- wos_booking_fee / partner_balance", implying a full rename of the
-- money columns on order_items. Having now read the actual live
-- schema (005/008_booking_payment_engine.sql) and every call site
-- (grep across sql/ and src/ — 20+ functions and files touch these
-- columns), that assumption doesn't match reality and a blind rename
-- would be the highest-risk change in the whole roadmap for no
-- benefit:
--
--   - order_items.price is ALREADY package_price — a standalone
--     column, never conflated with anything else. It has been since
--     migration 005.
--   - order_items.deposit_required is ALREADY wos_booking_fee — also
--     already its own column (computed from deposit_rules at
--     create_order_with_items()/admin_assign_order_item() time, see
--     059/096 and 058), not derived from anything else.
--   - There never was a single "deposit_amount" column in this
--     schema to eliminate. The brief's ข้อ 7 warning ("ห้ามมีฟิลด์
--     deposit_amount เดี่ยวๆ") was already satisfied before this
--     migration — nothing here needed splitting apart.
--
-- What's ACTUALLY missing is partner_balance itself: no column
-- anywhere stores "how much this partner is directly owed for this
-- item", so every part of the app that needed that number had to
-- compute it ad hoc — and inconsistently. Two different ad hoc
-- computations exist in the current codebase, and they mean two
-- different things:
--
--   1. order_items.price - order_items.deposit_required
--      = the STRUCTURAL split (what SHOULD be owed to the partner,
--      fixed at booking/assignment time, independent of payment
--      status). Nobody currently computes this anywhere in src/ —
--      admin and partner UIs show price/deposit_required/
--      deposit_paid/balance_remaining as raw numbers and leave the
--      reader to do the subtraction themselves.
--   2. order_items.price - order_items.deposit_paid
--      = a PAYMENT-PROGRESS figure (src/app/api/partner/payments/
--      [id]/verify/route.ts's `remainingBeforeThis`, and
--      orders.total_balance_remaining via admin_verify_payment/
--      sync_order_totals). This is what the "ช่องโหว่ business model"
--      in wos_business_rules_lock.md ข้อ 7 is about: partner staff
--      currently confirm customer payments by adding into the SAME
--      deposit_paid column WOS's own booking-fee tracking uses, so
--      this number silently mixes "WOS booking fee paid" with
--      "partner balance paid directly to the partner". That's a real
--      bug — but the fix for it (a dedicated
--      partner_payment_confirmations table + repointing
--      partner_verify_payment at wos_booking_fee only) is explicitly
--      Phase 6, which the roadmap itself says needs THIS migration
--      done first ("ต้องมีคอลัมน์ partner_balance แยกให้ยืนยันอะไร").
--      Rewiring what partner_verify_payment writes to is out of
--      scope here on purpose — doing it now, before the confirmation
--      table exists, would just move the bug instead of fixing it.
--
-- So instead of a rename, this migration adds partner_balance as a
-- GENERATED ALWAYS ... STORED column: partner_balance = price -
-- deposit_required, computed and kept correct by Postgres itself,
-- not by application code or a trigger that could drift. This gives
-- Phase 4 (commission_base = partner_balance, wos_business_rules_lock
-- ข้อ 2) and Phase 6 (partner confirms receipt of partner_balance) a
-- single, DB-enforced source of truth to read from, closes the gap
-- (1) above completely, and touches ZERO existing payment-verification
-- code paths — gap (2) is untouched here, deliberately, for Phase 6.
--
-- price/deposit_required stay exactly as they are: still nullable
-- (013_add_booking_details_and_pending_items.sql) for order_items
-- rows that haven't been assigned a package yet ("let team decide"),
-- so partner_balance is correctly NULL for those too until an admin
-- assigns — Postgres propagates NULL through the generated expression
-- automatically, no special-casing needed here.
--
-- orders.total_partner_balance mirrors the same pattern at the order
-- level (total_amount - total_deposit_required), same reasoning as
-- order_items — SUM of a GENERATED column across items would need a
-- trigger to stay in sync, but total_amount and total_deposit_required
-- are themselves already trigger-maintained sums (sync_order_totals,
-- migration 005), so total_partner_balance can safely be a generated
-- column of THOSE two columns without needing its own trigger.
--
-- Not touched by this migration, on purpose (see above): price,
-- deposit_required, deposit_paid, balance_remaining and every
-- function/route that reads or writes them —
-- create_order_with_items(), admin_assign_order_item(),
-- admin_verify_payment(), partner_verify_payment(),
-- partner_reject_payment(), sync_order_item_balance(),
-- sync_order_totals(). All of those keep working unmodified.
--
-- Idempotent — safe to re-run.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. order_items.partner_balance
-- ------------------------------------------------------------
ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS partner_balance NUMERIC(12,2)
    GENERATED ALWAYS AS (price - deposit_required) STORED;

COMMENT ON COLUMN public.order_items.price IS
    'This is package_price per wos_business_rules_lock.md ข้อ 1 — the full sale price of this line item before any split. Not renamed in migration 102 (see that file''s header) because it was never conflated with anything else to begin with.';

COMMENT ON COLUMN public.order_items.deposit_required IS
    'This is wos_booking_fee per wos_business_rules_lock.md ข้อ 1 — the amount the customer pays WOS directly to confirm the booking. Not renamed in migration 102 (see that file''s header) for the same reason as `price`.';

COMMENT ON COLUMN public.order_items.partner_balance IS
    'wos_business_rules_lock.md ข้อ 1 — the amount owed directly to the partner (price - deposit_required), i.e. package_price - wos_booking_fee. GENERATED, not writable — always structurally consistent by construction, never drifts from price/deposit_required, and does NOT move as deposit_paid changes (it is not a payment-progress figure, unlike balance_remaining — see order_items.balance_remaining''s comment). NULL until an admin assigns a package to a "let team decide" item (same nullability as price/deposit_required, migration 013). This is the commission_base Phase 4 will multiply by commission_rate_snapshot, and the amount Phase 6''s partner_payment_confirmations will track receipt of — do not repurpose this column''s meaning without updating both.';

COMMENT ON COLUMN public.order_items.deposit_paid IS
    'Amount actually paid toward deposit_required (wos_booking_fee) — a payment-progress figure, NOT the same axis as partner_balance. Known mixing issue: src/app/api/partner/payments/[id]/verify/route.ts currently also writes here when a PARTNER confirms a customer paid them directly (see wos_business_rules_lock.md ข้อ 7) — that''s a pre-existing bug this migration does not fix; Phase 6 moves that flow to a dedicated partner_payment_confirmations table instead.';

COMMENT ON COLUMN public.order_items.balance_remaining IS
    'price - deposit_paid — a payment-progress figure (how much of the TOTAL price is still unpaid via WOS-tracked payments), used to gate "pay now" UI. NOT the same thing as partner_balance: this number changes as deposit_paid changes and does not distinguish which portion (WOS fee vs partner balance) remains. Kept as-is by migration 102 — see that migration''s header for why it was not renamed/replaced.';

-- ------------------------------------------------------------
-- 2. orders.total_partner_balance — order-level mirror, same
--    reasoning as (1) above.
-- ------------------------------------------------------------
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS total_partner_balance NUMERIC(12,2)
    GENERATED ALWAYS AS (total_amount - total_deposit_required) STORED;

COMMENT ON COLUMN public.orders.total_partner_balance IS
    'SUM of order_items.partner_balance across this order (derived as total_amount - total_deposit_required, both of which are themselves already SUM-maintained by sync_order_totals()). Structural, not payment-progress — see order_items.partner_balance''s comment.';

COMMIT;

-- ------------------------------------------------------------
-- Sanity checks after applying:
-- ------------------------------------------------------------
-- 1. partner_balance always equals price - deposit_required exactly
--    (should be guaranteed by GENERATED, this just double-checks):
--   SELECT id FROM public.order_items
--   WHERE partner_balance IS DISTINCT FROM (price - deposit_required);
--   -- expect 0 rows
--
-- 2. Unassigned ("let team decide") items correctly show NULL, not 0:
--   SELECT id, needs_assignment, price, deposit_required, partner_balance
--   FROM public.order_items
--   WHERE needs_assignment = true LIMIT 5;
--   -- expect partner_balance IS NULL for these
--
-- 3. Order-level totals line up with the item-level SUM:
--   SELECT o.id, o.total_partner_balance,
--          (SELECT COALESCE(SUM(oi.partner_balance), 0)
--           FROM public.order_items oi WHERE oi.order_id = o.id) AS summed
--   FROM public.orders o
--   WHERE o.total_partner_balance IS DISTINCT FROM
--         (SELECT COALESCE(SUM(oi.partner_balance), 0)
--          FROM public.order_items oi WHERE oi.order_id = o.id)
--   LIMIT 5;
--   -- expect 0 rows (total_amount/total_deposit_required are already
--   -- correct sums per sync_order_totals(), so this should hold)
-- ============================================================
