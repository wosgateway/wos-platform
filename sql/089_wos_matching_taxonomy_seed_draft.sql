-- ============================================================
-- MIGRATION 089: WOS Matching Taxonomy — Real Seed Content
--
-- STATUS: DRAFT FOR TEAM REVIEW — not yet approved content.
--
-- This fills in the 074 template with a realistic starter taxonomy
-- covering the specialties most common in Thailand/Laos medical
-- tourism (aesthetic surgery, dental, cardiology, orthopedics,
-- fertility, eye care, oncology, plus the neurology/wellness
-- categories 074 already seeded). It is meant to give the WOS
-- domain team something concrete to react to, edit, cut, or extend —
-- NOT to be run as-is against production.
--
-- ⚠️ TRANSLATION CAVEAT: name_lo (Lao) values below are a
-- best-effort draft, not verified by a native Lao speaker or
-- clinical reviewer. Medical vocabulary is exactly the place where a
-- wrong word matters — have the WOS Laos-market team review every
-- name_lo value before this reaches production. name_th/name_en are
-- more standard terminology and lower-risk, but still worth a
-- clinical sanity check (a doctor or medical-content reviewer, not
-- just a translator).
--
-- ⚠️ BUSINESS-FIT CAVEAT: this list is based on what's generally
-- common in the region's medical tourism industry, not on which
-- WOS partners actually offer which services today. Cross-check
-- against actual partner capabilities (existing free-text
-- packages.category / sub_category values, and partner_applications
-- .specialties) before finalizing — no point seeding "IVF" as a
-- specialty if no partner currently offers it.
--
-- Reused from 074's existing seed (not re-inserted here, ON CONFLICT
-- would just skip them anyway): health_categories 'neurology',
-- 'aesthetic-surgery', 'wellness-antiaging'; specialty 'neurology'
-- and 'plastic-surgery'; condition 'migraine'; treatments
-- 'rhinoplasty' and 'migraine-management'; health_goals
-- 'natural-result' and 'pain-relief'.
-- ============================================================


-- ------------------------------------------------------------
-- 1) health_categories — new top-level groupings alongside 074's
--    existing neurology / aesthetic-surgery / wellness-antiaging.
-- ------------------------------------------------------------
INSERT INTO public.health_categories (slug, name_th, name_en, name_lo, sort_order) VALUES
    ('dental',        'ทันตกรรม',              'Dentistry',            'ທັນຕະກຳ',                 40),
    ('cardiology',    'หัวใจและหลอดเลือด',     'Cardiology',           'ຫົວໃຈ ແລະ ຫລອດເລືອດ',     50),
    ('orthopedics',   'กระดูกและข้อ',          'Orthopedics',          'ກະດູກ ແລະ ຂໍ້ຕໍ່',         60),
    ('fertility',     'ภาวะมีบุตรยาก',         'Fertility',            'ບັນຫາການມີລູກຍາກ',        70),
    ('ophthalmology', 'จักษุ',                  'Eye Care',             'ຕາ',                       80),
    ('oncology',      'มะเร็งวิทยา',           'Oncology',             'ມະເຮັງວິທະຍາ',            90)
ON CONFLICT (slug) DO NOTHING;


