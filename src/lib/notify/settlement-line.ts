// src/lib/notify/settlement-line.ts
//
// Pushes a settlement status change to a partner's LINE when it
// transitions into APPROVED, PAID, or LOCKED — the three points
// where the partner either needs to act (APPROVED: a commission
// amount is now confirmed and owed) or should know something
// happened to money (PAID, LOCKED). CALCULATED is deliberately never
// notified — it's an internal WOS bookkeeping step (Phase 6 scoping
// discussion), not something the partner needs to see mid-flow.
//
// Same admin-set-only link as hotel-line.ts / driver-line.ts —
// partners.line_user_id (migration 086, write-protected by 087). No
// fallback if unset: skip silently, same as hotel-line.ts. Settlement
// visibility itself never depends on this — the partner can still see
// every settlement and its status in the Partner Portal
// (/api/partner/settlements) regardless of whether LINE is linked;
// this is a courtesy push on top of that, not the only way to find out.
//
// Same fire-and-forget philosophy as hotel-line.ts / driver-line.ts:
// can only ever resolve, never throw. Call sites (the approve/pay/lock
// admin routes) must NOT await this before responding — a LINE outage
// must never fail or delay the settlement transition itself.
//
// CONFIG — reuses the same Messaging API channel as the other
// notify/*-line.ts modules:
//   LINE_CHANNEL_ACCESS_TOKEN

const LINE_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function formatTHB(amount: number): string {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(amount);
}

function formatThaiDate(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

export type NotifiableSettlementStatus = 'APPROVED' | 'PAID' | 'LOCKED';

export interface SettlementStatusPayload {
  partnerLineUserId: string;
  status: NotifiableSettlementStatus;
  totalCommissionDue: number;
  itemCount: number;
  periodStart: string;
  periodEnd: string;
}

function buildMessageText(payload: SettlementStatusPayload): string {
  const period = `${formatThaiDate(payload.periodStart)} – ${formatThaiDate(payload.periodEnd)}`;

  const lines =
    payload.status === 'APPROVED'
      ? [
          '📋 ยอด Settlement งวดนี้ยืนยันแล้ว',
          `📅 งวด: ${period}`,
          `🧾 ${payload.itemCount} รายการ`,
          `💰 ยอดที่ต้องชำระ: ${formatTHB(payload.totalCommissionDue)}`,
        ]
      : payload.status === 'PAID'
        ? [
            '✅ Settlement งวดนี้ชำระเงินแล้ว',
            `📅 งวด: ${period}`,
            `💰 ยอด: ${formatTHB(payload.totalCommissionDue)}`,
          ]
        : [
            '🔒 Settlement งวดนี้ปิดงวดแล้ว',
            `📅 งวด: ${period}`,
            `💰 ยอด: ${formatTHB(payload.totalCommissionDue)}`,
          ];

  return lines.join('\n');
}

async function pushToPartner(payload: SettlementStatusPayload): Promise<void> {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelAccessToken) return; // channel not configured — silent no-op, same as the other notify/*-line.ts modules

  const res = await fetchWithTimeout(
    'https://api.line.me/v2/bot/message/push',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        to: payload.partnerLineUserId,
        messages: [{ type: 'text', text: buildMessageText(payload) }],
      }),
    },
    LINE_TIMEOUT_MS
  );

  if (!res.ok) {
    // Don't log the raw response body — LINE echoes the `to` userId
    // back in error payloads. Status is enough to debug from.
    throw new Error(`LINE push to partner (settlement) responded ${res.status}`);
  }
}

export async function notifyPartnerSettlementStatus(payload: SettlementStatusPayload): Promise<void> {
  try {
    await pushToPartner(payload);
  } catch (err) {
    console.error('partner (settlement) LINE notify failed:', err);
  }
}
