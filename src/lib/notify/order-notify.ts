// src/lib/notify/order-notify.ts
//
// Fires an instant notification to the Admin team when a new order
// (Master Booking) comes in, so someone starts working the Lead
// without waiting to refresh the Admin Control Center.
//
// IMPORTANT — about "LINE Notify" in the original brief: that API
// was shut down by LINE on March 31, 2025 (see
// https://notify-bot.line.me/closing-announce). This sends LINE
// messages via the LINE Messaging API instead (a push message from
// an Official Account) — see sendLineMessage() below.
//
// Three channels, all optional and independent — configure whichever
// ones the team actually wants via env vars. If none are configured,
// notifyNewOrder() is a silent no-op (so local/dev/preview
// environments don't need any of this).
//
//   ORDER_WEBHOOK_URL          generic webhook (e.g. an n8n workflow
//                               trigger) — receives the full JSON
//                               payload, most flexible option and the
//                               one closest to the original "n8n"
//                               request.
//   TELEGRAM_BOT_TOKEN +
//   TELEGRAM_CHAT_ID            Telegram Bot API sendMessage.
//   LINE_CHANNEL_ACCESS_TOKEN +
//   LINE_TO_ID                  LINE Messaging API push message
//                               (LINE_TO_ID = a userId/groupId the
//                               channel is allowed to push to).
//
// Deliberately best-effort: a notification failure must NEVER fail
// or roll back order creation. Every send is wrapped so it can only
// ever resolve, never throw — see call site in app/api/orders/route.ts,
// which does not (and should not) await this before responding.

export interface NotifyOrderItem {
  label: string; // e.g. "ตรวจสุขภาพทั่วไป — โรงพยาบาล A" or "🏨 โรงแรม (ให้ทีมงานจัด)"
  scheduledDate?: string | null;
}

export interface NotifyOrderPayload {
  orderId: string;
  orderNumber: string | null;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  totalDepositRequired: number;
  currency: string;
  items: NotifyOrderItem[];
}

function buildMessageText(payload: NotifyOrderPayload): string {
  const itemLines = payload.items
    .map((i) => `  • ${i.label}${i.scheduledDate ? ` (${i.scheduledDate})` : ''}`)
    .join('\n');

  return [
    `🆕 คำสั่งจองใหม่ ${payload.orderNumber ? `#${payload.orderNumber}` : ''}`.trim(),
    `👤 ${payload.customerName} · ${payload.customerPhone}`,
    `📋 รายการ (${payload.items.length}):`,
    itemLines || '  (ไม่มีรายการ)',
    `💰 ยอดรวม: ${payload.totalAmount.toLocaleString('th-TH')} ${payload.currency}`,
    `💳 มัดจำที่ต้องชำระ: ${payload.totalDepositRequired.toLocaleString('th-TH')} ${payload.currency}`,
  ].join('\n');
}

async function sendGenericWebhook(payload: NotifyOrderPayload): Promise<void> {
  const url = process.env.ORDER_WEBHOOK_URL;
  if (!url) return;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`generic webhook responded ${res.status}`);
  }
}

async function sendTelegram(message: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage responded ${res.status}`);
  }
}

// LINE Messaging API push message — the supported replacement for the
// discontinued LINE Notify. Requires a LINE Official Account with the
// Messaging API enabled; LINE_TO_ID is the userId/groupId/roomId that
// account is allowed to push to (get it once via a webhook event or
// the LINE Developers console).
async function sendLineMessage(message: string): Promise<void> {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_TO_ID;
  if (!channelAccessToken || !to) return;
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: message }] }),
  });
  if (!res.ok) {
    throw new Error(`LINE push message responded ${res.status}`);
  }
}

export async function notifyNewOrder(payload: NotifyOrderPayload): Promise<void> {
  const message = buildMessageText(payload);
  const results = await Promise.allSettled([
    sendGenericWebhook(payload),
    sendTelegram(message),
    sendLineMessage(message),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      // Logged only — never surfaced to the customer, never retried.
      console.error('order notification channel failed:', result.reason);
    }
  }
}
