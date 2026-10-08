import { extractJson, parseUnderstanding, type CatalogItem, type Understanding } from './types';

export type LlmJson = (args: { system: string; user: string; timeoutMs: number }) => Promise<string>;

export const UNDERSTAND_SYSTEM = `You are the language-understanding layer of Fern (WOS, a Thailand-Laos wellness gateway).
You do NOT answer the customer and you never invent facts.
Convert the customer's latest message into ONE JSON object, nothing else (no markdown).

{"intent":"...","confidence":0.0-1.0,"entities":{"province":string|null,"program_query":string|null,"selection_index":int|null,"detail_field":"price"|"booking"|"requirements"|"location"|"other"|null},"uses_context":bool,"language":"th"|"lo"|"en"|"mixed"}

Intent meanings:
- RESET: start over / clear previous journey
- HANDOFF: explicitly asks for staff/human/agent
- HOTEL: hotel/accommodation/room availability
- TRANSPORT: transportation/pickup/transfer/how to travel
- SMALLTALK: greeting, thanks, acknowledgement, casual social reply
- PROGRAM_SELECTION: selects an item from recent_catalog
- PROGRAM_DETAIL: asks details/price of a program
- PROGRAM_MORE: asks for more items from the displayed catalog
- PROGRAM_SEARCH: asks about a specific service/treatment/symptom
- PROGRAM_DISCOVERY: browses programs/services in a place
- GENERAL_QUESTION: general WOS question
- UNKNOWN: unclear meaning

Priority:
RESET > HANDOFF > HOTEL > TRANSPORT > SMALLTALK > PROGRAM_SELECTION > PROGRAM_DETAIL > PROGRAM_MORE > PROGRAM_SEARCH > PROGRAM_DISCOVERY > GENERAL_QUESTION/UNKNOWN.

A clear higher-priority meaning must not be changed by catalog or journey context.

Province is only the place explicitly named in THIS message.
Never invent a province from earlier messages.
uses_context=true only when earlier context is required.

PROGRAM_SELECTION:
Use only when recent_catalog is non-empty and the customer clearly selects an item.
"first"/"second"/"last" refer to recent_catalog positions.
selection_index is zero-based.
Never guess an item.

PROGRAM_DETAIL:
If several catalog items exist and the customer asks "this one" without identifying an index, selection_index MUST be null.

PROGRAM_SEARCH:
A specific service/treatment/symptom is a search even without a province.
PROGRAM_DISCOVERY:
Browsing what programs exist in a province is discovery.

Return JSON only.`;

function buildUser(message: string, history: { role: string; content: string }[], catalog: CatalogItem[]): string {
  return JSON.stringify({
    message,
    recent_messages: history.slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 300) })),
    recent_catalog: catalog.map((c, i) => ({ index: i, title: c.title })),
  });
}

function langFor(message: string): Understanding['language'] {
  if (/[\u0e80-\u0eff]/.test(message) && /[\u0e00-\u0e7f]/.test(message)) return 'mixed';
  if (/[\u0e80-\u0eff]/.test(message)) return 'lo';
  if (/[\u0e00-\u0e7f]/.test(message)) return 'th';
  return 'en';
}

function makeUnderstanding(
  message: string,
  intent: Understanding['intent'],
  confidence = 0.99,
  entities: Partial<Understanding['entities']> = {},
  uses_context = false,
): Understanding {
  return {
    intent,
    confidence,
    entities: {
      province: entities.province ?? null,
      program_query: entities.program_query ?? null,
      selection_index: entities.selection_index ?? null,
      detail_field: entities.detail_field ?? null,
    },
    uses_context,
    language: langFor(message),
  };
}

