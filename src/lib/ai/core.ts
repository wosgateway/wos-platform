import OpenAI from 'openai';
import { WOS_AI_SYSTEM_PROMPT } from './prompts';
import { looksLikeLeakedToolCall, sanitizeHistory } from './leak-guard';
import {
  buildFallbackReply,
  buildProgramAnswer,
  extractVerifiedPrograms,
  type VerifiedProgram,
} from './program-answer';
import {
  annotateToolResult,
  collectUuidsFromMessages,
  NO_LOOKUP_TOOL,
  normalizeToolCall,
  validateToolArgs,
} from './tool-guard';
import {
  searchPrograms,
  getProgramDetails,
} from './programs';
import { searchWosNotionKnowledge } from './notion-knowledge';
import { createServiceClient } from '@/lib/supabase/service';

// Lazy: `new OpenAI()` throws when OPENAI_API_KEY is missing, and doing that
// at module scope made `next build` fail whenever the key was not present in
// the build environment. Creating the client on first use keeps builds
// independent of runtime secrets.
// gpt-5.6-luna defaults to "medium" reasoning, which took ~10s per answer.
// Customer chat is mostly lookup + summarise, so start at "low". Supported
// values for this model: none | low | medium | high | xhigh | max.

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.LITELLM_API_KEY || process.env.OPENAI_API_KEY,
      ...(process.env.LITELLM_BASE_URL
        ? { baseURL: process.env.LITELLM_BASE_URL }
        : {}),
    });
  }
  return openaiClient;
}

/**
 * WOS AI tools
 *
 * searchPrograms
 * → ค้นหาโปรแกรมที่ published + active
 *
 * getProgramDetails
 * → ดึงรายละเอียดเต็มของโปรแกรมที่พบจาก searchPrograms
 */
const tools = [
  {
    type: 'function' as const,
    name: 'searchPrograms',
    description:
      'Search currently published and active WOS programs, packages, and services. Use this when the customer asks what programs or services are available, wants to find a suitable program, or mentions a service category, wellness service, clinic, hotel, transport, package, or treatment. Never invent program information when this tool returns no result.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Short search keyword in THAI describing the SERVICE only (for example "knee check" -> "ตรวจเข่า", "dental implant" -> "รากฟันเทียม"), even when the customer writes in English or Lao. Prefer 1-3 words. Do NOT put a province/location name here - if the customer mentioned one, put it in the separate "province" field instead. Never silently drop a province the customer mentioned; it must always end up in "province".',
        },
        province: {
          type: ['string', 'null'],
          description:
            'The Thai province the customer asked about, in THAI (for example "หนองคาย", "อุดรธานี", "ขอนแก่น", "กรุงเทพ"), translating an English/Lao place name if needed. Set this whenever the customer\'s message - including earlier turns in this conversation - names a province/city. Use null only when no province was mentioned anywhere relevant. This field, not "query", is how province is communicated - it must never be dropped.',
        },
        limit: {
          type: 'integer',
          description:
            'Maximum number of search results. Use 5 or fewer.',
          minimum: 1,
          maximum: 5,
        },
      },
      required: ['query', 'province', 'limit'],
      additionalProperties: false,
    },
  },

  {
    type: 'function' as const,
    name: 'getProgramDetails',
    description:
      'Get detailed information about one specific published and active WOS program/package/service. Use this after searchPrograms when the customer wants more information about a specific program. Only use a program ID returned by searchPrograms. Never invent a program ID or program details.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        programId: {
          type: 'string',
          description:
            'The exact program ID returned by searchPrograms.',
        },
      },
      required: ['programId'],
      additionalProperties: false,
    },
  },

  // typhoon2-8b's Ollama template rewrites the last user message to "respond
  // with a JSON for a function call" whenever tools are attached, so the model
  // cannot answer a greeting / contact question in plain text. This no-op tool
  // gives it a legal way to say "no lookup needed"; core.ts then re-asks the
  // model WITHOUT tools so it answers in natural language.
  {
    type: 'function' as const,
    name: NO_LOOKUP_TOOL,
    description:
      'Call this ONLY when the customer message does NOT ask about programs, packages, services, treatments, prices, clinics, hotels or transport: for example a greeting, thanks, a request for contact details, or a general question. If the message mentions any program or service, call searchPrograms instead.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'One short phrase saying why no program lookup is needed.',
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
] as const;

