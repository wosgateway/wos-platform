// src/app/api/line/webhook/route.ts
//
// Inbound webhook for the WOS LINE Official Account (the same OA that
// pushes messages out via order-notify.ts / driver-line.ts). Right now
// this handles exactly ONE inbound flow — "auto phone-match" for
// drivers — and nothing else. It intentionally does NOT do anything
// AI/conversational (see chatwoot/webhook/route.ts for that surface,
// which is the customer-facing channel); this is plumbing, not chat.
//
// FLOW:
//   1. Driver adds the WOS OA as a friend (or opens the chat and types
//      anything) while unlinked -> bot replies asking them to send the
//      phone number they registered with WOS.
//   2. Driver sends a text message -> normalizePhone() it the same way
//      the rest of the app does (see lib/phone.ts), then look for
//      EXACTLY ONE driver row whose normalized phone matches.
//        - 0 matches            -> "not found", ask them to check the
//                                   number or contact staff. Doesn't
//                                   reveal which numbers ARE valid.
//        - 1 match, unlinked    -> set drivers.line_user_id, confirm.
//        - 1 match, already
//          linked to THIS user  -> confirm already linked (idempotent —
//                                   driver can resend if unsure).
//        - 1 match, linked to
//          a DIFFERENT user     -> refuse to relink automatically,
//                                   tell them to contact admin. Admin
//                                   can fix/clear it manually (see the
//                                   line_user_id field added to
//                                   DriversManager.tsx).
//        - 2+ matches (phone
//          not unique in the
//          table — no DB
//          constraint enforces
//          it)                  -> ambiguous, refuse, tell them to
//                                   contact admin rather than guess.
//
// Registered drivers only. This has no way to link a hotel/partner —
// partners.line_user_id (see migration 086) has no phone column to
// match against, so it stays admin-set-only for now.
//
// CONFIG:
//   LINE_CHANNEL_SECRET          used to verify x-line-signature
//   LINE_CHANNEL_ACCESS_TOKEN    same var as order-notify.ts / driver-line.ts,
//                                 used here for the reply API
// If either is unset, requests are rejected (401) rather than silently
// no-op'd — unlike the outbound notify modules, an unverifiable inbound
// webhook should not be processed at all.

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { normalizePhone } from '@/lib/phone';

const FETCH_TIMEOUT_MS = 15_000;

// Minimal shape of a LINE webhook event — only the fields this handler
// actually reads. LINE's payloads carry many more event types/fields
// than this; anything unused is intentionally left untyped rather than
// modeling their whole schema.
interface LineWebhookEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function verifySignature(rawBody: string, signatureHeader: string | null, channelSecret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  // Lengths differ (base64 of a fixed-length HMAC is fixed-length, but
  // guard anyway) — timingSafeEqual throws on mismatched buffer length
  // rather than returning false.
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function replyMessage(replyToken: string, text: string, accessToken: string): Promise<void> {
  try {
    const res = await fetchWithTimeout(
      'https://api.line.me/v2/bot/message/reply',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
      },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
      console.error('[line-webhook] reply failed', { status: res.status });
    }
  } catch (err) {
    // Best-effort — a failed reply must not fail the webhook (LINE
    // retries the whole delivery on a non-2xx response, which would
    // re-run the phone-match logic, not just the reply).
    console.error('[line-webhook] reply error', err instanceof Error ? err.message : String(err));
  }
}

const ASK_FOR_PHONE_TEXT =
  'สวัสดีค่ะ 👋 นี่คือ LINE คนขับของ WOS\nกรุณาพิมพ์เบอร์โทรที่ลงทะเบียนไว้กับ WOS เพื่อผูกบัญชีนี้สำหรับรับแจ้งงานค่ะ';

