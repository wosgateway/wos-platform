// src/lib/chatwoot/duplicate.ts
//
// Claim-then-resolve idempotency for the Chatwoot webhook. See
// sql/117_chatwoot_webhook_events.sql's header comment for the full
// model and its documented tradeoff. Mirrors the pattern already used
// for trip reminders (src/lib/trips/reminders/duplicate.ts).

import { createServiceClient } from '@/lib/supabase/service';

type ServiceClient = ReturnType<typeof createServiceClient>;
type EventStatus = 'sent' | 'failed';

const POSTGRES_UNIQUE_VIOLATION = '23505';

export type ClaimResult =
  | { shouldProcess: true; eventId: string }
  | { shouldProcess: false; reason: 'duplicate' }
  | { shouldProcess: false; reason: 'idempotency_unavailable' };

/**
 * Attempts to claim chatwoot_message_id by inserting a 'processing'
 * row.
 *
 * - Unique violation (someone already claimed this message id, this
 *   or a concurrent/duplicate webhook delivery) -> reason: 'duplicate'.
 *   Caller must NOT call the AI or reply again.
 * - Any other Supabase error (e.g. Supabase itself unreachable) ->
 *   reason: 'idempotency_unavailable'. FAILS CLOSED: the caller must
 *   NOT call the AI. WOS is currently on a limited OpenAI quota and
 *   actively controlling cost, and Chatwoot retries a failed webhook
 *   delivery on its own — so an idempotency-store outage should
 *   produce a 5xx (triggering that retry) rather than risk firing
 *   OpenAI 2-3x for the same customer message while Supabase is down.
 * - Success -> shouldProcess: true, eventId: <row id>, to be passed
 *   to recordWebhookEventResult() or releaseWebhookEvent() once the
 *   request resolves.
 */
export async function claimWebhookEvent(
  supabase: ServiceClient,
  chatwootMessageId: number,
  conversationId: number
): Promise<ClaimResult> {
  const { data, error } = await supabase
    .from('chatwoot_webhook_events')
    .insert({
      chatwoot_message_id: chatwootMessageId,
      conversation_id: conversationId,
      status: 'processing',
    })
    .select('id')
    .single();

  if (error) {
    if ((error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
      return { shouldProcess: false, reason: 'duplicate' };
    }
    // Deliberately still logs chatwootMessageId: it is an internal
    // Chatwoot message id (an integer), not customer content or PII,
    // and without it there is no way to trace which stuck/refused
    // message this log line corresponds to when investigating an
    // outage.
    console.error(
      `[chatwoot-webhook] idempotency claim failed for message ${chatwootMessageId}, failing closed:`,
      error.message
    );
    return { shouldProcess: false, reason: 'idempotency_unavailable' };
  }

  return { shouldProcess: true, eventId: data.id as string };
}

/**
 * Records the final outcome for a claimed event where the customer DID
 * receive a message (either the real AI answer, or a fallback message
 * because the AI failed). Use this for 'sent' (AI succeeded) and
 * 'failed' (AI failed but a fallback message still went out — e.g.
 * openai_429, openai_error). Do NOT use this when the Chatwoot send
 * itself failed — see releaseWebhookEvent() for that case.
 */
export async function recordWebhookEventResult(
  supabase: ServiceClient,
  eventId: string,
  status: EventStatus,
  reason: string | null
): Promise<void> {
  const { error } = await supabase
    .from('chatwoot_webhook_events')
    .update({ status, reason })
    .eq('id', eventId);

  if (error) {
    console.error(
      `[chatwoot-webhook] event result update failed for ${eventId}:`,
      error.message
    );
  }
}

/**
 * Releases a claimed event when the CUSTOMER NEVER RECEIVED A MESSAGE
 * at all — i.e. sendChatwootReply() itself threw, or some other
 * unexpected error happened before/around it. This is deliberately a
 * DELETE, not a status update to 'failed':
 *
 * If we left the row as 'failed', the unique constraint on
 * chatwoot_message_id would permanently block any future processing
 * of that exact message id — including Chatwoot's own webhook
 * delivery retry, which would hit 23505 on re-insert and be silently
 * skipped as "duplicate", so the customer would NEVER get a reply,
 * even after Chatwoot successfully retries.
 *
 * Deleting the row instead means a genuine Chatwoot retry re-runs the
 * whole flow — including calling the AI again. That is a deliberate
 * trade: a rare double OpenAI call (only on a Chatwoot delivery
 * failure, which is uncommon, not on every OpenAI failure) versus a
 * customer who silently never gets an answer, which is worse.
 */
export async function releaseWebhookEvent(
  supabase: ServiceClient,
  eventId: string
): Promise<void> {
  const { error } = await supabase
    .from('chatwoot_webhook_events')
    .delete()
    .eq('id', eventId);

  if (error) {
    console.error(
      `[chatwoot-webhook] failed to release event ${eventId} after send failure (row may be stuck as 'processing'):`,
      error.message
    );
  }
}
