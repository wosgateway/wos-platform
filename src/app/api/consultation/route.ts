// app/api/consultation/route.ts
//
// PUBLIC endpoint backing the /[locale]/consultation form ("ปรึกษา WOS
// ฟรี"). Unlike ApplyForm.tsx (which writes straight from the browser
// into `cases` via the anon Supabase client), this route deliberately
// goes through the server:
//
//   1. `consultation_requests` holds real customer contact details for
//      a Healthcare product (spec §12) — validation and sanitization
//      belong server-side, not just in the browser form.
//   2. IP-based rate limiting (spec §12 "Rate limiting / anti-spam")
//      can only happen server-side — see src/lib/rate-limit.ts, used
//      the same way src/app/api/my-trip/lookup/route.ts uses it.
//   3. `ip_address` / `user_agent` must come from the real request,
//      not from the client's JSON body (see 091_consultation_requests.sql
//      header notes) — only a server has access to those.
//
// Defense in depth on `status` / `created_at` / `internal_notes` /
// `contacted_by` / `contacted_at`: the DB (BEFORE INSERT trigger +
// RLS WITH CHECK) already forces these regardless of payload, but we
// still never forward client-supplied values for them here — belt and
// suspenders, and it keeps this route honest about what a client is
// allowed to influence.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';
import { notifyNewConsultation } from '@/lib/notify/consultation-notify';

// Keep this list in sync with the CHECK constraint in
// 091_consultation_requests.sql. Validating here too means a bad
// value gets a clean 400 with a field name instead of a raw
// Postgres constraint-violation error bubbling up to the client.
const CONTACT_CHANNELS = ['phone', 'whatsapp', 'line', 'email', 'other'] as const;
const REQUEST_TYPES = [
  'health_checkup',
  'medical_treatment',
  'dental',
  'wellness',
  'aesthetic',
  'hospital_clinic',
  'hotel',
  'transport',
  'not_sure',
] as const;
const TRAVEL_PERIODS = [
  'unspecified',
  'within_1_month',
  '1_to_3_months',
  'more_than_3_months',
] as const;
const SOURCES = [
  'homepage_hero',
  'homepage_bottom',
  'partner_page',
  'package_page',
  'knowledge_center',
  'unknown',
] as const;
const LANGUAGES = ['th', 'en', 'lo'] as const;

type ContactChannel = (typeof CONTACT_CHANNELS)[number];
type RequestType = (typeof REQUEST_TYPES)[number];
type TravelPeriod = (typeof TRAVEL_PERIODS)[number];
type Source = (typeof SOURCES)[number];
type Language = (typeof LANGUAGES)[number];

interface ConsultationRequestBody {
  language?: string;
  name?: string;
  contact_channel?: string;
  contact_value?: string;
  country?: string;
  request_types?: unknown;
  message?: string;
  travel_period?: string;
  source?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
}

// Collapses runs of whitespace, strips control characters, and caps
// length. This is not HTML-sanitization (we never render these as
// HTML) — it's just making sure free-text fields can't smuggle in
// junk that breaks admin UI rendering or logs.
function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return stripped.trim().slice(0, maxLength);
}

function isValidEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const userAgent = cleanText(request.headers.get('user-agent'), 300);

  let body: ConsultationRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // IP-wide cap first, before touching the DB at all — cheapest way
  // to shed abuse. 5 submissions/hour per IP: generous for a genuine
  // visitor filling the form once, tight enough to blunt a script.
  const ipLimit = await simpleRateLimit(`consultation-create:ip:${ip}`, 5, 60 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: 'มีการส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง' },
      { status: 429 }
    );
  }

  // -- Required fields --------------------------------------------------
  const name = cleanText(body.name, 100);
  if (!name) {
    return NextResponse.json({ error: 'กรุณากรอกชื่อ', field: 'name' }, { status: 400 });
  }

  const contactChannel = body.contact_channel;
  if (!isValidEnum<ContactChannel>(contactChannel, CONTACT_CHANNELS)) {
    return NextResponse.json(
      { error: 'กรุณาเลือกช่องทางติดต่อที่ถูกต้อง', field: 'contact_channel' },
      { status: 400 }
    );
  }

  const contactValue = cleanText(body.contact_value, 100);
  if (contactValue.length < 3) {
    return NextResponse.json(
      { error: 'กรุณากรอกช่องทางติดต่อ', field: 'contact_value' },
      { status: 400 }
    );
  }

  const country = cleanText(body.country, 100);
  if (!country) {
    return NextResponse.json({ error: 'กรุณาเลือกประเทศ', field: 'country' }, { status: 400 });
  }

  // -- request_types: array subset of the allowlist ----------------------
  const rawRequestTypes = Array.isArray(body.request_types) ? body.request_types : [];
  const requestTypes = Array.from(
    new Set(rawRequestTypes.filter((t): t is RequestType => isValidEnum<RequestType>(t, REQUEST_TYPES)))
  );
  if (requestTypes.length === 0) {
    return NextResponse.json(
      { error: 'กรุณาเลือกสิ่งที่ต้องการอย่างน้อย 1 ข้อ', field: 'request_types' },
      { status: 400 }
    );
  }

  // -- Optional fields, each defaulted and validated ---------------------
  const message = cleanText(body.message, 2000) || null;

  const travelPeriod: TravelPeriod = isValidEnum<TravelPeriod>(body.travel_period, TRAVEL_PERIODS)
    ? body.travel_period
    : 'unspecified';

  const source: Source = isValidEnum<Source>(body.source, SOURCES) ? body.source : 'unknown';

  const language: Language = isValidEnum<Language>(body.language, LANGUAGES) ? body.language : 'th';

  const utmSource = cleanText(body.utm_source, 100) || null;
  const utmMedium = cleanText(body.utm_medium, 100) || null;
  const utmCampaign = cleanText(body.utm_campaign, 100) || null;
  const utmContent = cleanText(body.utm_content, 100) || null;

  // -- Insert --------------------------------------------------------------
  // Service-role client: RLS's public INSERT policy would also allow
  // this write from the anon key directly, but going through the
  // service role here keeps every consultation write on one audited
  // path (this route) instead of two (this route + a hypothetical
  // direct client insert), and lets us set ip_address/user_agent,
  // which anon clients can never truthfully supply themselves.
  //
  // status / created_at / internal_notes / contacted_by / contacted_at
  // are intentionally omitted from this insert — never take them from
  // `body`. The DB trigger (lock_consultation_request_server_fields)
  // forces them regardless, but we don't even give it something to
  // override.
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('consultation_requests')
    .insert({
      language,
      name,
      contact_channel: contactChannel,
      contact_value: contactValue,
      country,
      request_types: requestTypes,
      message,
      travel_period: travelPeriod,
      source,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      ip_address: ip,
      user_agent: userAgent || null,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('consultation submit: insert failed', error);
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' },
      { status: 500 }
    );
  }

  // Best-effort and non-blocking to the *customer* (the row is already
  // saved either way), but we do await it here rather than truly
  // fire-and-forget — on serverless (Vercel) an un-awaited promise can
  // get killed the instant this function returns its response, so an
  // un-awaited call here would silently never fire. Same reasoning as
  // notifyNewOrder()'s call site in src/app/api/orders/route.ts.
  // notifyNewConsultation() itself never throws (see
  // src/lib/notify/consultation-notify.ts), so this can't turn into a
  // 500 for the customer even if the email channel is down/unconfigured.
  try {
    await notifyNewConsultation({
      id: data.id,
      name,
      contactChannel,
      contactValue,
      country,
      requestTypes,
      message,
      travelPeriod,
      source,
      utmCampaign,
    });
  } catch (notifyErr) {
    // Belt-and-suspenders — notifyNewConsultation() already swallows its
    // own per-channel errors, but never let ANY notification issue
    // affect the customer-facing response.
    console.error('consultation notification dispatch failed:', notifyErr);
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