async function handleTextMessage(text: string, sourceUserId: string | undefined, replyToken: string, accessToken: string) {
  if (!sourceUserId) {
    // Group/room messages have no reliable per-user identity to link —
    // this flow only makes sense in a 1:1 chat with the OA.
    return;
  }

  const normalized = normalizePhone(text);
  if (!normalized) {
    await replyMessage(replyToken, ASK_FOR_PHONE_TEXT, accessToken);
    return;
  }

  const supabase = createServiceClient();

  // No normalized-phone index exists (drivers.phone is free-text), so
  // pull candidates and compare normalized forms in JS. Fine at fleet
  // scale; revisit with a generated column + index if the drivers
  // table ever grows large.
  const { data: candidates, error } = await supabase
    .from('drivers')
    .select('id, name, phone, line_user_id')
    .not('phone', 'is', null);

  if (error) {
    console.error('[line-webhook] driver lookup failed', { status: error.code });
    await replyMessage(
      replyToken,
      'ขออภัยค่ะ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง หรือติดต่อแอดมิน',
      accessToken
    );
    return;
  }

  const matches = (candidates ?? []).filter((d) => normalizePhone(d.phone ?? '') === normalized);

  if (matches.length === 0) {
    await replyMessage(
      replyToken,
      'ไม่พบเบอร์นี้ในระบบค่ะ กรุณาตรวจสอบเบอร์ที่ลงทะเบียนไว้กับ WOS อีกครั้ง หรือติดต่อแอดมิน',
      accessToken
    );
    return;
  }

  if (matches.length > 1) {
    // Ambiguous — refuse rather than guess which driver row to link.
    console.warn('[line-webhook] phone matched multiple drivers, skipping auto-link', { count: matches.length });
    await replyMessage(
      replyToken,
      'พบเบอร์นี้ซ้ำกันมากกว่าหนึ่งรายการในระบบค่ะ กรุณาติดต่อแอดมินเพื่อผูกบัญชีให้',
      accessToken
    );
    return;
  }

  const driver = matches[0];

  if (driver.line_user_id === sourceUserId) {
    await replyMessage(replyToken, `ผูกบัญชี LINE ไว้กับคุณ${driver.name ? ` ${driver.name}` : ''}เรียบร้อยแล้วค่ะ ✅`, accessToken);
    return;
  }

  if (driver.line_user_id) {
    // Already linked to a DIFFERENT LINE account — don't silently
    // relink (see admin-editable field on DriversManager.tsx for the
    // manual fix/clear path).
    await replyMessage(
      replyToken,
      'เบอร์นี้ผูกกับบัญชี LINE อื่นอยู่แล้วค่ะ หากต้องการเปลี่ยน กรุณาติดต่อแอดมิน',
      accessToken
    );
    return;
  }

  const { error: updateError } = await supabase
    .from('drivers')
    .update({ line_user_id: sourceUserId })
    .eq('id', driver.id)
    .is('line_user_id', null); // extra guard against a race with another request linking it in between

  if (updateError) {
    console.error('[line-webhook] link update failed', { status: updateError.code });
    await replyMessage(replyToken, 'ขออภัยค่ะ ผูกบัญชีไม่สำเร็จ กรุณาลองใหม่หรือติดต่อแอดมิน', accessToken);
    return;
  }

  await replyMessage(
    replyToken,
    `ผูกบัญชี LINE นี้กับคุณ${driver.name ? ` ${driver.name}` : ''}เรียบร้อยแล้วค่ะ ✅\nต่อไปเมื่อมีงานใหม่หรือมีการแก้ไขงาน จะแจ้งเตือนทาง LINE นี้ค่ะ`,
    accessToken
  );
}

export async function POST(req: NextRequest) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelSecret || !accessToken) {
    console.error('[line-webhook] LINE_CHANNEL_SECRET or LINE_CHANNEL_ACCESS_TOKEN not configured');
    return NextResponse.json({ status: 'not_configured' }, { status: 401 });
  }

  // Must verify against the RAW body bytes, before any JSON parsing —
  // re-serializing a parsed object can change whitespace/key order and
  // break the signature check.
  const rawBody = await req.text();
  const signature = req.headers.get('x-line-signature');
  if (!verifySignature(rawBody, signature, channelSecret)) {
    console.warn('[line-webhook] rejected: invalid signature');
    return NextResponse.json({ status: 'unauthorized' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const events: LineWebhookEvent[] = payload.events ?? [];

  for (const event of events) {
    try {
      const replyToken = event.replyToken;
      if (!replyToken) continue; // no reply target (e.g. unsend events) — nothing to do here

      if (event.type === 'follow') {
        await replyMessage(replyToken, ASK_FOR_PHONE_TEXT, accessToken);
        continue;
      }

      if (event.type === 'message' && event.message?.type === 'text') {
        await handleTextMessage(event.message.text as string, event.source?.userId, replyToken, accessToken);
        continue;
      }
      // Other event types (unfollow, postback, non-text messages, etc.)
      // are intentionally ignored — nothing to do for the phone-match
      // flow.
    } catch (err) {
      // One bad event must not abort processing the rest of the batch
      // (LINE can send multiple events per webhook delivery).
      console.error('[line-webhook] event handling error', err instanceof Error ? err.message : String(err));
    }
  }

  // Always 200 once signature is verified — LINE retries the whole
  // delivery on non-2xx, which would re-run reply sends for events
  // already handled.
  return NextResponse.json({ status: 'ok' });
}
