// Supabase I/O for the Understanding layer (service role, server only).
import { createHash, randomUUID } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import type { CatalogItem } from './types';
import type { ProvinceRecord } from './provinces';

// ---- provinces (cached) ----------------------------------------------------
const PROVINCE_TTL_MS = 10 * 60_000;
let provinceCache: { at: number; rows: ProvinceRecord[] } | null = null;

export async function loadProvinces(): Promise<ProvinceRecord[]> {
  if (provinceCache && Date.now() - provinceCache.at < PROVINCE_TTL_MS) return provinceCache.rows;
  const { data, error } = await createServiceClient()
    .from('provinces')
    .select('id,name_th,name_en,name_lo,aliases')
    .eq('is_active', true);
  if (error) throw error;
  const rows = (data ?? []).map((r) => ({ ...r, aliases: r.aliases ?? [] })) as ProvinceRecord[];
  provinceCache = { at: Date.now(), rows };
  return rows;
}

// ---- conversation state ----------------------------------------------------
export interface PendingService {
  id: string;
  query: string;
  source: 'explicit-service' | 'symptom';
  createdAt: string;
}

function pendingTuple(pending: PendingService | null) {
  return {
    pending_request_id: pending?.id ?? null,
    pending_service_query: pending?.query ?? null,
    pending_service_source: pending?.source ?? null,
    pending_service_created_at: pending?.createdAt ?? null,
  };
}

/** Complete tuple writes only. Errors must retain the caller's request, never look like success. */
export async function replacePendingService(conversationId: string, channel: string,
  service: Pick<PendingService, 'query' | 'source'>): Promise<PendingService> {
  const pending: PendingService = { ...service, id: randomUUID(), createdAt: new Date().toISOString() };
  const { error } = await createServiceClient().from('ai_conversation_state').upsert({
    conversation_id: conversationId, channel, ...pendingTuple(pending),
  }, { onConflict: 'conversation_id' });
  if (error) throw new Error('Pending service persistence failed');
  return pending;
}

/** Compare-and-clear prevents an old lookup from clearing a replacement request. */
export async function clearPendingService(conversationId: string, requestId?: string): Promise<void> {
  let update = createServiceClient().from('ai_conversation_state')
    .update(pendingTuple(null)).eq('conversation_id', conversationId);
  if (requestId) update = update.eq('pending_request_id', requestId);
  const { error } = await update;
  if (error) throw new Error('Pending service clear failed');
}

/** Province authority is independent of coverage and selection. */
export async function setCurrentProvince(conversationId: string, channel: string,
  state: ConversationState | null, provinceId: string): Promise<void> {
  if (state?.provinceId === provinceId) return;
  const catalogProvince = state?.catalogProvinceId ?? state?.catalogQuery?.provinceId;
  const invalidate = catalogProvince && catalogProvince !== provinceId;
  const { error } = await createServiceClient().from('ai_conversation_state').upsert({
    conversation_id: conversationId, channel, province_id: provinceId,
    ...(invalidate ? { catalog_query: null, last_catalog: [], catalog_offset: 0, catalog_updated_at: null } : {}),
  }, { onConflict: 'conversation_id' });
  if (error) throw new Error('Province persistence failed');
}

export interface ConversationState {
  pending?: PendingService | null;
  /** Invalidation metadata survives catalog TTL; it never authorizes replay. */
  catalogProvinceId?: string | null;
  provinceId: string | null;
  lastCatalog: CatalogItem[];
  catalogQuery: { provinceId: string | null; query: string | null } | null;
  catalogOffset: number;
  selectedProgramId: string | null;
  catalogUpdatedAt: string | null;
}

const CATALOG_TTL_MS = 6 * 60 * 60_000;

