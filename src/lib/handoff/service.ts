// src/lib/handoff/service.ts
//
// Fern (AI) -> WOS team handoff, as a real transaction.
//
//   confirmed journey + contact
//     -> submit_ai_handoff() RPC   (1 DB transaction: request + outbox row,
//                                   duplicate-safe via unique idempotency_key)
//     -> processOutbox()           (claim -> Telegram -> mark sent/failed)
//
// Contract for callers (core.ts / chat route):
//
//   const r = await submitHandoff(...);
//   if (r.ok)  -> the request is SAVED in the DB. It is now truthful to tell
//                 the customer "sent to the team", regardless of
//                 r.notification ('sent' | 'queued'). 'queued' means Telegram
//                 failed/was unavailable and the outbox will retry — the
//                 lead itself is not lost and not duplicated.
//   if (!r.ok) -> NOTHING was saved. The caller MUST NOT claim the request
//                 was sent. Show r.customerMessage-style "please try again".
//
// submitHandoff() and processOutbox() never throw.
//
// This file is deliberately independent of core.ts (type-only imports) so
// the Thai prompt/personality code is not touched by handoff changes.

import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import type { WosJourneyState } from '@/lib/ai/journey-state';
import type { WosLanguage } from '@/lib/ai/language-dictionary';

// ---------------------------------------------------------------------------
// Allowlists — keep in sync with 092 / 125 CHECK constraints.
// ---------------------------------------------------------------------------
const CONTACT_CHANNELS = ['phone', 'whatsapp', 'line', 'email', 'other'] as const;
type RequestType =
  | 'health_checkup'
  | 'medical_treatment'
  | 'dental'
  | 'wellness'
  | 'aesthetic'
  | 'hospital_clinic'
  | 'hotel'
  | 'transport'
  | 'not_sure';
const TRAVEL_PERIODS = ['unspecified', 'within_1_month', '1_to_3_months', 'more_than_3_months'] as const;

export type HandoffContactChannel = (typeof CONTACT_CHANNELS)[number];
export type HandoffTravelPeriod = (typeof TRAVEL_PERIODS)[number];

export interface HandoffInput {
  /** Stable id of the chat session. Same session + same contact = same lead. */
  conversationId: string;
  language: WosLanguage;
  name: string;
  contactChannel: HandoffContactChannel;
  contactValue: string;
  country?: string;
  journey: WosJourneyState;
  travelPeriod?: HandoffTravelPeriod;
  /** Origin used for the admin link in the Telegram message (optional). */
  appUrl?: string;
}

export type HandoffResult =
  | {
      ok: true;
      requestId: string;
      /** true = this call created the lead; false = duplicate confirm, existing lead returned */
      created: boolean;
      /** 'sent' = Telegram delivered now; 'queued' = will be retried from the outbox */
      notification: 'sent' | 'queued';
    }
  | {
      ok: false;
      reason: 'validation' | 'db_error';
      field?: string;
    };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLength);
}

function isEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function normalizeContact(channel: HandoffContactChannel, value: string): string {
  if (channel === 'phone' || channel === 'whatsapp') return value.replace(/[^\d+]/g, '');
  return value.trim().toLowerCase();
}

/**
 * Deterministic key: the same conversation confirming with the same contact
 * always maps to the same key, so double/triple "confirm" => one lead.
 * (If the customer later changes their requirements in the same chat after a
 * confirmed handoff, they hit the same lead — a deliberate trade-off; a new
 * chat session or a different contact creates a new lead.)
 */
export function buildHandoffKey(
  conversationId: string,
  contactChannel: HandoffContactChannel,
  contactValue: string
): string {
  const digest = createHash('sha256')
    .update(`ai-handoff|${conversationId}|${contactChannel}|${normalizeContact(contactChannel, contactValue)}`)
    .digest('hex');
  return `ai:${digest.slice(0, 48)}`; // 51 chars, within the 16..128 CHECK
}

const NEED_TO_REQUEST_TYPE: Record<WosJourneyState['needs'][number], RequestType> = {
  health: 'health_checkup',
  treatment: 'medical_treatment',
  transport: 'transport',
  hotel: 'hotel',
  trip: 'not_sure',
};

function journeyToRequestTypes(journey: WosJourneyState): RequestType[] {
  const types = new Set<RequestType>();
  for (const need of journey.needs ?? []) {
    const mapped = NEED_TO_REQUEST_TYPE[need];
    if (mapped) types.add(mapped);
  }
  if (types.size === 0) types.add('not_sure');
  return Array.from(types);
}

