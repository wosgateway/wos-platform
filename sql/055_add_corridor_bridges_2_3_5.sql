-- ============================================================
-- MIGRATION 055: add Thai-Lao Friendship Bridges 2, 3, 5 as
-- transit_points (corridor border crossings)
--
-- 046 seeded only Bridge 1 (Nong Khai-Vientiane) plus the two main
-- airports. This adds the three other corridor crossings relevant to
-- WOS's medical-journey routes:
--   Bridge 2 — Mukdahan (TH) <-> Savannakhet (LA)
--   Bridge 3 — Nakhon Phanom (TH) <-> Thakhek, Khammouane (LA)
--   Bridge 5 — Bueng Kan (TH) <-> Pakxan, Bolikhamxay (LA)
-- (Bridge 4, Chiang Khong-Houayxay, and Bridge 6, under construction,
-- are outside the current corridor and intentionally not added here.)
--
-- Coordinates are each bridge's Mekong crossing point (public
-- reference sources), same "approximate, eyeball-verified" tier as
-- the 046 seed — not yet run through the partner-style verification
-- workflow, per 046's seed-data note.
--
-- Purely additive. Relies entirely on schema/RLS/trigger/unique
-- constraint already established in 046 — no DDL here, just seed rows
-- through the same idempotent ON CONFLICT (type, latitude, longitude)
-- pattern.
-- ============================================================

INSERT INTO public.transit_points (name_th, name_en, name_lo, type, latitude, longitude)
VALUES
    ('สะพานมิตรภาพไทย-ลาว 2 (มุกดาหาร-สะหวันนะเขต)', 'Second Thai-Lao Friendship Bridge (Mukdahan-Savannakhet)', 'ຂົວມິດຕະພາບ ລາວ-ໄທ 2 (ສະຫວັນນະເຂດ)', 'border_crossing', 16.6011, 104.7358),
    ('สะพานมิตรภาพไทย-ลาว 3 (นครพนม-คำม่วน)', 'Third Thai-Lao Friendship Bridge (Nakhon Phanom-Thakhek)', 'ຂົວມິດຕະພາບ ລາວ-ໄທ 3 (ທ່າແຂກ)', 'border_crossing', 17.4925, 104.7283),
    ('สะพานมิตรภาพไทย-ลาว 5 (บึงกาฬ-บอลิคำไซ)', 'Fifth Thai-Lao Friendship Bridge (Bueng Kan-Bolikhamxay)', 'ຂົວມິດຕະພາບ ລາວ-ໄທ 5 (ປາກຊັນ)', 'border_crossing', 18.4061, 103.5683)
-- Conflict target matches transit_points_unique_location from 046,
-- so this is safe to re-run.
ON CONFLICT (type, latitude, longitude) DO NOTHING;

-- ============================================================
-- QA — run after applying
-- ============================================================

-- Expected: 6 border crossings total (1 from 046 + 3 from this file
-- + the pre-existing count could differ if 046 was re-run; the point
-- is border_crossing count should now be 4, not necessarily 6 overall
-- once airports are included)
SELECT type, count(*) FROM public.transit_points GROUP BY type ORDER BY type;

-- Expected: 4 rows, all with geom populated (trigger fires on insert)
SELECT name_en, latitude, longitude, geom IS NOT NULL AS has_geom
FROM public.transit_points
WHERE type = 'border_crossing'
ORDER BY name_en;

-- Expected: no rows (no duplicate coordinates introduced)
SELECT type, latitude, longitude, COUNT(*)
FROM public.transit_points
GROUP BY type, latitude, longitude
HAVING COUNT(*) > 1;

-- Re-running this file a second time should not change the count
-- from the first run's result — confirms ON CONFLICT held.
