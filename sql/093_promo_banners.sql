-- ============================================================
-- 093_promo_banners.sql
--
-- Phase 1 (data layer) of the homepage promo banner carousel
-- (PromoBannerSlider.tsx, currently rendering PLACEHOLDER_BANNERS —
-- see that file's header comment for the full 3-phase plan).
--
-- Adds:
--   1. public.promo_banners — one row per slide, admin-managed.
--   2. Storage bucket "promo-banners" — mirrors the partner-images
--      bucket (003_storage_bucket_partner_images.sql), but admin-only
--      (no org scoping, since these aren't partner-owned): all writes
--      go through the service-role client from admin API routes, same
--      pattern as src/app/api/admin/partners/upload-image/route.ts.
--      Size/MIME limits are set up front this time (partner-images
--      only got these later, in 059 — learning applied here instead
--      of as a follow-up patch).
--
-- display_order is a plain integer, not a fractional/lexicographic
-- key — the admin list is expected to stay small (a handful of
-- active slides at a time), so "renumber the whole list on reorder"
-- (same as PATCHing every row) is simpler than a fractional-index
-- scheme and there's no realistic N where that becomes a problem.
--
-- start_date/end_date are optional scheduling window on top of
-- is_active, for banners prepared ahead of a promotion and left to
-- expire on their own (mentioned as a nice-to-have in the phase
-- plan). Both nullable — a banner with neither is just gated by
-- is_active, same as every other admin-toggled table in this project.
--
-- Idempotent (IF NOT EXISTS / DROP+CREATE POLICY throughout, matching
-- 045/046/047/074/081). Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.promo_banners (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Full public URL (getPublicUrl() result, resolved and stored at
    -- upload time in PromoBannersManager.tsx) — same convention as
    -- partners.logo_url / partners.cover_image_url / packages.image_url,
    -- so fetchActivePromoBanners() can select it straight through with
    -- no per-request URL resolution.
    image_url      TEXT NOT NULL,
    -- Where the banner links when clicked — a partner page, a
    -- program, an external URL, whatever the promotion needs.
    -- Nullable: a purely decorative/announcement banner is fine with
    -- no click-through.
    link_url       TEXT,
    -- Admin-facing label AND the <img> alt text on the frontend
    -- (PromoBannerSlider.tsx's `alt` field) — not a headline rendered
    -- over the image. The uploaded image is expected to carry its own
    -- text/CTA baked in (see the phase-plan discussion: admin-uploaded
    -- images already contain their own copy, same reasoning as why
    -- PromoBanner has no separate heading/subheading columns).
    title          TEXT NOT NULL DEFAULT '',
    display_order  INTEGER NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    start_date     TIMESTAMPTZ,
    end_date       TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT promo_banners_date_window_check
        CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

COMMENT ON TABLE public.promo_banners IS
  'Homepage promo banner carousel slides (PromoBannerSlider.tsx), managed from admin PromoBannersManager.tsx. See 093_promo_banners.sql header for the 3-phase rollout this belongs to.';
COMMENT ON COLUMN public.promo_banners.title IS
  'Admin-facing label and frontend alt text — not a headline overlay. Uploaded images carry their own copy.';
COMMENT ON COLUMN public.promo_banners.display_order IS
  'Ascending sort key for slide order in the carousel. Plain integer, renumbered on reorder — list is expected to stay small.';

-- Active-slide list is read on every homepage load and sorted by
-- display_order — index both together so that's an index-only scan
-- instead of a sort over the whole table.
CREATE INDEX IF NOT EXISTS idx_promo_banners_active_order
    ON public.promo_banners (display_order)
    WHERE is_active = true;

DROP TRIGGER IF EXISTS set_updated_at_promo_banners ON public.promo_banners;
CREATE TRIGGER set_updated_at_promo_banners
    BEFORE UPDATE ON public.promo_banners
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.promo_banners ENABLE ROW LEVEL SECURITY;

-- Public (anon) read of currently-live rows only — this is what
-- fetchActivePromoBanners() in lib/data.ts queries with the anon
-- client. The date-window check is duplicated in that function's own
-- WHERE clause as an explicit app-level guard, same reasoning as
-- fetchPartnerById's .eq('status','active') comment (migration 048):
-- don't rely on RLS alone, even though RLS already enforces it here.
-- No public write policy: all writes go through the service-role
-- client in the admin API route (PromoBannersManager.tsx never talks
-- to this table directly).
DROP POLICY IF EXISTS "Public can read live promo banners" ON public.promo_banners;
CREATE POLICY "Public can read live promo banners" ON public.promo_banners
    FOR SELECT TO anon, authenticated
    USING (
        is_active = true
        AND (start_date IS NULL OR start_date <= now())
        AND (end_date IS NULL OR end_date >= now())
    );

-- ------------------------------------------------------------
-- 2. Storage bucket "promo-banners"
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'promo-banners',
    'promo-banners',
    true,
    5242880, -- 5MB, same ceiling as partner-images (059)
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "promo-banners public read" ON storage.objects;

-- Public read only. Unlike partner-images (003), there is
-- deliberately NO authenticated insert/update/delete policy here:
-- this bucket has no per-partner/per-org owner to scope a policy to
-- (every promo banner is a WOS-wide admin decision, not a partner's
-- own asset) — same reasoning as the "Deliberately NOT partner-id-
-- scoped" note in admin/partners/upload-image/route.ts. All writes
-- go through the admin API route's service-role client, which
-- bypasses RLS entirely, so no object-level write policy is needed
-- (or wanted — one would just be dead code no path ever uses).
CREATE POLICY "promo-banners public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'promo-banners');

-- ============================================================
-- VERIFY after running:
--
--   SELECT id, public, file_size_limit, allowed_mime_types
--   FROM storage.buckets WHERE id = 'promo-banners';
--   -- Expected: public = true, file_size_limit = 5242880
--
--   SELECT * FROM public.promo_banners; -- empty, table just created
--
--   SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('promo_banners') OR (tablename = 'objects' AND policyname LIKE 'promo-banners%');
-- ============================================================