function journeyToSummaryLines(journey: WosJourneyState): string[] {
  const lines: Array<string | null> = [
    journey.selectedProgram ? `โปรแกรม: ${journey.selectedProgram}` : null,
    journey.selectedProvider ? `ผู้ให้บริการ: ${journey.selectedProvider}` : null,
    journey.origin ? `ต้นทาง: ${journey.origin}` : null,
    journey.destination ? `ปลายทาง: ${journey.destination}` : null,
    journey.serviceDate ? `วันที่: ${journey.serviceDate}` : null,
    journey.checkin ? `เช็คอิน: ${journey.checkin}` : null,
    journey.checkout ? `เช็คเอาท์: ${journey.checkout}` : null,
    journey.tripDurationDays ? `ระยะเวลา: ${journey.tripDurationDays} วัน` : null,
    journey.travelers ? `ผู้เดินทาง: ${journey.travelers} คน` : null,
    journey.budgetUnlimited
      ? 'งบประมาณ: ไม่จำกัด'
      : journey.budgetThb
        ? `งบประมาณ: ${journey.budgetThb.toLocaleString('th-TH')} บาท`
        : null,
  ];
  return lines.filter((l): l is string => l !== null);
}

function buildTelegramText(args: {
  name: string;
  country: string;
  contactChannel: string;
  contactValue: string;
  requestTypes: RequestType[];
  summaryLines: string[];
  language: string;
  appUrl?: string;
}): string {
  return [
    '🆕 ปรึกษา WOS — คำขอใหม่จากใบเฟิร์น (AI)',
    `👤 ${args.name} (${args.country})`,
    `📞 ${args.contactChannel} — ${args.contactValue}`,
    `🩺 สนใจ: ${args.requestTypes.join(', ')}`,
    `🌐 ภาษา: ${args.language}`,
    ...(args.summaryLines.length ? ['📝 สรุป Journey:', ...args.summaryLines.map((l) => `  • ${l}`)] : []),
    args.appUrl ? `👉 ${args.appUrl}/admin?tab=consultations` : null,
  ]
    .filter((l): l is string => l !== null)
    .join('\n')
    .slice(0, 3900); // Telegram hard limit is 4096 chars
}

// ---------------------------------------------------------------------------
// submitHandoff — the only function the AI layer should need to call
// ---------------------------------------------------------------------------
export async function submitHandoff(input: HandoffInput): Promise<HandoffResult> {
  const conversationId = cleanText(input.conversationId, 128);
  const name = cleanText(input.name, 100);
  const contactValue = cleanText(input.contactValue, 100);
  const country = cleanText(input.country, 100) || 'ไม่ระบุ';

  if (!conversationId) return { ok: false, reason: 'validation', field: 'conversationId' };
  if (!name) return { ok: false, reason: 'validation', field: 'name' };
  if (!isEnum<HandoffContactChannel>(input.contactChannel, CONTACT_CHANNELS)) {
    return { ok: false, reason: 'validation', field: 'contactChannel' };
  }
  if (contactValue.length < 3) return { ok: false, reason: 'validation', field: 'contactValue' };

  const language: WosLanguage = isEnum(input.language, ['th', 'en', 'lo'] as const) ? input.language : 'th';
  const travelPeriod: HandoffTravelPeriod = isEnum<HandoffTravelPeriod>(input.travelPeriod, TRAVEL_PERIODS)
    ? input.travelPeriod
    : 'unspecified';

  const requestTypes = journeyToRequestTypes(input.journey);
  const summaryLines = journeyToSummaryLines(input.journey);
  const message = cleanText(['[จากใบเฟิร์น AI]', ...summaryLines].join('\n'), 2000) || null;
  const idempotencyKey = buildHandoffKey(conversationId, input.contactChannel, contactValue);

  const telegramText = buildTelegramText({
    name,
    country,
    contactChannel: input.contactChannel,
    contactValue,
    requestTypes,
    summaryLines,
    language,
    appUrl: input.appUrl,
  });

  let requestId: string;
  let created: boolean;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('submit_ai_handoff', {
      p_idempotency_key: idempotencyKey,
      p_conversation_id: conversationId,
      p_language: language,
      p_name: name,
      p_contact_channel: input.contactChannel,
      p_contact_value: contactValue,
      p_country: country,
      p_request_types: requestTypes,
      p_message: message,
      p_travel_period: travelPeriod,
      p_journey_snapshot: input.journey,
      p_notify_payload: { text: telegramText },
    });

    if (error || !data || typeof (data as { id?: unknown }).id !== 'string') {
      console.error('handoff: submit_ai_handoff failed', error);
      return { ok: false, reason: 'db_error' };
    }
    requestId = (data as { id: string }).id;
    created = (data as { created?: boolean }).created === true;
  } catch (err) {
    console.error('handoff: submit_ai_handoff threw', err);
    return { ok: false, reason: 'db_error' };
  }

  // The lead is durably saved from here on. Notification is best-effort and
  // can NEVER turn this into a failure. Awaited (not fire-and-forget) because
  // un-awaited promises get killed on serverless once the response returns.
  // Also runs on a duplicate confirm: it only picks up rows that are still
  // due/unsent, so it can heal a previously failed notification but cannot
  // double-send (claim uses FOR UPDATE SKIP LOCKED + status='sending').
  let notification: 'sent' | 'queued' = 'queued';
  try {
    const stats = await processOutbox({ requestIds: [requestId], limit: 1 });
    if (stats.sent > 0) notification = 'sent';
    else if (!created && stats.claimed === 0) notification = await outboxSentState(requestId);
  } catch (err) {
    console.error('handoff: outbox dispatch failed (lead is saved, will retry)', err);
  }

  return { ok: true, requestId, created, notification };
}

