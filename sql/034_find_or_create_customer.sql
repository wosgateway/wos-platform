-- ============================================================
-- 034_find_or_create_customer.sql
--
-- Fixes MEDIUM 3 from the security review: app/api/orders/route.ts
-- did an app-layer SELECT-then-INSERT to resolve `customers` by
-- phone (find by phone, create if none exists), which is not
-- race-safe — two concurrent requests for the same phone can both
-- miss the SELECT and both INSERT, producing duplicate customer rows.
--
-- IMPORTANT — this does NOT add a unique constraint on
-- customers.phone. Migration 011 deliberately left phone non-unique:
-- "a phone number isn't guaranteed to map 1:1 to a person (shared
-- household phones, re-issued numbers)". That's a business decision,
-- not an oversight, and the review's suggested fix (a unique index +
-- ON CONFLICT) would silently overturn it. Instead this closes the
-- *concurrency* race while keeping "same phone, different person" a
-- possibility: a Postgres advisory transaction lock is taken on the
-- phone number for the duration of find-or-create, so two concurrent
-- requests for the SAME phone serialize (second one sees the first's
-- committed row and reuses it) — but nothing stops two requests for
-- the same phone from resolving to the same customer either, which
-- is the intended common case (most repeat submissions from one
-- phone genuinely are the same person). If Boyd later wants "always
-- treat repeat phone as a new customer", that's a different function
-- entirely — flag it, don't fold it into this fix.
--
-- pg_advisory_xact_lock takes a bigint; phone numbers are hashed into
-- one via hashtextextended(text, seed). Lock is released automatically
-- at transaction end (COMMIT/ROLLBACK) — no manual unlock needed, and
-- it can't leak across requests since each RPC call is its own
-- implicit transaction.
--
-- Same lockdown pattern as every other RPC since migration 027:
-- REVOKE from PUBLIC *and* anon/authenticated explicitly (Supabase's
-- default-privileges auto-grant to anon/authenticated happens at
-- CREATE FUNCTION time and isn't touched by revoking from PUBLIC
-- alone — see 027's header for why), then GRANT to service_role only.
-- This function is only ever called from app/api/orders/route.ts via
-- the service-role client — never exposed to anon/authenticated.
--
-- Safe to re-run (CREATE OR REPLACE FUNCTION + idempotent grants).
--
-- REVISED after review: the review correctly pointed out that this
-- function alone doesn't fix identity-normalization — "0812345678",
-- "081-234-5678", " 0812345678 ", and "+66812345678" all hash/compare
-- as different phones here, so two differently-formatted submissions
-- of the SAME real number still produce two customer rows (not a
-- race, a normalization gap). Canonicalizing (deciding what "the
-- same number" means, incl. the Thai 0-prefix vs +66 guess) is
-- product logic, not something a generic DB function should silently
-- decide — that's done once, in src/lib/phone.ts, and applied in
-- app/api/orders/route.ts BEFORE calling this RPC. This function
-- only adds a defense-in-depth `btrim` in case a caller forgets —
-- it deliberately does NOT re-implement the +66/leading-zero guess,
-- so there's exactly one place that decision lives.
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_or_create_customer(
  p_phone TEXT,
  p_full_name TEXT,
  p_email TEXT DEFAULT NULL,
  p_line_id TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_preferred_language TEXT DEFAULT 'th'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
BEGIN
  IF p_phone IS NULL OR btrim(p_phone) = '' THEN
    RAISE EXCEPTION 'p_phone is required';
  END IF;
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'p_full_name is required';
  END IF;

  -- Defense-in-depth only — the real canonicalization (whitespace,
  -- dashes, +66-vs-leading-0) happens in src/lib/phone.ts before this
  -- RPC is ever called. This just guards against a caller that
  -- forgets, so " 0812345678 " and "0812345678" don't fork into two
  -- lock ids / two customer rows purely from stray whitespace.
  p_phone := btrim(p_phone);

  -- Serialize concurrent find-or-create calls for the SAME phone
  -- number only (different phones hash to different lock ids and
  -- don't block each other). Released automatically at transaction
  -- end.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_phone, 0));

  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE phone = p_phone
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF v_customer_id IS NOT NULL THEN
    RETURN v_customer_id;
  END IF;

  INSERT INTO public.customers (full_name, phone, email, line_id, country, preferred_language)
  VALUES (p_full_name, p_phone, p_email, p_line_id, p_country, COALESCE(p_preferred_language, 'th'))
  RETURNING id INTO v_customer_id;

  RETURN v_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_create_customer(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_or_create_customer(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.find_or_create_customer(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_customer(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