-- ------------------------------------------------------------
-- 2) specialties — provider-facing. Reuses 074's 'neurology' and
--    'plastic-surgery' rows (already seeded, not repeated here).
-- ------------------------------------------------------------
INSERT INTO public.specialties (slug, name_th, name_en, name_lo, category_id) VALUES
    ('cosmetic-dermatology', 'ตจวิทยาความงาม', 'Cosmetic Dermatology', 'ຜິວໜັງຄວາມງາມ',
        (SELECT id FROM public.health_categories WHERE slug = 'aesthetic-surgery')),
    ('hair-restoration', 'ศัลยกรรมปลูกผม', 'Hair Restoration', 'ການປູກຜົມ',
        (SELECT id FROM public.health_categories WHERE slug = 'aesthetic-surgery')),
    ('general-dentistry', 'ทันตกรรมทั่วไป', 'General Dentistry', 'ທັນຕະກຳທົ່ວໄປ',
        (SELECT id FROM public.health_categories WHERE slug = 'dental')),
    ('orthodontics', 'ทันตกรรมจัดฟัน', 'Orthodontics', 'ທັນຕະກຳຈັດແຂ້ວ',
        (SELECT id FROM public.health_categories WHERE slug = 'dental')),
    ('oral-maxillofacial-surgery', 'ศัลยศาสตร์ช่องปากและแม็กซิลโลเฟเชียล',
        'Oral & Maxillofacial Surgery', 'ການຜ່າຕັດຊ່ອງປາກ ແລະ ໃບໜ້າ',
        (SELECT id FROM public.health_categories WHERE slug = 'dental')),
    ('cardiology-specialty', 'อายุรศาสตร์หัวใจ', 'Cardiology', 'ອາຍຸລະສາດຫົວໃຈ',
        (SELECT id FROM public.health_categories WHERE slug = 'cardiology')),
    ('cardiac-surgery', 'ศัลยศาสตร์หัวใจ', 'Cardiac Surgery', 'ການຜ່າຕັດຫົວໃຈ',
        (SELECT id FROM public.health_categories WHERE slug = 'cardiology')),
    ('orthopedic-surgery', 'ศัลยศาสตร์กระดูกและข้อ', 'Orthopedic Surgery', 'ການຜ່າຕັດກະດູກ ແລະ ຂໍ້ຕໍ່',
        (SELECT id FROM public.health_categories WHERE slug = 'orthopedics')),
    ('sports-medicine', 'เวชศาสตร์การกีฬา', 'Sports Medicine', 'ການແພດການກິລາ',
        (SELECT id FROM public.health_categories WHERE slug = 'orthopedics')),
    ('reproductive-medicine', 'เวชศาสตร์การเจริญพันธุ์', 'Reproductive Medicine', 'ການແພດການເກີດລູກ',
        (SELECT id FROM public.health_categories WHERE slug = 'fertility')),
    ('ophthalmology-specialty', 'จักษุวิทยา', 'Ophthalmology', 'ຈັກສຸວິທະຍາ',
        (SELECT id FROM public.health_categories WHERE slug = 'ophthalmology')),
    ('oncology-specialty', 'มะเร็งวิทยา', 'Oncology', 'ມະເຮັງວິທະຍາ',
        (SELECT id FROM public.health_categories WHERE slug = 'oncology')),
    ('neurosurgery', 'ศัลยศาสตร์ประสาท', 'Neurosurgery', 'ການຜ່າຕັດປະສາດ',
        (SELECT id FROM public.health_categories WHERE slug = 'neurology'))
ON CONFLICT (slug) DO NOTHING;


-- ------------------------------------------------------------
-- 3) conditions — patient-facing. Reuses 074's 'migraine'.
-- ------------------------------------------------------------
INSERT INTO public.conditions (slug, name_th, name_en, name_lo, category_id) VALUES
    ('knee-osteoarthritis', 'ข้อเข่าเสื่อม', 'Knee Osteoarthritis', 'ຂໍ້ເຂົ່າເສື່ອມ',
        (SELECT id FROM public.health_categories WHERE slug = 'orthopedics')),
    ('herniated-disc', 'หมอนรองกระดูกทับเส้นประสาท', 'Herniated Disc', 'ໝອນຮອງກະດູກທັບເສັ້ນປະສາດ',
        (SELECT id FROM public.health_categories WHERE slug = 'orthopedics')),
    ('cataract', 'ต้อกระจก', 'Cataract', 'ຕໍ້ກະຈົກ',
        (SELECT id FROM public.health_categories WHERE slug = 'ophthalmology')),
    ('refractive-error', 'สายตาผิดปกติ (สั้น/ยาว/เอียง)', 'Refractive Error', 'ສາຍຕາຜິດປົກກະຕິ',
        (SELECT id FROM public.health_categories WHERE slug = 'ophthalmology')),
    ('infertility', 'ภาวะมีบุตรยาก', 'Infertility', 'ພາວະມີລູກຍາກ',
        (SELECT id FROM public.health_categories WHERE slug = 'fertility')),
    ('missing-teeth', 'ฟันหายหรือฟันผุรุนแรง', 'Missing / Severely Decayed Teeth', 'ແຂ້ວຫາຍ ຫລື ແຂ້ວຜຸໜັກ',
        (SELECT id FROM public.health_categories WHERE slug = 'dental')),
    ('coronary-artery-disease', 'โรคหลอดเลือดหัวใจ', 'Coronary Artery Disease', 'ພະຍາດຫລອດເລືອດຫົວໃຈ',
        (SELECT id FROM public.health_categories WHERE slug = 'cardiology')),
    ('breast-cancer', 'มะเร็งเต้านม', 'Breast Cancer', 'ມະເຮັງເຕົ້ານົມ',
        (SELECT id FROM public.health_categories WHERE slug = 'oncology')),
    ('obesity', 'โรคอ้วน / น้ำหนักเกิน', 'Obesity / Overweight', 'ອ້ວນ / ນ້ຳໜັກເກີນ',
        (SELECT id FROM public.health_categories WHERE slug = 'wellness-antiaging'))
