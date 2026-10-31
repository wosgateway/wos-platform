// OpenAI-compatible adapter (LiteLLM), same env contract as core.ts.
// Kept separate so core.ts is not imported (avoids a circular import).
import OpenAI from 'openai';
import type { LlmJson } from './understand';

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  if (!v) return undefined;
  return v.replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
}

function logRuntimeDiagnostics(baseURL: string | undefined): void {
  let protocol: string | null = null;
  let hostname: string | null = null;
  let parseError: string | null = null;

  if (baseURL) {
    try {
      const parsed = new URL(baseURL);
      protocol = parsed.protocol;
      hostname = parsed.hostname;
    } catch (error) {
      parseError = error instanceof Error ? error.message : 'url_parse_failed';
    }
  }

  console.log('[AI_UNDERSTANDING_LLM]', {
    baseURLPresent: Boolean(baseURL),
    baseURLLength: baseURL?.length ?? 0,
    protocol,
    hostname,
    parseError,
    apiKeyPresent: Boolean(env('LITELLM_API_KEY') || env('OPENAI_API_KEY')),
    model: env('WOS_AI_UNDERSTAND_MODEL') || env('LITELLM_MODEL') || 'default',
  });
}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    const baseURL = env('LITELLM_BASE_URL');
    logRuntimeDiagnostics(baseURL);
    client = new OpenAI({
      apiKey: env('LITELLM_API_KEY') || env('OPENAI_API_KEY'),
      ...(baseURL ? { baseURL } : {}),
      maxRetries: 0,
    });
  }
  return client;
}

/** WOS_AI_UNDERSTAND_MODEL lets you point this cheap/fast call at a smaller model than the answer model. */
export function createUnderstandLlm(): LlmJson {
  return async ({ system, user, timeoutMs }) => {
    const res = await getClient().chat.completions.create(
      {
        model: env('WOS_AI_UNDERSTAND_MODEL') || env('LITELLM_MODEL') || 'gpt-5.6-luna',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      { timeout: timeoutMs },
    );
    return res.choices[0]?.message?.content ?? '';
  };
}
