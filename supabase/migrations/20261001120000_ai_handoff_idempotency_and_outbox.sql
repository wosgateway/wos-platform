-- ============================================================================
-- 125_ai_handoff_idempotency_and_outbox.sql
--
-- Feature: Fern (AI) -> WOS team handoff as a REAL transaction.
--
--   Conversation -> Journey State -> Confirmation -> consultation_request
--   -> notification_outbox -> Telegram
--
-- NOTE ON NUMBERING: 093..124 already exist in sql/ (093 = promo_banners),
-- so this is 125 — not "093" as originally planned.
--
-- What this migration does
--   1. consultation_requests: add idempotency_key (UNIQUE when present),
--      origin_channel, conversation_id, journey_snapshot.
--   2. consultation_requests.source CHECK: allow 'header' and 'ai_chat'.
--      ('header' is already accepted by src/app/api/consultation/route.ts
--      but was never allowed by the CHECK in 092 -> that form source would
--      500. Fixed here as a side benefit.)
--   3. notification_outbox: one row per (request, channel). Retryable,
--      lock-claimed, backoff-friendly. UNIQUE(request, channel) means a
--      retry can never create a second notification row.
--   4. submit_ai_handoff(): ATOMIC create-or-return-existing + outbox row,
--      all in one function = one transaction. DB decides duplicates via the
--      unique index (race-safe), not application code.
--   5. claim_outbox_batch(): FOR UPDATE SKIP LOCKED claim so two concurrent
--      workers/requests never send the same notification twice.
--
-- Safe to re-run (IF NOT EXISTS / OR REPLACE / guarded DROPs).
-- Does NOT touch existing rows, existing triggers, or existing policies on
-- consultation_requests (status-transition trigger and the server-field
-- lock trigger keep working: the RPC insert simply gets status='new').
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. consultation_requests: new columns
-- --------------------------------------------------------------------------
ALTER TABLE public.consultation_requests
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT
        CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 16 AND 128);

ALTER TABLE public.consultation_requests
    ADD COLUMN IF NOT EXISTS origin_channel TEXT NOT NULL DEFAULT 'web_form'
        CHECK (origin_channel IN ('web_form', 'ai_chat'));

ALTER TABLE public.consultation_requests
    ADD COLUMN IF NOT EXISTS conversation_id TEXT
        CHECK (conversation_id IS NULL OR char_length(conversation_id) <= 128);

ALTER TABLE public.consultation_requests
    ADD COLUMN IF NOT EXISTS journey_snapshot JSONB;

