// src/lib/notify/hotel-line.ts
//
// Pushes a hotel partner's OWN guest details to their LINE account
// when a trip_event of type 'hotel' linked to that partner is created
// or edited (see POST in app/api/trips/[tripId]/events/route.ts and
// PATCH in app/api/trips/[tripId]/events/[eventId]/route.ts).
//
// SCOPE — same "only what this party is responsible for" rule as
// driver-line.ts: check-in date, check-out date, guest name, and the
// event's title/notes (the closest things this schema has to a
// room/package description — trip_events has no dedicated "room"
// column; see the header of migration 084_trip_events_end_date.sql
// for how event_date/end_date map to check-in/check-out). Never the
// rest of the trip (transport, clinic, other days).
//
// Admin-set-only link (see partners.line_user_id, migration 086) — no
// auto phone-match exists for partners, unlike drivers. A partner with
// no line_user_id set is silently skipped here; staff still tells them
// out-of-band until admin links their LINE.
//
// Same fire-and-forget philosophy as driver-line.ts / order-notify.ts:
// can only ever resolve, never throw. Call sites must NOT await this
// before responding.
//
// CONFIG — reuses the same Messaging API channel as order-notify.ts /
// driver-line.ts:
//   LINE_CHANNEL_ACCESS_TOKEN

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

export interface HotelJobPayload {
  partnerLineUserId: string;
  title: string; // event title — closest thing this schema has to a room/package description
  checkInDate: string; // trip_events.event_date
  checkOutDate: string | null; // trip_events.end_date
  guestName: string | null; // trip_events.contact_name
  notes: string | null;
  isUpdate: boolean;
}

function buildMessageText(payload: HotelJobPayload): string {
  const lines = [
    payload.isUpdate ? '🔄 รายการที่พักถูกแก้ไข' : '🏨 รายการที่พักใหม่',
    `📋 ${payload.title}`,
    `📅 เช็คอิน: ${formatThaiDate(payload.checkInDate)}`,
    `📅 เช็คเอาท์: ${payload.checkOutDate ? formatThaiDate(payload.checkOutDate) : 'ยังไม่ระบุ'}`,
  ];
  if (payload.guestName) lines.push(`👤 ผู้เข้าพัก: ${payload.guestName}`);
  if (payload.notes) lines.push(`📝 หมายเหตุ: ${payload.notes}`);
  return lines.join('\n');
}

async function pushToPartner(payload: HotelJobPayload): Promise<void> {
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
        to: payload.partnerLineUserId,
        messages: [{ type: 'text', text: buildMessageText(payload) }],
      }),
    },
    LINE_TIMEOUT_MS
  );

  if (!res.ok) {
    // Don't log the raw response body — LINE echoes the `to` userId
    // back in error payloads. Status is enough to debug from.
    throw new Error(`LINE push to partner responded ${res.status}`);
  }
}

export async function notifyPartnerHotelEvent(payload: HotelJobPayload): Promise<void> {
  try {
    await pushToPartner(payload);
  } catch (err) {
    console.error('partner (hotel) LINE notify failed:', err);
  }
}