function deterministicFallback(
  message: string,
  catalog: CatalogItem[],
): Understanding | null {
  const m = message.trim().toLowerCase();

  // ------------------------------------------------------------
  // Reset
  // ------------------------------------------------------------
  if (/^(?:\u0e40\u0e23\u0e34\u0e48\u0e21\u0e43\u0e2b\u0e21\u0e48|\u0e25\u0e49\u0e32\u0e07\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25|\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01)/.test(m)) {
    return makeUnderstanding(m, 'RESET');
  }

  // ------------------------------------------------------------
  // Hotel
  // ------------------------------------------------------------
  if (/(?:\u0e42\u0e23\u0e07\u0e41\u0e23\u0e21|\u0e17\u0e35\u0e48\u0e1e\u0e31\u0e01|\u0e17\u0e35\u0e48\u0e19\u0e2d\u0e19)/.test(m)) {
    return makeUnderstanding(m, 'HOTEL');
  }

  // ------------------------------------------------------------
  // Transport
  // ------------------------------------------------------------
  if (/(?:\u0e40\u0e14\u0e34\u0e19\u0e17\u0e32\u0e07|\u0e23\u0e16\u0e23\u0e31\u0e1a\u0e2a\u0e48\u0e07|\u0e23\u0e16\u0e23\u0e31\u0e1a|\u0e44\u0e1b\u0e22\u0e31\u0e07\u0e44\u0e07)/.test(m)) {
    return makeUnderstanding(m, 'TRANSPORT');
  }

  // ------------------------------------------------------------
  // Smalltalk
  // ------------------------------------------------------------
  if (/^(?:\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35|\u0e02\u0e2d\u0e1a\u0e04\u0e38\u0e13)[\s!?.]*$/i.test(m)) {
    return makeUnderstanding(m, 'SMALLTALK');
  }

  // ------------------------------------------------------------
  // Program discovery
  //
  // Examples:
  //   อดรมอะไรบาง
  //   โปรแกรมอดรมไร
  //   สนใจโปรแกรม
  // ------------------------------------------------------------
  if (
    /(?:\u0e2d\u0e38\u0e14\u0e23|\u0e2d\u0e38\u0e14\u0e23\u0e18\u0e32\u0e19\u0e35|\u0e2b\u0e19\u0e2d\u0e07\u0e04\u0e32\u0e22|\u0e02\u0e2d\u0e19\u0e41\u0e01\u0e48\u0e19).*(?:\u0e21\u0e35\u0e2d\u0e30\u0e44\u0e23|\u0e21\u0e35\u0e44\u0e23|\u0e21\u0e35\u0e2d\u0e30\u0e44\u0e23\u0e1a\u0e49\u0e32\u0e07|\u0e21\u0e35\u0e44\u0e23\u0e1a\u0e49\u0e32\u0e07)/.test(m) ||
    /\u0e42\u0e1b\u0e23\u0e41\u0e01\u0e23\u0e21.*(?:\u0e21\u0e35\u0e2d\u0e30\u0e44\u0e23|\u0e21\u0e35\u0e44\u0e23|\u0e21\u0e35\u0e2d\u0e30\u0e44\u0e23\u0e1a\u0e49\u0e32\u0e07|\u0e21\u0e35\u0e44\u0e23\u0e1a\u0e49\u0e32\u0e07)/.test(m) ||
    /(?:\u0e21\u0e35\u0e2d\u0e30\u0e44\u0e23|\u0e21\u0e35\u0e44\u0e23|\u0e21\u0e35\u0e2d\u0e30\u0e44\u0e23\u0e1a\u0e49\u0e32\u0e07|\u0e21\u0e35\u0e44\u0e23\u0e1a\u0e49\u0e32\u0e07).*\u0e42\u0e1b\u0e23\u0e41\u0e01\u0e23\u0e21/.test(m) ||
    /\u0e2a\u0e19\u0e43\u0e08\u0e42\u0e1b\u0e23\u0e41\u0e01\u0e23\u0e21/.test(m)
  ) {
    return makeUnderstanding(m, 'PROGRAM_DISCOVERY', 0.99, {
      program_query: null,
    });
  }

  // ------------------------------------------------------------
  // Program search by explicit service/province
  // ------------------------------------------------------------
  if (
    /(?:\u0e15\u0e23\u0e27\u0e08\u0e40\u0e02\u0e48\u0e32|\u0e1b\u0e27\u0e14\u0e40\u0e02\u0e48\u0e32|\u0e15\u0e23\u0e27\u0e08\u0e2a\u0e38\u0e02\u0e20\u0e32\u0e1e)/.test(m) &&
    /(?:\u0e2d\u0e38\u0e14\u0e23|\u0e2d\u0e38\u0e14\u0e23\u0e18\u0e32\u0e19\u0e35|\u0e2b\u0e19\u0e2d\u0e07\u0e04\u0e32\u0e22|\u0e02\u0e2d\u0e19\u0e41\u0e01\u0e48\u0e19|udon|nong\s*khai|khon\s*kaen)/.test(m)
  ) {
    return makeUnderstanding(m, 'PROGRAM_SEARCH', 0.99, {
      program_query: m,
    });
  }

  // ------------------------------------------------------------
  // "มโปรแกรมทจงหวดไหม" -> search
  // ------------------------------------------------------------
  if (
    /\u0e21\u0e35\u0e42\u0e1b\u0e23\u0e41\u0e01\u0e23\u0e21/.test(m) &&
    /\u0e44\u0e2b\u0e21/.test(m)
  ) {
    return makeUnderstanding(m, 'PROGRAM_SEARCH', 0.99, {
      program_query: null,
    });
  }

  // ------------------------------------------------------------
  // Hotel must win over catalog context.
  // Examples:
  //   แลวทพกละ
  //   มทพกไหม
  // ------------------------------------------------------------
  if (
    /(?:\u0e42\u0e23\u0e07\u0e41\u0e23\u0e21|\u0e17\u0e35\u0e48\u0e1e\u0e31\u0e01|\u0e17\u0e35\u0e48\u0e19\u0e2d\u0e19)/.test(m)
  ) {
    return makeUnderstanding(m, 'HOTEL');
  }

  // ------------------------------------------------------------
  // Current catalog: "มอกไหม" / "มอะไรอก"
  // ------------------------------------------------------------
  if (
    catalog.length > 0 &&
    /(?:\u0e21\u0e35\u0e2d\u0e35\u0e01|\u0e21\u0e35\u0e2d\u0e30\u0e44\u0e23\u0e2d\u0e35\u0e01|\u0e02\u0e2d\u0e2d\u0e35\u0e01|\u0e2d\u0e35\u0e01\u0e44\u0e2b\u0e21)/.test(m)
  ) {
    return makeUnderstanding(m, 'PROGRAM_MORE', 0.99, {
      program_query: null,
    }, true);
  }

  // ------------------------------------------------------------
  // Current catalog selection
  // ------------------------------------------------------------
  if (catalog.length > 0) {
    let index: number | null = null;

    if (
      /(?:\u0e2d\u0e31\u0e19|\u0e15\u0e31\u0e27|\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23)\s*(?:\u0e41\u0e23\u0e01|\u0e17\u0e35\u0e48\s*1|\u0e2b\u0e19\u0e36\u0e48\u0e07)/.test(m) ||
      /^1\b/.test(m)
    ) {
      index = 0;
    } else if (
      /(?:\u0e2d\u0e31\u0e19|\u0e15\u0e31\u0e27|\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23)\s*(?:\u0e17\u0e35\u0e48\s*2|\u0e2a\u0e2d\u0e07)/.test(m) ||
      /^2\b/.test(m)
    ) {
      index = 1;
    } else if (
      /(?:\u0e2d\u0e31\u0e19|\u0e15\u0e31\u0e27|\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23)\s*(?:\u0e17\u0e35\u0e48\s*3|\u0e2a\u0e32\u0e21)/.test(m) ||
      /^3\b/.test(m)
    ) {
      index = 2;
    } else if (
      /(?:\u0e2d\u0e31\u0e19|\u0e15\u0e31\u0e27|\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23)\s*(?:\u0e2b\u0e25\u0e31\u0e07|\u0e2a\u0e38\u0e14\u0e17\u0e49\u0e32\u0e22)/.test(m)
    ) {
      index = catalog.length - 1;
    }

    if (index != null) {
      return makeUnderstanding(
        m,
        'PROGRAM_SELECTION',
        0.99,
        { selection_index: index },
        true,
      );
    }

    // "ตวนราคา..." is ambiguous when multiple items exist.
    if (
      catalog.length > 1 &&
      /\u0e15\u0e31\u0e27\u0e19\u0e35\u0e49/.test(m) &&
      /(?:\u0e23\u0e32\u0e04\u0e32|\u0e40\u0e17\u0e48\u0e32\u0e44\u0e2b\u0e23\u0e48|\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14)/.test(m)
    ) {
      return makeUnderstanding(m, 'PROGRAM_DETAIL', 0.99, {
        selection_index: null,
        detail_field: /(?:\u0e23\u0e32\u0e04\u0e32|\u0e40\u0e17\u0e48\u0e32\u0e44\u0e2b\u0e23\u0e48)/.test(m)
          ? 'price'
          : 'other',
      }, true);
    }
  }

  return null;
}
function normalizeUnderstanding(
  u: Understanding,
  message: string,
  catalog: CatalogItem[],
): Understanding {
  const m = message.trim().toLowerCase();

  const has = (pattern: RegExp) => pattern.test(m);

  // ------------------------------------------------------------
  // Clear program discovery.
  // Keep discovery separate from service search.
  // ------------------------------------------------------------
  if (
    has(/\u0e2a\u0e19\u0e43\u0e08\u0e42\u0e1b\u0e23\u0e41\u0e01\u0e23\u0e21/) ||
    has(/\u0e42\u0e1b\u0e23\u0e41\u0e01\u0e23\u0e21.*(?:\u0e21\u0e35\u0e2d\u0e30\u0e44\u0e23|\u0e21\u0e35\u0e44\u0e23)/) ||
    has(/(?:\u0e21\u0e35\u0e2d\u0e30\u0e44\u0e23|\u0e21\u0e35\u0e44\u0e23).*\u0e42\u0e1b\u0e23\u0e41\u0e01\u0e23\u0e21/) ||
    has(/\u0e14\u0e39\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23/) ||
    has(/\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23.*(?:\u0e2d\u0e30\u0e44\u0e23|\u0e21\u0e35\u0e2d\u0e30\u0e44\u0e23|\u0e21\u0e35\u0e44\u0e23)/) ||
    has(/program.*(?:\u0e2d\u0e30\u0e44\u0e23|\u0e21\u0e35\u0e2d\u0e30\u0e44\u0e23|\u0e21\u0e35\u0e44\u0e23)/)
  ) {
    return {
      ...u,
      intent: 'PROGRAM_DISCOVERY',
      confidence: 0.98,
      entities: {
        ...u.entities,
        program_query: null,
      },
    };
  }

  // "สนใจโปรแกรม" with no province -> discovery.
  if (
    has(/\u0e2a\u0e19\u0e43\u0e08\u0e42\u0e1b\u0e23\u0e41\u0e01\u0e23\u0e21/) &&
    !u.entities.province
  ) {
    return {
      ...u,
      intent: 'PROGRAM_DISCOVERY',
      confidence: 0.98,
      entities: {
        ...u.entities,
        program_query: null,
      },
    };
  }

  // ------------------------------------------------------------
  // Province + "มอะไร/มไรบาง" is discovery, not service search.
  // Example: "อดรมอะไรบาง"
  // ------------------------------------------------------------
  if (
    has(/(?:\u0e2d\u0e38\u0e14\u0e23|\u0e2d\u0e38\u0e14\u0e23\u0e18\u0e32\u0e19\u0e35|\u0e2b\u0e19\u0e2d\u0e07\u0e04\u0e32\u0e22|\u0e02\u0e2d\u0e19\u0e41\u0e01\u0e48\u0e19|udon|nong\s*khai|khon\s*kaen)/) &&
    has(/(?:\u0e21\u0e35\u0e2d\u0e30\u0e44\u0e23|\u0e21\u0e35\u0e44\u0e23)(?:\u0e1a\u0e49\u0e32\u0e07)?/)
  ) {
    return {
      ...u,
      intent: 'PROGRAM_DISCOVERY',
      confidence: 0.99,
      entities: {
        ...u.entities,
        program_query: null,
      },
    };
  }

  // ------------------------------------------------------------
  // Specific service + province -> PROGRAM_SEARCH.
  // ------------------------------------------------------------
  if (
    has(/(?:\u0e15\u0e23\u0e27\u0e08\u0e40\u0e02\u0e48\u0e32|\u0e1b\u0e27\u0e14\u0e40\u0e02\u0e48\u0e32|\u0e15\u0e23\u0e27\u0e08\u0e2a\u0e38\u0e02\u0e20\u0e32\u0e1e|\u0e23\u0e31\u0e01\u0e29\u0e32)/) &&
    has(/(?:\u0e2d\u0e38\u0e14\u0e23|\u0e2d\u0e38\u0e14\u0e23\u0e18\u0e32\u0e19\u0e35|\u0e2b\u0e19\u0e2d\u0e07\u0e04\u0e32\u0e22|\u0e02\u0e2d\u0e19\u0e41\u0e01\u0e48\u0e19|udon|nong\s*khai|khon\s*kaen)/)
  ) {
    return {
      ...u,
      intent: 'PROGRAM_SEARCH',
      confidence: 0.98,
      entities: {
        ...u.entities,
        program_query: u.entities.program_query || message.trim(),
      },
    };
  }

  // ------------------------------------------------------------
  // "มโปรแกรมท [province] ไหม" is SEARCH, not DISCOVERY.
  // This matters for coverage tests such as ขอนแกน.
  // ------------------------------------------------------------
  if (
    has(/\u0e21\u0e35\u0e42\u0e1b\u0e23\u0e41\u0e01\u0e23\u0e21/) &&
    has(/\u0e44\u0e2b\u0e21/) &&
    u.entities.province
  ) {
    return {
      ...u,
      intent: 'PROGRAM_SEARCH',
      confidence: 0.98,
      entities: {
        ...u.entities,
        program_query: u.entities.program_query || null,
      },
    };
  }

  // ------------------------------------------------------------
  // Detail request with explicit first/second item.
  // ------------------------------------------------------------
  if (
    catalog.length > 0 &&
    has(/(?:\u0e15\u0e31\u0e27|\u0e2d\u0e31\u0e19|\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23).*(?:\u0e41\u0e23\u0e01|\u0e17\u0e35\u0e48\u0e2b\u0e19\u0e36\u0e48\u0e07|\u0e2b\u0e19\u0e36\u0e48\u0e07).*?(?:\u0e23\u0e32\u0e04\u0e32|\u0e40\u0e17\u0e48\u0e32\u0e44\u0e2b\u0e23\u0e48|\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14|\u0e08\u0e2d\u0e07|\u0e2a\u0e21\u0e31\u0e04\u0e23)/)
  ) {
    return {
      ...u,
      intent: 'PROGRAM_DETAIL',
      confidence: 0.98,
      entities: {
        ...u.entities,
        selection_index: 0,
        detail_field: has(/(?:\u0e23\u0e32\u0e04\u0e32|\u0e40\u0e17\u0e48\u0e32\u0e44\u0e2b\u0e23\u0e48)/)
          ? 'price'
          : (u.entities.detail_field ?? 'other'),
      },
    };
  }

  if (
    catalog.length > 1 &&
    has(/(?:\u0e15\u0e31\u0e27|\u0e2d\u0e31\u0e19|\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23).*(?:\u0e2a\u0e2d\u0e07|\u0e17\u0e35\u0e48\u0e2a\u0e2d\u0e07).*?(?:\u0e23\u0e32\u0e04\u0e32|\u0e40\u0e17\u0e48\u0e32\u0e44\u0e2b\u0e23\u0e48|\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14|\u0e08\u0e2d\u0e07|\u0e2a\u0e21\u0e31\u0e04\u0e23)/)
  ) {
    return {
      ...u,
      intent: 'PROGRAM_DETAIL',
      confidence: 0.98,
      entities: {
        ...u.entities,
        selection_index: 1,
        detail_field: has(/(?:\u0e23\u0e32\u0e04\u0e32|\u0e40\u0e17\u0e48\u0e32\u0e44\u0e2b\u0e23\u0e48)/)
          ? 'price'
          : (u.entities.detail_field ?? 'other'),
      },
    };
  }

  // ------------------------------------------------------------
  // "ตวนราคา..." with multiple items is ambiguous.
  // Do NOT select the first item automatically.
  // ------------------------------------------------------------
  if (
    catalog.length > 1 &&
    has(/\u0e15\u0e31\u0e27\u0e19\u0e35\u0e49/) &&
    has(/(?:\u0e23\u0e32\u0e04\u0e32|\u0e40\u0e17\u0e48\u0e32\u0e44\u0e2b\u0e23\u0e48|\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14|\u0e08\u0e2d\u0e07|\u0e2a\u0e21\u0e31\u0e04\u0e23)/)
  ) {
    return {
      ...u,
      intent: 'PROGRAM_DETAIL',
      confidence: 0.98,
      entities: {
        ...u.entities,
        selection_index: null,
        detail_field: has(/(?:\u0e23\u0e32\u0e04\u0e32|\u0e40\u0e17\u0e48\u0e32\u0e44\u0e2b\u0e23\u0e48)/)
          ? 'price'
          : (u.entities.detail_field ?? 'other'),
      },
    };
  }

  // ------------------------------------------------------------
  // "อนหลงครบ" / "ตวหลง" -> last catalog item.
  // ------------------------------------------------------------
  if (
    catalog.length > 0 &&
    has(/(?:\u0e2d\u0e31\u0e19\u0e2b\u0e25\u0e31\u0e07|\u0e15\u0e31\u0e27\u0e2b\u0e25\u0e31\u0e07|\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e2b\u0e25\u0e31\u0e07|\u0e2d\u0e31\u0e19\u0e2a\u0e38\u0e14\u0e17\u0e49\u0e32\u0e22|\u0e15\u0e31\u0e27\u0e2a\u0e38\u0e14\u0e17\u0e49\u0e32\u0e22)/)
  ) {
    return {
      ...u,
      intent: 'PROGRAM_SELECTION',
      confidence: 0.98,
      entities: {
        ...u.entities,
        selection_index: catalog.length - 1,
        detail_field: null,
      },
    };
  }

  return u;
}
export async function understand(
  llm: LlmJson,
  message: string,
  history: { role: string; content: string }[],
  catalog: CatalogItem[],
  timeoutMs = 6000,
): Promise<{ understanding: Understanding | null; error?: string }> {
  const user = buildUser(message, history, catalog);
  let lastError = 'invalid_output';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await llm({ system: UNDERSTAND_SYSTEM, user, timeoutMs });
      const parsed = parseUnderstanding(extractJson(text));

      if (parsed) {
        const normalized = normalizeUnderstanding(parsed, message, catalog);
        return { understanding: normalized };
      }

      const fallback = deterministicFallback(message, catalog);
      if (fallback) return { understanding: fallback };

      lastError = 'invalid_output';
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 120) : 'llm_error';
      if (/timeout|timed out|abort/i.test(lastError)) break;
    }
  }

  const fallback = deterministicFallback(message, catalog);
  if (fallback) return { understanding: fallback };

  return { understanding: null, error: lastError };
}