-- Partial unique index: legacy/web-form rows (key NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consultation_requests_idempotency_key
    ON public.consultation_requests (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- --------------------------------------------------------------------------
-- 2. source allowlist: add 'header' and 'ai_chat'
--    The auto-generated constraint name is not guaranteed, so find any CHECK
--    on this table that mentions the 'source' column and replace it.
-- --------------------------------------------------------------------------
DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'consultation_requests'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%source%'
          AND pg_get_constraintdef(con.oid) NOT ILIKE '%utm_source%'
    LOOP
        EXECUTE format('ALTER TABLE public.consultation_requests DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE public.consultation_requests
    DROP CONSTRAINT IF EXISTS consultation_requests_source_allowlist;

ALTER TABLE public.consultation_requests
    ADD CONSTRAINT consultation_requests_source_allowlist
    CHECK (source IN (
        'homepage_hero', 'homepage_bottom', 'header', 'partner_page',
        'package_page', 'knowledge_center', 'ai_chat', 'unknown'
    ));

-- --------------------------------------------------------------------------
-- 3. notification_outbox
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_outbox (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    consultation_request_id UUID NOT NULL
                            REFERENCES public.consultation_requests(id) ON DELETE CASCADE,

    channel                 TEXT NOT NULL
                            CHECK (channel IN ('telegram', 'email', 'line')),

    -- Pre-rendered message(s). Sender stays dumb; content is fixed at the
    -- moment the request was created.
    payload                 JSONB NOT NULL DEFAULT '{}'::jsonb,

    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead')),

    attempts                INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts            INT NOT NULL DEFAULT 6 CHECK (max_attempts BETWEEN 1 AND 20),
    next_attempt_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at               TIMESTAMPTZ,
    last_error              TEXT,
    sent_at                 TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A retry / double-confirm can never create a second notification.
    CONSTRAINT uq_notification_outbox_request_channel
        UNIQUE (consultation_request_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_due
    ON public.notification_outbox (next_attempt_at)
    WHERE status IN ('pending', 'failed', 'sending');

DROP TRIGGER IF EXISTS set_updated_at_notification_outbox ON public.notification_outbox;
CREATE TRIGGER set_updated_at_notification_outbox
    BEFORE UPDATE ON public.notification_outbox
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.notification_outbox FROM anon, authenticated;
GRANT SELECT ON public.notification_outbox TO authenticated;

DROP POLICY IF EXISTS "Platform admins can read notification_outbox" ON public.notification_outbox;
CREATE POLICY "Platform admins can read notification_outbox" ON public.notification_outbox
    FOR SELECT TO authenticated
    USING (is_platform_admin());
-- No INSERT/UPDATE/DELETE policy: only service_role (RPCs / Next.js server) writes.

-- --------------------------------------------------------------------------
-- 4. submit_ai_handoff — atomic, idempotent
--
--    Returns jsonb: { id, created, status }
--      created = true   -> this call inserted the row
--      created = false  -> same idempotency_key already existed; returns it
--
--    Concurrency: two simultaneous calls with the same key — the second
--    blocks on the unique index until the first commits, then hits
--    ON CONFLICT DO NOTHING and reads the committed row. Exactly one row.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_ai_handoff(
    p_idempotency_key  TEXT,
    p_conversation_id  TEXT,
    p_language         TEXT,
    p_name             TEXT,
    p_contact_channel  TEXT,
    p_contact_value    TEXT,
    p_country          TEXT,
    p_request_types    TEXT[],
    p_message          TEXT,
    p_travel_period    TEXT,
    p_journey_snapshot JSONB,
    p_notify_payload   JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id      UUID;
    v_created BOOLEAN := FALSE;
    v_status  TEXT;
BEGIN
    IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) < 16 THEN
        RAISE EXCEPTION 'submit_ai_handoff: idempotency key is required (min 16 chars)'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.consultation_requests (
        idempotency_key, origin_channel, conversation_id, source,
        language, name, contact_channel, contact_value, country,
        request_types, message, travel_period, journey_snapshot
    ) VALUES (
        p_idempotency_key, 'ai_chat', p_conversation_id, 'ai_chat',
        COALESCE(p_language, 'th'), p_name, p_contact_channel, p_contact_value, p_country,
        COALESCE(p_request_types, '{}'), p_message,
        COALESCE(p_travel_period, 'unspecified'), p_journey_snapshot
    )
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NOT NULL THEN
        v_created := TRUE;
    ELSE
        SELECT id INTO v_id
        FROM public.consultation_requests
        WHERE idempotency_key = p_idempotency_key;
    END IF;

    IF v_id IS NULL THEN
        -- Should be impossible (conflict implies the row exists); fail loudly
        -- so the caller never tells the customer "sent to team".
        RAISE EXCEPTION 'submit_ai_handoff: row neither inserted nor found'
            USING ERRCODE = 'XX000';
    END IF;

    -- Same transaction as the request. DO NOTHING on replay (and heals the
    -- row if an older version of this flow created a request without one).
    INSERT INTO public.notification_outbox (consultation_request_id, channel, payload)
    VALUES (v_id, 'telegram', COALESCE(p_notify_payload, '{}'::jsonb))
    ON CONFLICT (consultation_request_id, channel) DO NOTHING;

    SELECT status INTO v_status FROM public.consultation_requests WHERE id = v_id;

    RETURN jsonb_build_object('id', v_id, 'created', v_created, 'status', v_status);
END;
$$;

-- --------------------------------------------------------------------------
-- 5. claim_outbox_batch — safe for concurrent workers
--    Claims due rows (pending/failed, or 'sending' whose lock went stale
--    after 5 min = crashed worker), bumps attempts, marks 'sending'.
--    Rows that went stale AFTER exhausting attempts are marked 'dead'.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_outbox_batch(
    p_limit       INT DEFAULT 10,
    p_request_ids UUID[] DEFAULT NULL
)
RETURNS SETOF public.notification_outbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.notification_outbox
       SET status = 'dead',
           last_error = COALESCE(last_error, 'stalled while sending, attempts exhausted')
     WHERE status = 'sending'
       AND locked_at < now() - interval '5 minutes'
       AND attempts >= max_attempts;

    WITH picked AS (
        SELECT id
          FROM public.notification_outbox
         WHERE attempts < max_attempts
           AND (
                (status IN ('pending', 'failed') AND next_attempt_at <= now())
                OR (status = 'sending' AND locked_at < now() - interval '5 minutes')
           )
           AND (p_request_ids IS NULL OR consultation_request_id = ANY (p_request_ids))
         ORDER BY next_attempt_at
         LIMIT GREATEST(p_limit, 1)
         FOR UPDATE SKIP LOCKED
    )
    UPDATE public.notification_outbox o
       SET status = 'sending',
           attempts = o.attempts + 1,
           locked_at = now()
      FROM picked
     WHERE o.id = picked.id
    RETURNING o.*;
$$;

-- --------------------------------------------------------------------------
-- Lock the RPCs down to service_role (same convention as 027 / 116).
-- --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.submit_ai_handoff(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_ai_handoff(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, JSONB, JSONB
) TO service_role;

REVOKE ALL ON FUNCTION public.claim_outbox_batch(INT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_batch(INT, UUID[]) TO service_role;

-- ============================================================================
-- VERIFY after running (all should pass):
--
--  -- 1) same key twice -> one row, second call created=false
--  select public.submit_ai_handoff('test-key-0000000001','conv-1','th','ทดสอบ','phone',
--    '0800000000','TH',ARRAY['health_checkup'],'msg','unspecified','{}'::jsonb,'{"text":"hi"}'::jsonb);
--  select public.submit_ai_handoff('test-key-0000000001','conv-1','th','ทดสอบ','phone',
--    '0800000000','TH',ARRAY['health_checkup'],'msg','unspecified','{}'::jsonb,'{"text":"hi"}'::jsonb);
--  select count(*) from consultation_requests where idempotency_key='test-key-0000000001'; -- 1
--  select count(*) from notification_outbox o join consultation_requests r
--    on r.id=o.consultation_request_id where r.idempotency_key='test-key-0000000001';      -- 1
--
--  -- 2) anon cannot call it (expect permission denied):
--  --    set role anon; select public.submit_ai_handoff(...);
--
--  -- 3) cleanup:
--  delete from consultation_requests where idempotency_key='test-key-0000000001';
-- ============================================================================
