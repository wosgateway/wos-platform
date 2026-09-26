import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runWosAI, type WosAIHistoryMessage } from '@/lib/ai/core';
import { claimWebhookEvent, recordWebhookEventResult, releaseWebhookEvent } from '@/lib/chatwoot/duplicate';

// =====================================================================
// Chatwoot webhook adapter.
//
// This file is intentionally "dumb": it verifies the request, filters
// which events matter, dedupes, fetches conversation history, calls AI
// Core V1 (runWosAI) as the single source of truth for the answer, and
// relays it back to Chatwoot. It must NOT own a second system prompt,
// a second model call, or a second set of business rules — see the
// architecture discussion this replaces (previous version called
// LiteLLM/Typhoon directly with its own buildSystemPrompt()).
//
// History is fetched here (Chatwoot is the only place that has it) but
// handed to AI Core as raw {role, content} turns — this file does not
// build a prompt around it. AI Core owns context assembly.
// =====================================================================

const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL!;
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID!;
const CHATWOOT_API_ACCESS_TOKEN = process.env.CHATWOOT_API_ACCESS_TOKEN!;
const WEBHOOK_SECRET = process.env.CHATWOOT_WEBHOOK_SECRET!; // ต้องตั้งค่านี้และแนบใน outgoing_url เป็น ?secret=...
const DEBUG_LOG = process.env.DEBUG_LOG === 'true'; // ตั้ง DEBUG_LOG=true ใน .env.local เฉพาะตอนอยาก debug เท่านั้น ปิดไว้บน production

function debugLog(...args: unknown[]) {
  if (DEBUG_LOG) console.log(...args);
}

// --- Fetch timeout guard ---
// ถ้า Chatwoot ไม่ตอบเลย fetch เดิมจะแขวนไม่มีกำหนด ทำให้ Chatwoot อาจ
// timeout ฝั่งเขาแล้ว retry ส่ง webhook ซ้ำ -> ยิ่งเน้นว่าทำไม dedup ต้อง
// เป็น Supabase ไม่ใช่ in-memory (ดู src/lib/chatwoot/duplicate.ts)
const FETCH_TIMEOUT_MS = 25_000;

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// runWosAI() throws the raw OpenAI SDK error on failure (see
// src/lib/ai/core.ts's catch block) — it does not wrap it. Same
// status-sniffing approach as src/app/api/ai/chat/route.ts.
function isRateLimitedError(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 429;
}

