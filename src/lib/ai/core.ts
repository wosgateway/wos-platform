import OpenAI from 'openai';
import { WOS_AI_SYSTEM_PROMPT } from './prompts';
import { searchWosNotionKnowledge } from './notion-knowledge';
import {
  searchPrograms,
  getProgramDetails,
} from './programs';

// Lazy: `new OpenAI()` throws when OPENAI_API_KEY is missing, and doing that
// at module scope made `next build` fail whenever the key was not present in
// the build environment. Creating the client on first use keeps builds
// independent of runtime secrets.
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
            'Short search keyword in THAI. Program titles and descriptions are stored in Thai, so translate the customer intent into Thai keywords (for example "knee check" -> "ตรวจเข่า", "dental implant" -> "รากฟันเทียม"), even when the customer writes in English or Lao. Prefer 1-3 words.',
        },
        limit: {
          type: 'integer',
          description:
            'Maximum number of search results. Use 5 or fewer.',
          minimum: 1,
          maximum: 5,
        },
      },
      required: ['query', 'limit'],
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
] as const;

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

    console.log(
      '[WOS_AI_TOOL] searchPrograms query:',
      query
    );

    const items = await searchPrograms(query, limit);

    console.log(
      '[WOS_AI_TOOL] searchPrograms results:',
      items
    );

    return {
      success: true,
      count: items.length,
      items,
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

    console.log(
      '[WOS_AI_TOOL] getProgramDetails programId:',
      programId
    );

    const item = await getProgramDetails(programId);

    console.log(
      '[WOS_AI_TOOL] getProgramDetails result:',
      item
    );

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
    };
  }

  throw new Error(
    `Unknown WOS AI tool: ${name}`
  );
}

/**
 * Maximum number of tool rounds allowed for one customer message.
 *
 * Example:
 *
 * Round 1:
 * searchPrograms
 *
 * Round 2:
 * getProgramDetails
 *
 * Round 3:
 * final answer
 *
 * This prevents accidental infinite tool loops.
 */
const MAX_TOOL_ROUNDS = 4;

export async function runWosAI(
  userMessage: string
) {
  try {
    /**
     * -------------------------------------------------------
     * 1. Retrieve verified WOS knowledge from Notion
     * -------------------------------------------------------
     */
    const knowledge =
      await searchWosNotionKnowledge(
        userMessage
      );

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
${knowledgeContext}`;

    /**
     * -------------------------------------------------------
     * 3. Initial OpenAI request
     * -------------------------------------------------------
     */
    let response =
      await getOpenAI().responses.create({
        model: 'gpt-5.6-luna',
        instructions,
        input: userMessage,
        tools: [...tools],
      });

    /**
     * -------------------------------------------------------
     * 4. Tool execution loop
     *
     * This is important.
     *
     * The old version only handled one tool round.
     *
     * Example:
     *
     * Customer:
     * "มีโปรแกรมฟื้นฟูสุขภาพไหม"
     *
     * AI:
     * searchPrograms()
     *
     * Then customer:
     * "อันแรกมีรายละเอียดอะไรบ้าง"
     *
     * AI may need:
     * getProgramDetails()
     *
     * We therefore allow several tool rounds.
     * -------------------------------------------------------
     */
    for (
      let round = 0;
      round < MAX_TOOL_ROUNDS;
      round++
    ) {
      const functionCalls =
        response.output.filter(
          (item) =>
            item.type === 'function_call'
        );

      /**
       * No more tools needed.
       * AI has produced the final response.
       */
      if (functionCalls.length === 0) {
        break;
      }

      const toolOutputs = [];

      for (const item of functionCalls) {
        try {
          const args = JSON.parse(
            item.arguments || '{}'
          );

          const result =
            await executeTool(
              item.name,
              args
            );

          toolOutputs.push({
            type:
              'function_call_output' as const,
            call_id: item.call_id,
            output:
              JSON.stringify(result),
          });
        } catch (toolError) {
          console.error(
            '[WOS_AI_TOOL_ERROR]',
            item.name,
            toolError
          );

          toolOutputs.push({
            type:
              'function_call_output' as const,
            call_id: item.call_id,
            output: JSON.stringify({
              success: false,
              message:
                'The requested WOS tool could not retrieve verified information.',
            }),
          });
        }
      }

      /**
       * Feed tool results back to the model.
       */
      response =
        await getOpenAI().responses.create({
          model: 'gpt-5.6-luna',
          instructions,
          previous_response_id:
            response.id,
          input: toolOutputs,
          tools: [...tools],
        });
    }

    /**
     * -------------------------------------------------------
     * 5. Final customer-facing response
     * -------------------------------------------------------
     */
    const finalText = response.output_text?.trim();

    if (finalText) {
      return finalText;
    }

    // The model was still requesting tools after MAX_TOOL_ROUNDS (or returned
    // nothing). Never send the customer an empty message.
    console.warn('[WOS_AI] empty final answer after tool rounds');
    return 'Sorry, I could not complete that request right now. Please contact the WOS team for help. / ขออภัย ตอนนี้ยังตอบคำถามนี้ไม่ได้ กรุณาติดต่อทีมงาน WOS ค่ะ';
  } catch (error) {
    console.error(
      '[WOS_OPENAI_ERROR]',
      error
    );

    throw error;
  }
}