ON CONFLICT (slug) DO NOTHING;


-- ------------------------------------------------------------
-- 4) treatments — reuses 074's 'rhinoplasty' and 'migraine-management'.
-- ------------------------------------------------------------
INSERT INTO public.treatments (slug, name_th, name_en, name_lo, category_id) VALUES
    ('breast-augmentation', 'เสริมหน้าอก', 'Breast Augmentation', 'ການເສີມເຕົ້ານົມ',
        (SELECT id FROM public.health_categories WHERE slug = 'aesthetic-surgery')),
    ('liposuction', 'ดูดไขมัน', 'Liposuction', 'ການດູດໄຂມັນ',
        (SELECT id FROM public.health_categories WHERE slug = 'aesthetic-surgery')),
    ('face-lift', 'ยกกระชับใบหน้า', 'Face Lift', 'ການຍົກກະຊັບໃບໜ້າ',
        (SELECT id FROM public.health_categories WHERE slug = 'aesthetic-surgery')),
    ('hair-transplant', 'ปลูกผม', 'Hair Transplant', 'ການປູກຜົມ',
        (SELECT id FROM public.health_categories WHERE slug = 'aesthetic-surgery')),
    ('dental-implant', 'รากฟันเทียม', 'Dental Implant', 'ຮາກແຂ້ວທຽມ',
        (SELECT id FROM public.health_categories WHERE slug = 'dental')),
    ('teeth-whitening', 'ฟอกสีฟัน', 'Teeth Whitening', 'ການຟອກສີແຂ້ວ',
        (SELECT id FROM public.health_categories WHERE slug = 'dental')),
    ('lasik', 'เลสิก', 'LASIK', 'ເລສິກ',
        (SELECT id FROM public.health_categories WHERE slug = 'ophthalmology')),
    ('cataract-surgery', 'ผ่าตัดต้อกระจก', 'Cataract Surgery', 'ການຜ່າຕັດຕໍ້ກະຈົກ',
        (SELECT id FROM public.health_categories WHERE slug = 'ophthalmology')),
    ('ivf', 'เด็กหลอดแก้ว (IVF)', 'In Vitro Fertilization (IVF)', 'ການເຮັດເດັກຫລອດແກ້ວ (IVF)',
        (SELECT id FROM public.health_categories WHERE slug = 'fertility')),
    ('knee-replacement', 'ผ่าตัดเปลี่ยนข้อเข่า', 'Knee Replacement', 'ການຜ່າຕັດປ່ຽນຂໍ້ເຂົ່າ',
        (SELECT id FROM public.health_categories WHERE slug = 'orthopedics')),
    ('hip-replacement', 'ผ่าตัดเปลี่ยนข้อสะโพก', 'Hip Replacement', 'ການຜ່າຕັດປ່ຽນຂໍ້ສະໂພກ',
        (SELECT id FROM public.health_categories WHERE slug = 'orthopedics')),
    ('coronary-angioplasty', 'ขยายหลอดเลือดหัวใจ (บอลลูน)', 'Coronary Angioplasty', 'ການຂະຫຍາຍຫລອດເລືອດຫົວໃຈ',
        (SELECT id FROM public.health_categories WHERE slug = 'cardiology')),
    ('cabg', 'ผ่าตัดบายพาสหัวใจ', 'Coronary Artery Bypass Graft (CABG)', 'ການຜ່າຕັດບາຍພາດຫົວໃຈ',
        (SELECT id FROM public.health_categories WHERE slug = 'cardiology')),
    ('health-checkup-package', 'โปรแกรมตรวจสุขภาพประจำปี', 'Annual Health Checkup Package', 'ໂຄງການກວດສຸຂະພາບປະຈຳປີ',
        (SELECT id FROM public.health_categories WHERE slug = 'wellness-antiaging'))
ON CONFLICT (slug) DO NOTHING;


