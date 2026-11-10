import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simpleRateLimit } from '@/lib/rate-limit';
import { notifyNewPartnerApplication } from '@/lib/notify/partner-application-notify';

const BUSINESS_TYPES = ['clinic_hospital', 'hotel_resort', 'transport_agent', 'investor'] as const;
const LANGUAGES = ['th', 'en', 'lo'] as const;

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}
function allowed(value: unknown, list: readonly string[]): boolean {
  return typeof value === 'string' && list.includes(value);
}

function optionalInteger(value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const limit = await simpleRateLimit(`partner-apply:ip:${ip}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) return NextResponse.json({ error: 'ส่งใบสมัครบ่อยเกินไป กรุณาลองใหม่ภายหลัง' }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const companyName = clean(body.companyName, 200);
  const businessType = clean(body.businessType, 50);
  const primaryName = clean(body.primaryName, 150);
  const primaryEmail = clean(body.primaryEmail, 200) || null;
  const primaryPhone = clean(body.primaryPhone, 80);
  const language = clean(body.language, 2) || 'th';
  const yearEstablished = optionalInteger(body.yearEstablished, 1800, new Date().getFullYear());
  const employeeCount = optionalInteger(body.employeeCount, 1, 1000000);
  const capacity = optionalInteger(body.capacity, 1, 100000000);
  const serviceTypes = Array.isArray(body.serviceTypes)
    ? body.serviceTypes
        .filter((v): v is string => typeof v === 'string')
        .map((v) => clean(v, 100))
        .filter(Boolean)
        .slice(0, 30)
    : [];
  const languages = Array.isArray(body.languages)
    ? body.languages
        .filter((v): v is string => typeof v === 'string')
        .map((v) => clean(v, 30))
        .filter(Boolean)
        .slice(0, 20)
    : [];  const required = [['companyName', companyName], ['businessType', businessType], ['primaryName', primaryName], ['primaryPhone', primaryPhone]] as const;
  const missing = required.find(([, value]) => !value);
  if (missing) return NextResponse.json({ error: 'กรุณากรอกข้อมูลให้ครบ', field: missing[0] }, { status: 400 });
  if (!allowed(businessType, BUSINESS_TYPES)) return NextResponse.json({ error: 'ประเภทธุรกิจไม่ถูกต้อง', field: 'businessType' }, { status: 400 });
  if (!allowed(language, LANGUAGES)) return NextResponse.json({ error: 'ภาษาไม่ถูกต้อง', field: 'language' }, { status: 400 });
  if (body.acceptTerms !== true) return NextResponse.json({ error: 'กรุณายอมรับเงื่อนไขการเป็นพาร์ทเนอร์', field: 'acceptTerms' }, { status: 400 });
  if (body.acceptPrivacy !== true) return NextResponse.json({ error: 'กรุณายอมรับนโยบายความเป็นส่วนตัว', field: 'acceptPrivacy' }, { status: 400 });
  if (body.acceptSLA !== true) return NextResponse.json({ error: 'กรุณายอมรับข้อตกลงการให้บริการ', field: 'acceptSLA' }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase.from('partner_applications').insert({
    language,
    company_name: companyName,
    registration_number: clean(body.registrationNumber, 100) || null,
    tax_id: clean(body.taxId, 100) || null,
    business_type: businessType,
    year_established: yearEstablished,
    employee_count: employeeCount,
    primary_name: primaryName,
    primary_title: clean(body.primaryTitle, 100) || null,
    primary_email: primaryEmail,
    primary_phone: primaryPhone,
    primary_line_id: clean(body.primaryLineId, 150) || null,
    address: clean(body.address, 500) || null,
    district: clean(body.district, 150) || null,
    province: clean(body.province, 150) || null,    postal_code: clean(body.postalCode, 30) || null,
    service_types: serviceTypes,
    languages,
    operating_hours: clean(body.operatingHours, 200) || null,
    capacity,
    accept_terms: body.acceptTerms === true,
    accept_privacy: body.acceptPrivacy === true,
    accept_sla: body.acceptSLA === true,
    message: clean(body.message, 2000) || null,
    status: 'PENDING',
    ip_address: ip,
    user_agent: clean(request.headers.get('user-agent'), 300) || null,
  }).select('id').single();

  if (error || !data) {
    console.error('partner application insert failed', error);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }  await notifyNewPartnerApplication({
    id: data.id,
    appUrl: new URL(request.url).origin,
    language,
    companyName,
    businessType,
    primaryName,
    primaryEmail,
    primaryPhone,
    message: clean(body.message, 2000) || null,
  });

  return NextResponse.json({ id: data.id }, { status: 201 });
}