async function outboxSentState(requestId: string): Promise<'sent' | 'queued'> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('notification_outbox')
      .select('status')
      .eq('consultation_request_id', requestId)
      .eq('channel', 'telegram')
      .maybeSingle();
    return data?.status === 'sent' ? 'sent' : 'queued';
  } catch {
    return 'queued';
  }
}

// ---------------------------------------------------------------------------
// Outbox processing (also callable from a cron / admin "retry" route)
// ---------------------------------------------------------------------------
interface OutboxRow {
  id: string;
  consultation_request_id: string;
  channel: 'telegram' | 'email' | 'line';
  payload: { text?: string };
  attempts: number;
  max_attempts: number;
}

export interface OutboxStats {
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
}

/** 1m, 2m, 4m, 8m, 16m ... capped at 1 hour. `attempts` is already incremented by the claim. */
function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(attempts - 1, 0), 60 * 60_000);
}

/**
 * Handoff alerts go to TELEGRAM_HANDOFF_CHAT_ID when set (dedicated team
 * channel), otherwise fall back to the shared TELEGRAM_CHAT_ID that
 * order/consultation notifications already use. Missing config is reported as
 * a FAILURE (retryable) — never silently marked as sent.
 */
async function sendTelegram(text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_HANDOFF_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    throw new Error('Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing)');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Telegram sendMessage responded ${res.status}: ${body.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function processOutbox(opts: { limit?: number; requestIds?: string[] } = {}): Promise<OutboxStats> {
  const stats: OutboxStats = { claimed: 0, sent: 0, failed: 0, dead: 0 };
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('claim_outbox_batch', {
    p_limit: opts.limit ?? 10,
    p_request_ids: opts.requestIds ?? null,
  });
  if (error) {
    console.error('handoff: claim_outbox_batch failed', error);
    return stats;
  }

  const rows = (data ?? []) as OutboxRow[];
  stats.claimed = rows.length;

  for (const row of rows) {
    try {
      if (row.channel !== 'telegram') {
        throw new Error(`No sender implemented for channel "${row.channel}"`);
      }
      const text = row.payload?.text;
      if (!text) throw new Error('Outbox payload has no text');

      await sendTelegram(text);

      const { error: updErr } = await supabase
        .from('notification_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), locked_at: null, last_error: null })
        .eq('id', row.id);
      if (updErr) console.error('handoff: sent but failed to mark row as sent', row.id, updErr);
      stats.sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const exhausted = row.attempts >= row.max_attempts;
      const { error: updErr } = await supabase
        .from('notification_outbox')
        .update({
          status: exhausted ? 'dead' : 'failed',
          last_error: message.slice(0, 500),
          locked_at: null,
          next_attempt_at: new Date(Date.now() + backoffMs(row.attempts)).toISOString(),
        })
        .eq('id', row.id);
      if (updErr) console.error('handoff: failed to record outbox failure', row.id, updErr);
      console.error(`handoff: ${row.channel} send failed (attempt ${row.attempts}/${row.max_attempts})`, message);
      if (exhausted) stats.dead += 1;
      else stats.failed += 1;
    }
  }

  return stats;
}