-- ------------------------------------------------------------
-- 5) health_goals — reuses 074's 'natural-result' and 'pain-relief'.
-- ------------------------------------------------------------
INSERT INTO public.health_goals (slug, name_th, name_en, name_lo, category_id) VALUES
    ('improved-mobility', 'เคลื่อนไหวได้คล่องขึ้น', 'Improved Mobility', 'ເຄື່ອນໄຫວໄດ້ດີຂຶ້ນ',
        (SELECT id FROM public.health_categories WHERE slug = 'orthopedics')),
    ('restored-fertility', 'มีบุตรได้สำเร็จ', 'Successful Conception', 'ມີລູກໄດ້ສຳເລັດ',
        (SELECT id FROM public.health_categories WHERE slug = 'fertility')),
    ('brighter-smile', 'รอยยิ้มที่มั่นใจขึ้น', 'A More Confident Smile', 'ຮອຍຍິ້ມທີ່ໝັ້ນໃຈຂຶ້ນ',
        (SELECT id FROM public.health_categories WHERE slug = 'dental')),
    ('clearer-vision', 'มองเห็นชัดเจนขึ้น', 'Clearer Vision', 'ເບິ່ງເຫັນຈະແຈ້ງຂຶ້ນ',
        (SELECT id FROM public.health_categories WHERE slug = 'ophthalmology')),
    ('weight-loss', 'ลดน้ำหนักและรูปร่างดีขึ้น', 'Weight Loss', 'ຫລຸດນ້ຳໜັກ',
        (SELECT id FROM public.health_categories WHERE slug = 'wellness-antiaging')),
    ('early-detection', 'ตรวจพบความเสี่ยงโรคตั้งแต่ระยะแรก', 'Early Disease Detection', 'ກວດພົບຄວາມສ່ຽງແຕ່ຫົວທີ',
        (SELECT id FROM public.health_categories WHERE slug = 'wellness-antiaging')),
    ('heart-health', 'สุขภาพหัวใจดีขึ้น', 'Better Heart Health', 'ສຸຂະພາບຫົວໃຈດີຂຶ້ນ',
        (SELECT id FROM public.health_categories WHERE slug = 'cardiology')),
    ('confidence-boost', 'ความมั่นใจในตัวเองเพิ่มขึ้น', 'Increased Self-confidence', 'ຄວາມໝັ້ນໃຈເພີ່ມຂຶ້ນ',
        (SELECT id FROM public.health_categories WHERE slug = 'aesthetic-surgery'))
ON CONFLICT (slug) DO NOTHING;


-- ============================================================
-- QA — same checks as 074's tail, re-run after seeding
-- ============================================================
SELECT 'specialties' AS tbl, count(*) AS row_count FROM public.specialties WHERE is_active
UNION ALL
SELECT 'conditions', count(*) FROM public.conditions WHERE is_active
UNION ALL
SELECT 'treatments', count(*) FROM public.treatments WHERE is_active
UNION ALL
SELECT 'health_goals', count(*) FROM public.health_goals WHERE is_active
UNION ALL
SELECT 'health_categories', count(*) FROM public.health_categories WHERE is_active;

-- Expected: no orphaned category_id references introduced by this file
SELECT 'specialties' AS tbl, count(*) FROM public.specialties s
    WHERE s.category_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.health_categories c WHERE c.id = s.category_id)
UNION ALL
SELECT 'conditions', count(*) FROM public.conditions co
    WHERE co.category_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.health_categories c WHERE c.id = co.category_id)
UNION ALL
SELECT 'treatments', count(*) FROM public.treatments t
    WHERE t.category_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.health_categories c WHERE c.id = t.category_id)
UNION ALL
SELECT 'health_goals', count(*) FROM public.health_goals hg
    WHERE hg.category_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.health_categories c WHERE c.id = hg.category_id);

-- Expected: no duplicate slugs within any single table
SELECT 'specialties' AS tbl, slug, count(*) FROM public.specialties GROUP BY slug HAVING count(*) > 1
UNION ALL
SELECT 'conditions', slug, count(*) FROM public.conditions GROUP BY slug HAVING count(*) > 1
UNION ALL
SELECT 'treatments', slug, count(*) FROM public.treatments GROUP BY slug HAVING count(*) > 1
UNION ALL
SELECT 'health_goals', slug, count(*) FROM public.health_goals GROUP BY slug HAVING count(*) > 1;
