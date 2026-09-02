// src/lib/notify/customer-whatsapp.ts
//
// PHASE 4 — "WhatsApp แบบทางเดียว" (one-way only, per the 5-phase plan):
// sends a WhatsApp Business Platform (Meta Cloud API) TEMPLATE message
// to the CUSTOMER on exactly 3 events — order confirmed, payment
// verified, partner/driver assigned. There is no inbound handling, no
// AI reading replies, no conversation state — this module can only
// ever send, never receive. That is intentional scope, not a
// shortcut: the plan explicitly cut 2-way WhatsApp + AI concierge
// until there's real data on what customers ask most.
//
// This mirrors the existing best-effort, fire-and-forget pattern
// already used for the admin-facing src/lib/notify/order-notify.ts:
// every function here is wrapped so it can only ever resolve, never
// throw, and every call site (see the 4 route.ts files listed below)
// fires this WITHOUT awaiting it before responding — same reasoning
// as order-notify.ts's header comment: a WhatsApp/Meta outage must
// NEVER fail or roll back a real transaction (payment verify, order
// confirm, partner assignment).
//
// Call sites (Phase 4's 3 events, mapped onto the app's actual status
// transitions — there's no single generic "order status changed"
// hook in this codebase, each transition lives in its own route):
//   1. Order confirmed   -> app/api/quote/[orderNumber]/confirm/route.ts
//      (customer clicks "ยืนยันรายการนี้"; draft -> pending_deposit)
//   2. Payment verified   -> app/api/admin/payments/[id]/verify/route.ts
//                         -> app/api/partner/payments/[id]/verify/route.ts
//      (admin_verify_payment / partner_verify_payment RPCs succeed)
//   3. Partner assigned   -> app/api/admin/order-items/[id]/assign/route.ts
//      (admin_assign_order_item RPC succeeds — "driver assigned" in
//      the plan's wording, generalized to any service_type since
//      assignment isn't transport-only in the real schema)
//
// CONFIG — all optional, independently. Missing config for a given
// piece disables just that piece (silent no-op), same philosophy as
// order-notify.ts so local/dev/preview never needs any of this set:
//   WHATSAPP_ACCESS_TOKEN        Meta permanent/system-user token
//   WHATSAPP_PHONE_NUMBER_ID     the Cloud API "from" number's ID
//   WHATSAPP_TEMPLATE_ORDER_CONFIRMED
//   WHATSAPP_TEMPLATE_PAYMENT_VERIFIED
//   WHATSAPP_TEMPLATE_PARTNER_ASSIGNED
// Each template name is optional on its own — turn them on one at a
// time as each clears Meta's per-template approval (can take a day or
// two per template). Every template is assumed to take exactly ONE
// body variable, {{1}} = order_number. If a template needs more
// variables, extend `components` in sendTemplate() to match — don't
// change what callers pass in.
//
// LANGUAGE: customers.preferred_language ('th' | 'lo' | 'en', see
// migration 011) is passed straight through as the template's
// `language.code`. Meta's supported template-language list does
// include Lao (code "lo"), so this assumes a lo-language variant of
// each template gets submitted for approval alongside th/en — same
// content, translated, same variable count. If a language variant
// hasn't been approved yet, Meta's API will reject that send; that
// rejection is caught and logged like any other failure below, it
// never surfaces to the customer or blocks the underlying action.
//
// PHONE FORMAT: WhatsApp's Cloud API needs a full E.164 number with
// country code, digits only, no leading '+'. src/lib/phone.ts's
// normalizePhone() only ever guesses a country code for Thai-shaped
// local numbers (0812345678 -> +66812345678) and deliberately leaves
// everything else — including Lao numbers — exactly as typed, since a
// wrong guess would misfile a customer's order history (see that
// file's header comment). That means a customer.phone value with no
// leading '+' and no guessed +66 (most raw Lao entries, since the
// booking form has no country picker) can't be trusted to already
// include a country code, and WhatsApp would either bounce it or —
// worse — silently deliver to a wrong number that happens to be
// valid. toWhatsAppRecipient() below refuses to send in that case
// rather than guess; the operational gap this leaves (Lao customers
// who typed a local-format number get no WhatsApp notification) is a
// data-collection problem to fix at the booking form (e.g. add a
// country selector), not something this module should paper over.

export type PreferredLanguage = 'th' | 'lo' | 'en';

// --- Fetch timeout guard ---
// Same reasoning and same 15s standard as the Chatwoot webhook's
// fetchWithTimeout: this call is fire-and-forget (never awaited at
// the call site), but an unbounded fetch can still leave a Promise
// hanging indefinitely if Meta's API stalls, tying up a live
// connection/handle for no reason. Keep this consistent with any
// other integration's timeout rather than inventing a new value.
const WHATSAPP_TIMEOUT_MS = 15_000;

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

interface SendTemplateArgs {
  toPhone: string;
  languageCode: PreferredLanguage;
  templateName: string;
  orderNumber: string;
}

function toWhatsAppRecipient(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed.startsWith('+')) {
    // No confirmed country code — see PHONE FORMAT note above. Don't
    // guess; skip sending rather than risk misdelivery.
    return null;
  }
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