export async function loadState(conversationId: string): Promise<ConversationState | null> {
  const { data, error } = await createServiceClient()
    .from('ai_conversation_state')
    .select('province_id,last_catalog,catalog_query,catalog_offset,selected_program_id,catalog_updated_at,pending_request_id,pending_service_query,pending_service_source,pending_service_created_at')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) throw new Error('Conversation state read failed');
  if (!data) return null;
  const fresh = data.catalog_updated_at && Date.now() - Date.parse(data.catalog_updated_at) < CATALOG_TTL_MS;
  return {
    catalogProvinceId: (data.catalog_query as ConversationState['catalogQuery'])?.provinceId ?? null,
    pending: data.pending_request_id ? {
      id: data.pending_request_id, query: data.pending_service_query,
      source: data.pending_service_source, createdAt: data.pending_service_created_at,
    } : null,
    provinceId: data.province_id ?? null,
    lastCatalog: fresh && Array.isArray(data.last_catalog) ? (data.last_catalog as CatalogItem[]) : [],
    catalogQuery: fresh ? (data.catalog_query as ConversationState['catalogQuery']) : null,
    catalogOffset: fresh ? data.catalog_offset ?? 0 : 0,
    selectedProgramId: data.selected_program_id ?? null,
    catalogUpdatedAt: data.catalog_updated_at ?? null,
  };
}

export async function saveState(conversationId: string, channel: string, patch: Partial<Omit<ConversationState, 'pending' | 'catalogProvinceId'>>): Promise<void> {
  const row: Record<string, unknown> = { conversation_id: conversationId, channel };
  if ('provinceId' in patch) row.province_id = patch.provinceId;
  if ('lastCatalog' in patch) { row.last_catalog = patch.lastCatalog; row.catalog_updated_at = new Date().toISOString(); }
  if ('catalogQuery' in patch) row.catalog_query = patch.catalogQuery;
  if ('catalogOffset' in patch) row.catalog_offset = patch.catalogOffset;
  if ('selectedProgramId' in patch) row.selected_program_id = patch.selectedProgramId;
  const { error } = await createServiceClient().from('ai_conversation_state').upsert(row, { onConflict: 'conversation_id' });
  if (error) console.warn('[WOS_AI_STATE_SAVE_FAILED]', error.message);
}

export async function clearState(conversationId: string): Promise<void> {
  const { error } = await createServiceClient().from('ai_conversation_state').delete().eq('conversation_id', conversationId);
  if (error) console.warn('[WOS_AI_STATE_CLEAR_FAILED]', error.message);
}

// ---- observability ---------------------------------------------------------
export interface AiRequestLog {
  conversationId?: string | null;
  channel: string;
  mode: 'shadow' | 'on';
  message: string;
  language?: string | null;
  intent?: string | null;
  confidence?: number | null;
  entities?: unknown;
  action?: string | null;
  deferReason?: string | null;
  handled: boolean;
  latencyMs: number;
  error?: string | null;
}

/**
 * Customer text is personal data (the chat route deliberately never logs it).
 * Default: store only length + SHA-256. Set AI_LOG_TEXT=true to also keep the (truncated)
 * text so real failures can be promoted into eval/cases.jsonl.
 */
export async function logAiRequest(l: AiRequestLog): Promise<void> {
  try {
    const keepText = process.env.AI_LOG_TEXT === 'true';
    const { error } = await createServiceClient().from('ai_requests').insert({
      conversation_id: l.conversationId ?? null,
      channel: l.channel,
      mode: l.mode,
      message_len: l.message.length,
      message_sha256: createHash('sha256').update(l.message).digest('hex'),
      message_text: keepText ? l.message.slice(0, 500) : null,
      language: l.language ?? null,
      intent: l.intent ?? null,
      confidence: l.confidence ?? null,
      entities: l.entities ?? null,
      action: l.action ?? null,
      defer_reason: l.deferReason ?? null,
      handled: l.handled,
      latency_ms: l.latencyMs,
      error: l.error ?? null,
    });
    if (error) console.warn('[WOS_AI_LOG_FAILED]', error.message);
  } catch (e) {
    console.warn('[WOS_AI_LOG_FAILED]', e instanceof Error ? e.message : String(e));
  }
}
