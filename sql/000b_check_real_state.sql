-- ============================================================
-- 000b_check_real_state.sql
-- Purpose: the earlier assumption (organization_id columns, no
-- customers table yet) was WRONG — actual schema already has
-- partner_id columns and a customers table. This script finds
-- out the REAL current state before touching anything.
-- All read-only. Safe to run anytime.
-- ============================================================

-- 1) Does a `patients` table still exist, and what does orders.patient_id
--    actually point to right now?
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'patients';

-- 2) What foreign keys currently exist on orders, order_items,
--    deposit_rules, settlements, organizations? (shows source column,
--    target table/column, constraint name)
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name  AS references_table,
  ccu.column_name AS references_column,
  tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('orders', 'order_items', 'deposit_rules', 'settlements', 'organizations')
ORDER BY tc.table_name, kcu.column_name;

-- 3) Data integrity check: does every partner_id in these 3 tables
--    actually match a real row in `partners`? (should be empty if 010
--    already ran cleanly)
SELECT 'order_items' AS table_name, oi.id, oi.partner_id
FROM public.order_items oi
LEFT JOIN public.partners p ON p.id = oi.partner_id
WHERE oi.partner_id IS NOT NULL AND p.id IS NULL
UNION ALL
SELECT 'deposit_rules', dr.id, dr.partner_id
FROM public.deposit_rules dr
LEFT JOIN public.partners p ON p.id = dr.partner_id
WHERE dr.partner_id IS NOT NULL AND p.id IS NULL
UNION ALL
SELECT 'settlements', s.id, s.partner_id
FROM public.settlements s
LEFT JOIN public.partners p ON p.id = s.partner_id
WHERE s.partner_id IS NOT NULL AND p.id IS NULL;

-- 4) orders.patient_id values — are they real UUIDs pointing at
--    an existing `patients` table row, or at a `customers` row,
--    or neither?
SELECT id, order_number, patient_id, status, created_at
FROM public.orders;

-- 5) Row counts for full context
SELECT 'orders' AS table_name, count(*) FROM public.orders
UNION ALL
SELECT 'order_items', count(*) FROM public.order_items
UNION ALL
SELECT 'deposit_rules', count(*) FROM public.deposit_rules
UNION ALL
SELECT 'settlements', count(*) FROM public.settlements
UNION ALL
SELECT 'partners', count(*) FROM public.partners
UNION ALL
SELECT 'organizations', count(*) FROM public.organizations
UNION ALL
SELECT 'customers', count(*) FROM public.customers;