async function sendTemplate({
  toPhone,
  languageCode,
  templateName,
  orderNumber,
}: SendTemplateArgs): Promise<void> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) return; // channel not configured

  const recipient = toWhatsAppRecipient(toPhone);
  if (!recipient) {
    console.warn(
      `customer WhatsApp notify skipped for order ${orderNumber}: phone has no confirmed country code`
    );
    return;
  }

  const res = await fetchWithTimeout(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: orderNumber }],
            },
          ],
        },
      }),
    },
    WHATSAPP_TIMEOUT_MS
  );

  if (!res.ok) {
    // Don't log the raw response body: Meta may echo back parts of
    // the request (recipient number, template params) in its error
    // payload, and that's customer data we don't want dumped into
    // production logs. Status + template name is enough to debug.
    throw new Error(
      `WhatsApp template send failed: ${templateName} (${res.status})`
    );
  }
}

// Every exported notify* function follows the same shape as
// notifyNewOrder() in order-notify.ts: swallow-and-log, never throw,
// so `void notifyXyz(...)` at the call site is always safe.
async function safeSendTemplate(args: SendTemplateArgs): Promise<void> {
  try {
    await sendTemplate(args);
  } catch (err) {
    console.error('customer WhatsApp notify failed:', err);
  }
}

export interface CustomerContact {
  orderNumber: string;
  phone: string;
  preferredLanguage: PreferredLanguage;
}

// customers.preferred_language is a free-ish DB column, not a typed
// enum enforced at the app layer — `as PreferredLanguage` alone only
// tells TypeScript to trust it, it doesn't check the actual value.
// A stray value (e.g. 'thai', 'la', 'en-US', null) would otherwise
// get sent straight to Meta as template.language.code and bounce (or
// worse, silently match some other approved language). Validate and
// fall back to 'th' rather than trust the column blindly.
function normalizePreferredLanguage(value: unknown): PreferredLanguage {
  if (value === 'th' || value === 'lo' || value === 'en') {
    return value;
  }
  return 'th';
}

export async function notifyOrderConfirmed(contact: CustomerContact): Promise<void> {
  const templateName = process.env.WHATSAPP_TEMPLATE_ORDER_CONFIRMED;
  if (!templateName) return;
  await safeSendTemplate({
    toPhone: contact.phone,
    languageCode: contact.preferredLanguage,
    templateName,
    orderNumber: contact.orderNumber,
  });
}

export async function notifyPaymentVerified(contact: CustomerContact): Promise<void> {
  const templateName = process.env.WHATSAPP_TEMPLATE_PAYMENT_VERIFIED;
  if (!templateName) return;
  await safeSendTemplate({
    toPhone: contact.phone,
    languageCode: contact.preferredLanguage,
    templateName,
    orderNumber: contact.orderNumber,
  });
}

export async function notifyPartnerAssigned(contact: CustomerContact): Promise<void> {
  const templateName = process.env.WHATSAPP_TEMPLATE_PARTNER_ASSIGNED;
  if (!templateName) return;
  await safeSendTemplate({
    toPhone: contact.phone,
    languageCode: contact.preferredLanguage,
    templateName,
    orderNumber: contact.orderNumber,
  });
}

// ---------------------------------------------------------------
// Contact lookup helpers — every call site only has an order id, a
// payment id, or an order_item id on hand, never the customer's
// phone/language directly. Centralized here (rather than duplicated
// in each route) since all 3 call sites need the same 2-query join:
// orders.patient_id -> customers.{phone,preferred_language}, the same
// join already done ad-hoc in app/api/admin/order-items/pending/route.ts.
// ---------------------------------------------------------------

type Supabase = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export async function getCustomerContactByOrderId(
  supabase: Supabase,
  orderId: string
): Promise<CustomerContact | null> {
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('order_number, patient_id')
    .eq('id', orderId)
    .single();
  if (orderErr) {
    // Log so a lookup failure doesn't just look like "no notify needed" in
    // production — no PII here, order id + Supabase error code/message only.
    console.error(
      `customer WhatsApp notify: order lookup failed for order ${orderId}:`,
      orderErr.message
    );
    return null;
  }
  if (!order?.patient_id) return null;

  const { data: customer, error: customerErr } = await supabase
    .from('customers')
    .select('phone, preferred_language')
    .eq('id', order.patient_id)
    .single();
  if (customerErr) {
    console.error(
      `customer WhatsApp notify: customer lookup failed for order ${orderId}:`,
      customerErr.message
    );
    return null;
  }
  if (!customer?.phone) return null;

  return {
    orderNumber: order.order_number,
    phone: customer.phone,
    preferredLanguage: normalizePreferredLanguage(customer.preferred_language),
  };
}

export async function getCustomerContactByOrderItemId(
  supabase: Supabase,
  orderItemId: string
): Promise<CustomerContact | null> {
  const { data: item, error: itemErr } = await supabase
    .from('order_items')
    .select('order_id')
    .eq('id', orderItemId)
    .single();
  if (itemErr) {
    console.error(
      `customer WhatsApp notify: order_item lookup failed for item ${orderItemId}:`,
      itemErr.message
    );
    return null;
  }
  if (!item?.order_id) return null;

  return getCustomerContactByOrderId(supabase, item.order_id);
}