/**
 * Appended to every successful tool result. Small local models tend to echo
 * the raw JSON back instead of answering; this states the required output
 * form right next to the data they are looking at.
 */
const ANSWER_INSTRUCTION =
  'Now answer the customer in plain natural language in the customer\'s language. Do NOT output JSON, field names, or code. Mention the program name, the provider (partner) name, the province, the price (show the special_price as the current price and original_price as the regular price if is_promotion is true) and the duration when available. Do not show internal ids or image links. Do not call another tool unless the answer still needs one.';

async function executeTool(
  name: string,
  args: Record<string, unknown>
) {
  /**
   * ---------------------------------------------------------
   * searchPrograms
   * ---------------------------------------------------------
   */
  if (name === 'searchPrograms') {
    const query = String(args.query ?? '').trim();
    // args.province is `null` (not undefined) when the model omits a
    // province, per the tool's ["string","null"] schema - String(null)
    // would otherwise turn that into the literal text "null".
    const province =
      args.province == null ? '' : String(args.province).trim();

    const limit = Math.min(
      Math.max(Number(args.limit ?? 5), 1),
      5
    );

    if (!query) {
      return {
        success: false,
        items: [],
        message: 'Search query is empty.',
      };
    }

    // The model is asked to send the service keyword and the province as
    // two separate structured fields (see the tool schema above) precisely
    // so a province can never be silently dropped from a free-text query.
    // searchPrograms()/detectLocation() in programs.ts scan the combined
    // string for a known province name, so recombine them here before the
    // lookup - the two fields are search *input*, not independent filters.
    const searchQuery = province ? `${query} ${province}`.trim() : query;

    console.log(
  '[WOS_AI_TOOL] searchPrograms args:',
  JSON.stringify({ query, province, searchQuery })
);

    const items = await searchPrograms(searchQuery, limit);

    console.log('[WOS_AI_TOOL] searchPrograms count:', items.length);

    return {
      success: true,
      count: items.length,
      items,
      ...(items.length > 0 ? { instruction: ANSWER_INSTRUCTION } : {}),
    };
  }

  /**
   * ---------------------------------------------------------
   * getProgramDetails
   * ---------------------------------------------------------
   */
  if (name === 'getProgramDetails') {
    const programId = String(
      args.programId ?? ''
    ).trim();

    if (!programId) {
      return {
        success: false,
        item: null,
        message: 'Program ID is empty.',
      };
    }

    const item = await getProgramDetails(programId);

    console.log('[WOS_AI_TOOL] getProgramDetails found:', Boolean(item));

    if (!item) {
      return {
        success: false,
        item: null,
        message:
          'Published active program not found.',
      };
    }

    return {
      success: true,
      item,
      instruction: ANSWER_INSTRUCTION,
    };
  }

  throw new Error(
    `Unknown WOS AI tool: ${name}`
  );
}

/**
 * ---------------------------------------------------------
 * Usage accounting
 * ---------------------------------------------------------
 */