export async function POST(req: NextRequest) {
  const supabase = createServiceClient();
  let claimedEventId: string | null = null;

  try {
    // --- 1. Verify shared secret ---
    // Chatwoot AgentBot ไม่แนบ signature มาให้ ต้องตั้ง secret เองใน outgoing_url
    // เช่น http://192.168.99.7:3001/api/chatwoot/webhook?secret=xxxxx
    const secret = req.nextUrl.searchParams.get('secret');
    if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
      console.warn('[chatwoot-webhook] rejected: invalid or missing secret');
      return NextResponse.json({ status: 'unauthorized' }, { status: 401 });
    }

    const payload = await req.json();

    debugLog(
      `[debug] event=${payload.event} message_type=${payload.message_type} private=${payload.private} status=${payload.conversation?.status} assignee=${payload.conversation?.meta?.assignee?.id} assignee_type=${payload.conversation?.meta?.assignee?.type}`
    );

    // --- 2. สนใจแค่ event message_created ---
    if (payload.event !== 'message_created') {
      debugLog('[debug] -> ignored_event');
      return NextResponse.json({ status: 'ignored_event' });
    }

    // --- 3. สนใจแค่ข้อความที่ลูกค้าส่งเข้ามา ---
    // message_type จาก Chatwoot อาจเป็น string ('incoming') หรือ number (0) ขึ้นกับ payload/version
    const isIncoming = payload.message_type === 'incoming' || payload.message_type === 0;
    if (!isIncoming) {
      debugLog('[debug] -> ignored_not_incoming');
      return NextResponse.json({ status: 'ignored_not_incoming' });
    }

    // --- 4. ข้าม private note (agent คุยกันเองใน conversation ไม่ใช่ข้อความถึงลูกค้า) ---
    if (payload.private === true) {
      debugLog('[debug] -> ignored_private_note');
      return NextResponse.json({ status: 'ignored_private_note' });
    }

    // --- 5. ถ้า conversation ถูก assign ให้ human agent แล้ว ให้หยุดตอบอัตโนมัติ ---
    // ผูก inbox นี้ไว้กับ Agent Bot ("WOS AI") เป็น assignee เริ่มต้นของทุก
    // conversation — payload.conversation.meta.assignee.type จะเป็น
    // "agent_bot" ในกรณีนี้ ต้องเช็ค type ด้วย ไม่งั้น AI จะหยุดตอบทุก
    // ข้อความหลังจากตอบไปครั้งแรก
    const conversationStatus = payload.conversation?.status;
    const assignee = payload.conversation?.meta?.assignee;
    const assigneeId = assignee?.id;
    const isHumanAssignee = assigneeId && assignee?.type !== 'agent_bot';
    if (isHumanAssignee && conversationStatus !== 'pending') {
      debugLog('[debug] -> ignored_assigned_to_human');
      return NextResponse.json({ status: 'ignored_assigned_to_human' });
    }

    const conversationId = payload.conversation?.id;
    const content = payload.content;
    const messageId = payload.id;

    if (!conversationId || !content) {
      debugLog('[debug] -> ignored_missing_data');
      return NextResponse.json({ status: 'ignored_missing_data' });
    }

    // --- 6. กัน webhook retry ตอบซ้ำ (idempotency, Supabase-backed, fail-closed) ---
    // ไม่มี message id = ไม่มีทาง dedup ได้เลย ระบบนี้ต้องมี idempotency key
    // ก่อนยิง AI เสมอ — ปฏิเสธแทนการยอมเสี่ยงประมวลผล
    if (!messageId) {
      console.warn('[chatwoot-webhook] message has no id, refusing to process (no idempotency key)');
      return NextResponse.json({ status: 'ignored_missing_message_id' });
    }

    const claim = await claimWebhookEvent(supabase, messageId, conversationId);
    if (!claim.shouldProcess) {
      if (claim.reason === 'duplicate') {
        debugLog('[debug] -> ignored_duplicate_message', messageId);
        return NextResponse.json({ status: 'ignored_duplicate' });
      }
      // idempotency store unavailable — fail CLOSED: do not call the AI.
      // Return 5xx so Chatwoot's own delivery retry picks this up once
      // Supabase is back, instead of risking 2-3x OpenAI calls for the
      // same message while the store is down.
      console.error('[chatwoot-webhook] idempotency store unavailable, refusing to call AI');
      return NextResponse.json({ status: 'idempotency_unavailable' }, { status: 503 });
    }
    claimedEventId = claim.eventId;

    debugLog('[debug] -> proceeding to AI Core');

    const history = await fetchConversationHistory(conversationId, messageId);
    debugLog(`[debug] history messages included: ${history.length}`);

    const t0 = Date.now();
    const aiResult = await getAIReply(content, history);
    const t1 = Date.now();
    debugLog(`[timing] runWosAI took ${t1 - t0}ms, ok=${aiResult.ok}`);

    // ลูกค้าได้รับข้อความเสมอ (คำตอบจริง หรือ fallback ถ้า AI ล้มเหลว) แต่
    // ledger ต้องสะท้อนสถานะ AI จริง ไม่ใช่แค่ "ส่งถึง Chatwoot สำเร็จ" —
    // ไม่งั้น openai_429 จะไม่ถูกบันทึกเลยทั้งที่โควตาหมดจริง
    await sendChatwootReply(conversationId, aiResult.text);
    await recordWebhookEventResult(
      supabase,
      claimedEventId,
      aiResult.ok ? 'sent' : 'failed',
      aiResult.ok ? null : aiResult.reason
    );

    // --- 7. ถ้าลูกค้าพิมพ์เลขออเดอร์มาในข้อความ ผูกบริบทเข้ากับ conversation ---
    // จงใจไม่ await บล็อกการตอบลูกค้า — ความล้มเหลวของฟีเจอร์นี้ไม่ควรทำให้
    // POST() ทั้งก้อน error ทั้งที่ตอบลูกค้าสำเร็จไปแล้ว
    const orderNumber = extractOrderNumber(content);
    if (orderNumber) {
      debugLog('[debug] order number detected in message:', orderNumber);
      fetchOrderContext(orderNumber).then((ctx) => {
        if (ctx) {
          void updateChatwootCustomAttributes(conversationId, ctx);
        }
      });
    }

    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    // ถึงจุดนี้แปลว่า sendChatwootReply เอง throw (ตอบลูกค้าไม่สำเร็จ — ลูกค้า
    // ไม่เห็นคำตอบเลย) หรือ error ที่ไม่คาดคิดอื่น ๆ — ไม่ใช่ AI 429/error
    // ซึ่งถูกจับแยกใน getAIReply() แล้วไม่ throw ต่อ (ลูกค้าเคสนั้นได้ fallback
    // message ไปแล้ว)
    console.error('[chatwoot-webhook] error', err instanceof Error ? err.message : String(err));
    if (claimedEventId) {
      // ปล่อย claim (ลบแถวทิ้ง) แทนการบันทึก 'failed' — ถ้าปล่อยให้แถวค้างเป็น
      // 'failed' การ retry ของ Chatwoot เองจะชน unique constraint (23505)
      // กลายเป็น "duplicate" แล้วถูกข้าม ทำให้ลูกค้าไม่มีทางได้รับคำตอบเลย
      // แม้ Chatwoot จะ retry จริงก็ตาม — ดู releaseWebhookEvent() ใน
      // lib/chatwoot/duplicate.ts สำหรับเหตุผลเต็ม
      await releaseWebhookEvent(supabase, claimedEventId);
    }
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}

