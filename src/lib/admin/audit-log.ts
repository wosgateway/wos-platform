// src/lib/admin/audit-log.ts
//
// Writes a row to public.audit_log (sql/073_audit_log.sql). Call this
// from admin API routes, AFTER requireAdmin() has already passed —
// this file does no authorization of its own, it only records what
// happened.
//
// Always uses the service-role client, since audit_log has no INSERT
// policy for `authenticated` by design (see 073's comments). Logging
// failures are swallowed on purpose: an admin action that already
// succeeded (partner suspended, payment verified, tenant provisioned)
// should not be reported to the caller as failed just because the log
// write itself had a hiccup. Failures are still console.error'd so
// they show up in server logs.

import { createServiceClient } from '@/lib/supabase/service';

interface LogAdminActionInput {
  actorUserId: string;
  actorEmail?: string | null;
  action: string; // e.g. 'partner.suspend', 'payment.verify'
  entityType: string; // e.g. 'partner', 'payment', 'organization'
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

export async function logAdminAction(input: LogAdminActionInput): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from('audit_log').insert([
      {
        actor_user_id: input.actorUserId,
        actor_email: input.actorEmail ?? null,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        before: input.before ?? null,
        after: input.after ?? null,
        metadata: input.metadata ?? null,
      },
    ]);
    if (error) {
      console.error('logAdminAction: insert failed', { action: input.action, error });
    }
  } catch (err) {
    console.error('logAdminAction: unexpected error', { action: input.action, err });
  }
}