type UsageTotals = {
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

function createUsageTotals(): UsageTotals {
  return {
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

// One customer question can cost several OpenAI requests (first call + one
// per tool round), and the full instructions are re-sent on each of them.
// Track the totals so quota/cost problems are visible in the logs.
// Avoid dumping the whole SDK error (it includes every response header,
// including Set-Cookie) into the logs.
function describeError(error: unknown) {
  const e = error as { status?: number; code?: string; message?: string };
  return {
    status: e?.status,
    code: e?.code,
    message: e?.message ?? String(error),
  };
}

function addChatUsage(
  totals: UsageTotals,
  response: {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: {
        cached_tokens?: number;
      } | null;
      completion_tokens_details?: {
        reasoning_tokens?: number;
      } | null;
    };
  }
) {
  totals.requests += 1;

  const u = response.usage;
  if (!u) return;

  totals.inputTokens += u.prompt_tokens ?? 0;
  totals.cachedInputTokens +=
    u.prompt_tokens_details?.cached_tokens ?? 0;
  totals.outputTokens += u.completion_tokens ?? 0;
  totals.reasoningTokens +=
    u.completion_tokens_details?.reasoning_tokens ?? 0;
  totals.totalTokens += u.total_tokens ?? 0;
}

/**
 * Maximum number of tool rounds allowed for one customer message.
 *
 * Typical path: searchPrograms -> getProgramDetails -> final answer.
 * 3 rounds also allows the documented broader-keyword retry.
 */
const MAX_TOOL_ROUNDS = 3;

/**
 * How many times to re-ask the model when its answer is a tool call written
 * out as plain text (see leak-guard.ts). After this, send the fallback
 * message instead of the leaked text.
 */
const MAX_LEAK_RETRIES = 1;

export type WosAIHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// =====================================================
// Dynamic contact-info block from Supabase `bot_config`.
//
// Without this the model guesses contact channels (e.g. a LINE OA from the
// domain name, or that no WhatsApp exists). Cached for 60s so it does not
// query Supabase on every message. `bot_config` is readable by the service
// role only, so createServiceClient() is required.
// =====================================================
type BotConfigRow = { key: string; value: string };
let botConfigCache: { block: string; fetchedAt: number } | null = null;
const BOT_CONFIG_TTL_MS = 60_000;

async function getContactInfoBlock(): Promise<string> {
  const now = Date.now();
  if (botConfigCache && now - botConfigCache.fetchedAt < BOT_CONFIG_TTL_MS) {
    return botConfigCache.block;
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('bot_config')
      .select('key, value');

    if (error || !data) {
      console.error('[ai-core] failed to load bot_config', error?.message);
      // A stale cached block beats no contact info at all.
      return botConfigCache?.block ?? '';
    }

    const cfg: Record<string, string> = {};
    for (const row of data as BotConfigRow[]) cfg[row.key] = row.value;

    const block = `VERIFIED CONTACT INFORMATION (use only when the customer asks for a contact channel — never invent a channel not listed here, e.g. do not claim Facebook/Telegram exist if not listed):
- Phone (Thailand): ${cfg.contact_phone_th ?? 'not available'}
- Phone (Laos): ${cfg.contact_phone_la ?? 'not available'}
- LINE OA: ${cfg.contact_line_id ?? 'not available'} (link: ${cfg.contact_line_url ?? ''})
- WhatsApp: ${cfg.contact_whatsapp_url ? `available (link: ${cfg.contact_whatsapp_url})` : 'not available'}
- Email: ${cfg.contact_email ?? 'not available'}`;

    botConfigCache = { block, fetchedAt: now };
    return block;
  } catch (err) {
    console.error(
      '[ai-core] getContactInfoBlock error',
      err instanceof Error ? err.message : String(err)
    );
    return botConfigCache?.block ?? '';
  }
}

export async function runWosAI(
  userMessage: string,
  // Optional prior turns of this conversation, oldest first. AI Core
  // owns context assembly — callers (the Chatwoot webhook, /api/ai/chat)
  // pass raw history; they must not build their own prompt around it.
  // Defaults to [] so existing single-string call sites keep working.
  history: WosAIHistoryMessage[] = []
) {
  try {
    /**
     * -------------------------------------------------------
     * 1. Retrieve verified WOS knowledge from Notion
     * -------------------------------------------------------
     */
    // Neither lookup may take the assistant down: on failure the model just
    // gets no knowledge / no contact block (and is told to say so).
    const [knowledge, contactInfoBlock] = await Promise.all([
      searchWosNotionKnowledge(userMessage).catch((err: unknown) => {
        console.error(
          '[ai-core] Notion knowledge lookup failed',
          err instanceof Error ? err.message : String(err)
        );
        return [] as Awaited<ReturnType<typeof searchWosNotionKnowledge>>;
      }),
      getContactInfoBlock(),
    ]);

    const knowledgeContext =
      knowledge.length > 0
        ? knowledge
            .map(
              (item) =>
                `SOURCE: ${item.source}\nTITLE: ${item.title}\nCONTENT: ${item.content}`
            )
            .join('\n\n')
        : 'NO VERIFIED KNOWLEDGE FOUND.';

    /**
     * -------------------------------------------------------
     * 2. Build AI instructions
     * -------------------------------------------------------
     */
    const instructions = `${WOS_AI_SYSTEM_PROMPT}

KNOWLEDGE RETRIEVAL RULES:
- Use the verified WOS knowledge below whenever it is relevant.
- Do not invent information that is not supported by verified knowledge or live tool results.
- If the knowledge does not contain the requested information, do not guess.
- Clearly distinguish between verified WOS information and information that is unavailable.
- Never treat missing knowledge as permission to invent an answer.

LIVE PROGRAM TOOL RULES:
- Use searchPrograms when the customer asks about available WOS programs, packages, services, treatments, wellness services, clinics, hotels, transport, or wants help finding a suitable program.
- Search results represent currently published and active WOS programs.
- Use getProgramDetails when the customer asks for detailed information about a specific program found through searchPrograms.
- Only use getProgramDetails with a program ID returned by searchPrograms.
- Never invent a program ID.
- Never invent a program, partner, price, service, availability, schedule, duration, or benefit.
- Always call searchPrograms with short THAI keywords, because program data is stored in Thai. Translate the customer's request into Thai first, even if the customer writes in English or Lao.
- If searchPrograms returns no results, retry once with a broader Thai keyword (for example "เข่า" instead of "ตรวจเข่า") before concluding anything.
- If the retry also returns no results, clearly say that no matching published WOS program was found.
- If getProgramDetails returns no result, clearly say that verified details for that program are not currently available.
- Do not claim that a program is available for a specific date or time unless a dedicated availability tool confirms it.
- Do not expose partner commercial terms, commission rates, internal IDs, admin data, security information, or other internal WOS operational information.
- Internal program IDs may be used by tools but must not be shown to customers.
- When the customer asks a broad question, search first rather than guessing.
- When the customer asks about a specific program and the search result identifies it, retrieve the details before answering when useful.
- Answer in the customer's language whenever practical.

VERIFIED WOS KNOWLEDGE:
${knowledgeContext}

${contactInfoBlock}

CONTACT INFO RULE:
- If the customer asks for a phone number, LINE, WhatsApp, or email, answer directly from the verified contact information above — do not say "the team will contact you" instead.
- Never invent a contact channel that is not listed above.`;

    /**
     * -------------------------------------------------------
     * 3. Initial OpenAI request
     * -------------------------------------------------------
     */
    const usage = createUsageTotals();

    // Chat Completions keeps the tool-call conversation in the standard
    // user -> assistant(tool_calls) -> tool -> assistant sequence.
    // Drop assistant turns that are leaked tool-call JSON (already sent to
    // customers before the output guard existed) so the model does not
    // imitate its own earlier mistake.
    const cleanHistory = sanitizeHistory(history);
    if (cleanHistory.length !== history.length) {
  console.warn(
    '[WOS_AI_HISTORY_SANITIZED]',
    JSON.stringify({
      removed: history.length - cleanHistory.length,
    })
  );
}

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: instructions },
      ...cleanHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const chatTools = tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    // Program ids the model is allowed to pass to getProgramDetails: ids that
    // already appear in the context, plus every id searchPrograms returns
    // during this run. Anything else (e.g. "ProgramID", "12345") is rejected
    // before it reaches the database.
    const knownProgramIds = collectUuidsFromMessages(messages);

    // Counts searchPrograms calls that returned nothing (see tool-guard.ts).
    const searchState = { emptyCount: 0 };

    // Programs returned by real tool calls in this run. If the model cannot
    // turn them into a readable answer, we build one from these directly.
    let verifiedPrograms: VerifiedProgram[] = [];

    // withTools=false is used to get a plain-text answer: with tools attached,
    // the typhoon2 template forces a function-call JSON reply whenever the last
    // message is from the user.
    const complete = (withTools = true) =>
      withTools
        ? getOpenAI().chat.completions.create({
            model: process.env.LITELLM_MODEL || 'gpt-5.6-luna',
            messages,
            tools: chatTools,
            tool_choice: 'auto',
          })
        : getOpenAI().chat.completions.create({
            model: process.env.LITELLM_MODEL || 'gpt-5.6-luna',
            messages,
          });

    // Runs the tool-call rounds for one model response and returns the last
// response (the one that should hold the final customer-facing text).
const stripSerializedToolFence = (text: string): string => {
  const trimmed = text.trim();

  const match = trimmed.match(
    /^```(?:json)?\s*([\s\S]*?)\s*```$/i
  );

  return match ? match[1].trim() : trimmed;
};

const runToolRounds = async (
  initial: Awaited<ReturnType<typeof complete>>
) => {
  let current = initial;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const message = current.choices[0]?.message;

    let toolCalls =
      message?.tool_calls?.filter(
        (
          call
        ): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
          call.type === 'function'
      ) ?? [];

    /**
     * Typhoon/Ollama may serialize a function call into message.content
     * instead of returning native message.tool_calls.
     *
     * Convert that serialized call into the same internal shape used by
     * native tool calls, then continue through normalizeToolCall(),
     * validateToolArgs(), executeTool(), and the normal tool-result loop.
     */
    if (
      toolCalls.length === 0 &&
      looksLikeLeakedToolCall(message?.content)
    ) {
      try {
        const raw = message.content?.trim() ?? '';
        const parsed = JSON.parse(
          stripSerializedToolFence(raw)
        ) as {
          type?: unknown;
          function?: unknown;
          arguments?: unknown;
        };

        if (
          parsed &&
          parsed.type === 'function' &&
          typeof parsed.function === 'string'
        ) {
          const rawArguments =
            typeof parsed.arguments === 'string'
              ? parsed.arguments
              : JSON.stringify(parsed.arguments ?? {});

          toolCalls = [
            {
              id: `leaked-tool-${round + 1}`,
              type: 'function',
              function: {
                name: parsed.function,
                arguments: rawArguments,
              },
            },
          ];

          console.warn(
            '[WOS_AI_LEAKED_TOOL_CALL_EXECUTING]',
            JSON.stringify({
              name: parsed.function,
              round: round + 1,
            })
          );
        }
      } catch (error) {
        console.warn(
          '[WOS_AI_LEAKED_TOOL_CALL_PARSE_ERROR]',
          error instanceof Error
            ? error.message
            : String(error)
        );
      }
    }

    if (toolCalls.length === 0) {
      break;
    }

    // Normalize every call first. Some models send name="function" with
    // the real tool name inside the arguments; repairing it here also
    // keeps malformed calls out of the context we send back.
    const allPrepared = toolCalls.map((call) => {
      let parsed: unknown = {};
      let parseError = false;

      try {
        parsed = JSON.parse(
          call.function.arguments || '{}'
        );
      } catch {
        parseError = true;
      }

      const normalized = normalizeToolCall(
        call.function.name,
        parsed
      );

      if (normalized.repaired) {
        console.warn(
          '[WOS_AI_TOOL_REPAIRED]',
          JSON.stringify({
            from: call.function.name,
            to: normalized.name,
          })
        );
      }

      return {
        call,
        normalized,
        parseError,
      };
    });

    // The model said "no lookup needed": drop that no-op call and ask
    // again without tools so it answers the customer in plain text.
    const prepared = allPrepared.filter(
      ({ normalized }) => normalized.name !== NO_LOOKUP_TOOL
    );

    if (prepared.length === 0) {
      console.log('[WOS_AI_NO_LOOKUP]');
      current = await complete(false);
      addChatUsage(usage, current);
      break;
    }

    // Preserve the assistant tool-call message before appending
    // the corresponding tool results.
    messages.push({
      role: 'assistant',
      content: looksLikeLeakedToolCall(message?.content)
        ? ''
        : message?.content ?? '',
      tool_calls: prepared.map(({ call, normalized }) => ({
        id: call.id,
        type: 'function' as const,
        function: {
          name: normalized.name,
          arguments: JSON.stringify(normalized.args),
        },
      })),
    });

    for (const {
      call,
      normalized,
      parseError,
    } of prepared) {
      try {
        if (parseError) {
          throw new Error(
            'Tool arguments were not valid JSON'
          );
        }

        const rejection = validateToolArgs(
          normalized.name,
          normalized.args,
          knownProgramIds,
          searchState
        );

        let result: unknown;

        if (rejection) {
          console.warn(
            '[WOS_AI_TOOL_REJECTED]',
            normalized.name
          );

          result = rejection;
        } else {
          result = annotateToolResult(
            normalized.name,
            await executeTool(
              normalized.name,
              normalized.args
            ),
            knownProgramIds,
            searchState
          );

          const found = extractVerifiedPrograms(
            normalized.name,
            result
          );

          if (found.length > 0) {
            verifiedPrograms = found;
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      } catch (toolError) {
        console.error(
          '[WOS_AI_TOOL_ERROR]',
          normalized.name,
          toolError
        );

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            success: false,
            message:
              'The requested WOS tool could not retrieve verified information.',
          }),
        });
      }
    }

    current = await complete(false);
    addChatUsage(usage, current);
  }

  return current;
};

    let response = await complete();

    addChatUsage(usage, response);

    /**
     * -------------------------------------------------------
     * 4. Tool execution loop
     * -------------------------------------------------------
     */
    response = await runToolRounds(response);

    let finalText =
      response.choices[0]?.message?.content?.trim() || '';

    /**
     * Output guard: the model sometimes writes a tool call as plain text
     * (e.g. {"type":"function","function":"searchPrograms",...}) instead of
     * using native tool_calls. Never send that to the customer - re-ask
     * the model, and fall back if it happens again.
     */
    for (
      let attempt = 1;
      attempt <= MAX_LEAK_RETRIES && looksLikeLeakedToolCall(finalText);
      attempt++
    ) {
      console.warn(
  '[WOS_AI_LEAKED_TOOL_CALL]',
  JSON.stringify({
    attempt,
    finalText,
  })
);

      // Re-sending the identical request tends to reproduce the identical
      // mistake, so tell the model explicitly what went wrong.
      messages.push({
        role: 'user',
        content:
          '[System reminder] Your previous reply was raw JSON / a tool call, which the customer cannot read. Reply again with a short, friendly natural-language answer for the customer based on the tool results above. No JSON, no field names, no ids.',
      });

      // No tools here: with tools attached and a user message last, the
      // typhoon2 template demands another function-call JSON reply.
      response = await complete(false);
      addChatUsage(usage, response);
      response = await runToolRounds(response);

      finalText = response.choices[0]?.message?.content?.trim() || '';
    }

    console.log(
      '[WOS_AI_USAGE]',
      JSON.stringify({
        ...usage,
        knowledgeArticles: knowledge.length,
        instructionsChars: instructions.length,
      })
    );

    /**
     * -------------------------------------------------------
     * 5. Final customer-facing response
     * -------------------------------------------------------
     */
    if (finalText && !looksLikeLeakedToolCall(finalText)) {
      return finalText;
    }

    // Either the model was still requesting tools after MAX_TOOL_ROUNDS (or
    // returned nothing), or it kept leaking tool-call text after the retry.
    // Never send the customer an empty message or raw JSON.
    // Verified program data exists but the model would not phrase it: answer
    // from the data itself rather than a generic apology.
    const programAnswer = buildProgramAnswer(verifiedPrograms, userMessage);
    if (programAnswer) {
      console.warn(
        '[WOS_AI] using server-built answer from verified program data',
        JSON.stringify({ programs: verifiedPrograms.length })
      );
      return programAnswer;
    }

    if (finalText) {
      console.error(
        '[WOS_AI] leaked tool-call text persisted after retry, sending fallback'
      );
    } else {
      console.warn('[WOS_AI] empty final answer after tool rounds');
    }
    return buildFallbackReply(userMessage);
  } catch (error) {
    console.error(
      '[WOS_OPENAI_ERROR]',
      JSON.stringify(describeError(error))
    );

    throw error;
  }
}