// จำนวนข้อความย้อนหลัง (ไม่รวมข้อความปัจจุบัน) ที่ดึงมาใส่ context — 10
// (~5 รอบสนทนา) เท่ากับที่เวอร์ชัน LiteLLM เดิมใช้
const HISTORY_MESSAGE_LIMIT = 10;

// ดึงข้อความย้อนหลังของ conversation นี้จาก Chatwoot มาส่งให้ AI Core
// คืนค่า [] ถ้าดึงไม่ได้ (ไม่ throw — ไม่อยากให้ history หายไปกระทบการตอบ
// หลัก ซึ่งยังตอบได้แบบ single-turn ถ้าดึง history ไม่สำเร็จ)
async function fetchConversationHistory(
  conversationId: number,
  currentMessageId: number
): Promise<WosAIHistoryMessage[]> {
  try {
    const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;
    const res = await fetchWithTimeout(
      url,
      { headers: { api_access_token: CHATWOOT_API_ACCESS_TOKEN } },
      FETCH_TIMEOUT_MS
    );

    if (!res.ok) {
      console.error('[chatwoot] fetch history failed', { status: res.status });
      return [];
    }

    const data = await res.json();
    // Chatwoot คืน { payload: [...] } เรียงจากเก่า -> ใหม่ ตาม docs — sort ซ้ำ
    // ด้วย created_at กันไว้เผื่อ order ไม่ตรงตามคาด
    const rawMessages = (data.payload ?? []) as Array<{
      id: number;
      message_type: string | number;
      content: string | null;
      private: boolean;
      created_at: number;
    }>;

    // Whitelist เฉพาะ incoming (ลูกค้า) และ outgoing (ที่เคยตอบไปแล้ว —
    // จาก AI หรือ human agent) เท่านั้น Chatwoot ยังมี message_type อื่น
    // (เช่น activity/template/event) ที่ไม่ใช่บทสนทนาจริง — เดิมโค้ด map
    // "ไม่ใช่ incoming" ทั้งหมดเป็น 'assistant' ซึ่งจะยัด event/system
    // message เข้าไปให้โมเดลเข้าใจผิดว่าเป็นสิ่งที่ AI/agent เคยพูดไว้
    const isIncoming = (t: string | number) => t === 'incoming' || t === 0;
    const isOutgoing = (t: string | number) => t === 'outgoing' || t === 1;

    return rawMessages
      .filter(
        (m) =>
          m.id !== currentMessageId &&
          !m.private &&
          m.content &&
          (isIncoming(m.message_type) || isOutgoing(m.message_type))
      )
      .sort((a, b) => a.created_at - b.created_at)
      .slice(-HISTORY_MESSAGE_LIMIT)
      .map((m) => ({
        role: (isIncoming(m.message_type) ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content as string,
      }));
  } catch (err) {
    console.error(
      '[chatwoot] fetch history error',
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

type AIReplyResult =
  | { ok: true; text: string }
  | { ok: false; text: string; reason: 'openai_429' | 'openai_error' };

// --- 8. เรียก AI Core V1 (single source of truth) ---
// ลูกค้าต้องได้รับข้อความเสมอ (คำตอบจริงหรือ fallback) แต่ผลลัพธ์ที่คืนไป
// ต้องบอกความจริงว่า AI สำเร็จหรือไม่ ให้ POST() บันทึก ledger ให้ตรง —
// ไม่งั้น 429 จะถูกบันทึกเป็น 'sent' ทั้งที่โควตา OpenAI หมดจริง
async function getAIReply(
  userMessage: string,
  history: WosAIHistoryMessage[]
): Promise<AIReplyResult> {
  try {
    const text = await runWosAI(userMessage, history);
    return { ok: true, text };
  } catch (err) {
    if (isRateLimitedError(err)) {
      console.warn('[chatwoot-webhook] upstream 429 from AI Core');
      return {
        ok: false,
        reason: 'openai_429',
        text: 'ผู้ช่วยกำลังมีผู้ใช้งานจำนวนมาก กรุณาลองอีกครั้งในอีกสักครู่ค่ะ',
      };
    }
    console.error('[chatwoot-webhook] runWosAI error', err instanceof Error ? err.message : String(err));
    return {
      ok: false,
      reason: 'openai_error',
      text: 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว ทีมงานจะติดต่อกลับโดยเร็วนะคะ',
    };
  }
}

async function sendChatwootReply(conversationId: number, content: string) {
  const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_access_token: CHATWOOT_API_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        content,
        message_type: 'outgoing',
        private: false,
      }),
    },
    FETCH_TIMEOUT_MS
  );

  if (!res.ok) {
    // ไม่ log response body เต็ม ๆ เพราะอาจมีข้อมูลลูกค้าปนอยู่
    console.error('[chatwoot] failed to send reply', { status: res.status });
    // throw ต่อให้ POST() catch แล้วตอบ { status: 'error' }, 500 แทน สะท้อนผลจริง
    // (AI ตอบสำเร็จแต่ Chatwoot รับข้อความไม่สำเร็จ ควรนับเป็นความล้มเหลว ไม่ใช่ 'ok')
    throw new Error(`chatwoot_send_failed:${res.status}`);
  }
}

