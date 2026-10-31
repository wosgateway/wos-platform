import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Static migration contract checks only. These do NOT prove PostgreSQL locking,
// rollback, privilege enforcement or actual lifecycle execution.
const sql = readFileSync('supabase/migrations/20261023090000_web_ai_ownership.sql', 'utf8');
const body = (name: string) => sql.split(`create function public.${name}`)[1].split('end $$;')[0];
it('keeps AI state schema and data outside ownership migration', () => {
  expect(sql).not.toMatch(/(?:alter|delete from|update|insert into)\s+(?:public\.)?ai_conversation_state/i);
});
it('creation has atomic session/binding inserts, fixed lifetimes, and no inactivity refresh', () => {
  const create = body('web_ai_create_conversation');
  expect(create).toContain("t+interval '30 minutes',t+interval '24 hours'");
  expect(create).toContain("values(s.id,t,t+interval '24 hours')");
  expect(create).not.toMatch(/update public.web_ai_sessions/);
});
it('admission locks session then owned conversation and bounds idle refresh by absolute expiry', () => {
  const admit = body('web_ai_admit');
  expect(admit.indexOf('from public.web_ai_sessions')).toBeLessThan(admit.indexOf('from public.web_ai_conversations'));
  expect(admit).toContain('where selector=p_selector and owner_id=s.id for update');
  expect(admit).toContain("least(t+interval '30 minutes',absolute_expires_at)");
  expect(admit).not.toContain('set expires_at');
  expect(admit).not.toContain('set absolute_expires_at');
  expect(admit).toContain('s.revoked_at is not null');
  expect(admit).toContain('c.revoked_at is not null');
});
it('revocation uses session-first ordering and never clears revocation', () => {
  const revoke = body('web_ai_revoke');
  expect(revoke.indexOf('from public.web_ai_sessions')).toBeLessThan(revoke.indexOf('from public.web_ai_conversations'));
  expect(revoke).toContain('coalesce(revoked_at,clock_timestamp())');
});
it('retention is seven days and browser roles cannot execute ownership RPCs', () => {
  expect(body('web_ai_cleanup')).toContain("interval '7 days'");
  expect(sql).toContain('from public, anon, authenticated;');
  expect(sql).toContain('to service_role;');
});
