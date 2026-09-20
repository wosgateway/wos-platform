// src/lib/notify/driver-line.ts
//
// Pushes a driver's OWN job details to their LINE account when a
// transport_assignment is created or edited (see PUT handler in
// app/api/trips/[tripId]/events/[eventId]/transport/route.ts).
//
// SCOPE — deliberately narrow, per the "send only what that party is
// responsible for" requirement: pickup, dropoff, pickup time, and the
// passenger's name. Never the rest of the trip (other days, other
// events, clinic/hotel details), never internal notes, never pricing.
//
// Only works for a REGISTERED driver (drivers.driver_id set) whose
// drivers.line_user_id is populated (migration 085 — either linked by
// admin manually or, later, by an auto phone-match webhook). Ad-hoc
// drivers (driver_name/driver_phone typed directly on the assignment,
// no drivers row) have no LINE identity to push to and are silently
// skipped — they still need to be told out-of-band (call/LINE by
// staff) until there's somewhere to collect their LINE ID too.
//
// Same fire-and-forget philosophy as order-notify.ts /
// customer-whatsapp.ts: every function here can only ever resolve,
// never throw. Call sites must NOT await this before responding —
// a LINE outage or a bad/stale line_user_id must never fail or delay
// saving the assignment itself.
//
// CONFIG — reuses the same Messaging API channel as order-notify.ts
// (one LINE Official Account for the whole platform):
//   LINE_CHANNEL_ACCESS_TOKEN   same var as order-notify.ts
// No separate "to" env var here — the recipient is per-driver
// (drivers.line_user_id), not a fixed admin userId/groupId.

const LINE_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function formatThaiDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

export interface DriverJobPayload {
  driverLineUserId: string;
  pickupLocation: string;
  dropoffLocation: string;
  pickupTime: string; // ISO timestamptz
  passengerName: string | null;
  vehicle: string | null;
  isUpdate: boolean; // true = edited an existing assignment, false = new
}

function buildMessageText(payload: DriverJobPayload): string {
  const lines = [
    payload.isUpdate ? '🔄 งานขับรถของคุณถูกแก้ไข' : '🚗 งานขับรถใหม่',
    `📍 รับ: ${payload.pickupLocation}`,
    `📍 ส่ง: ${payload.dropoffLocation}`,
    `🕐 เวลารับ: ${formatThaiDateTime(payload.pickupTime)}`,
  ];
  if (payload.passengerName) lines.push(`👤 ผู้โดยสาร: ${payload.passengerName}`);
  if (payload.vehicle) lines.push(`🚙 รถ: ${payload.vehicle}`);
  return lines.join('\n');
}

async function pushToDriver(payload: DriverJobPayload): Promise<void> {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelAccessToken) return; // channel not configured — silent no-op, same as order-notify.ts

  const res = await fetchWithTimeout(
    'https://api.line.me/v2/bot/message/push',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        to: payload.driverLineUserId,
        messages: [{ type: 'text', text: buildMessageText(payload) }],
      }),
    },
    LINE_TIMEOUT_MS
  );

  if (!res.ok) {
    // Don't log the raw response body — LINE echoes the `to` userId
    // back in error payloads, and that's an identifier we don't want
    // sitting in production logs. Status is enough to debug from.
    throw new Error(`LINE push to driver responded ${res.status}`);
  }
}

export async function notifyDriverAssigned(payload: DriverJobPayload): Promise<void> {
  try {
    await pushToDriver(payload);
  } catch (err) {
    console.error('driver LINE notify failed:', err);
  }
}