// =====================================================================
// Order context lookup -> Chatwoot Conversation Custom Attributes
//
// ไม่เกี่ยวกับ AI provider เลย เก็บไว้เหมือนเดิมจากเวอร์ชันก่อนหน้า
// =====================================================================
// รูปแบบ order_number จริงจาก generate_order_number() ใน Supabase:
// 'WOS-' || YYYYMMDD || '-' || เลข 5 หลัก (เช่น WOS-20260903-00123)
const ORDER_NUMBER_REGEX = /WOS-\d{8}-\d{5}/i;

function extractOrderNumber(text: string): string | null {
  const match = text.match(ORDER_NUMBER_REGEX);
  return match ? match[0].toUpperCase() : null;
}

type OrderContext = {
  orderNumber: string;
  status: string; // draft | pending_deposit | deposit_paid | confirmed | checked_in | completed | cancelled | refunded
  provinces: string[]; // จาก organizations.province ของทุก order_item ในออเดอร์นี้ (อาจมีหลายจังหวัดถ้าเป็น multi-partner order)
  serviceTypes: string[]; // จาก order_items.service_type: clinic | hotel | transport | wellness | insurance
};

async function fetchOrderContext(orderNumber: string): Promise<OrderContext | null> {
  try {
    const supabase = createServiceClient();

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_number, status')
      .eq('order_number', orderNumber)
      .maybeSingle();

    if (orderErr) {
      console.error('[chatwoot-webhook] fetch order failed', { status: orderErr.code });
      return null;
    }
    if (!order) {
      debugLog('[debug] order not found for', orderNumber);
      return null;
    }

    const { data: items, error: itemsErr } = await supabase
      .from('order_items')
      .select('service_type, organization_id')
      .eq('order_id', order.id);

    if (itemsErr) {
      console.error('[chatwoot-webhook] fetch order_items failed', { status: itemsErr.code });
      return { orderNumber: order.order_number, status: order.status, provinces: [], serviceTypes: [] };
    }

    type OrderItemRow = { service_type: string | null; organization_id: string | null };
    const typedItems = (items ?? []) as OrderItemRow[];
    const serviceTypes = [...new Set(typedItems.map((i) => i.service_type).filter((s): s is string => Boolean(s)))];
    const orgIds = [...new Set(typedItems.map((i) => i.organization_id).filter((id): id is string => Boolean(id)))];

    let provinces: string[] = [];
    if (orgIds.length > 0) {
      const { data: orgs, error: orgsErr } = await supabase
        .from('organizations')
        .select('id, province')
        .in('id', orgIds);

      if (orgsErr) {
        console.error('[chatwoot-webhook] fetch organizations failed', { status: orgsErr.code });
      } else {
        type OrgRow = { id: string; province: string | null };
        const typedOrgs = (orgs ?? []) as OrgRow[];
        provinces = [...new Set(typedOrgs.map((o) => o.province).filter((p): p is string => Boolean(p)))];
      }
    }

    return { orderNumber: order.order_number, status: order.status, provinces, serviceTypes };
  } catch (err) {
    console.error('[chatwoot-webhook] fetchOrderContext error', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function updateChatwootCustomAttributes(conversationId: number, ctx: OrderContext) {
  const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/custom_attributes`;

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST', // endpoint นี้ของ Chatwoot ใช้ POST (ทำหน้าที่เป็น upsert ไม่ใช่ PATCH)
        headers: {
          'Content-Type': 'application/json',
          api_access_token: CHATWOOT_API_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          custom_attributes: {
            order_id: ctx.orderNumber,
            province: ctx.provinces.join(', ') || null,
            package_type: ctx.serviceTypes.join(', ') || null,
            booking_status: ctx.status,
          },
        }),
      },
      FETCH_TIMEOUT_MS
    );

    if (!res.ok) {
      console.error('[chatwoot-webhook] failed to update custom_attributes', { status: res.status });
      return;
    }
    debugLog('[debug] custom_attributes updated for conversation', conversationId, ctx);
  } catch (err) {
    console.error(
      '[chatwoot-webhook] updateChatwootCustomAttributes error',
      err instanceof Error ? err.message : String(err)
    );
  }
}
