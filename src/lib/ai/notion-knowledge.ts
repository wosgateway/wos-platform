import { notion } from './notion';

export type NotionKnowledgeItem = {
  title: string;
  content: string;
  source: string;
  pageId: string;
};

type RichTextItem = {
  plain_text?: string;
};

type NotionBlock = {
  type?: string;
  [key: string]: unknown;
};

function getPlainText(richText: RichTextItem[] = []) {
  return richText.map((item) => item.plain_text ?? '').join('');
}

async function getPageContent(pageId: string) {
  const results: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    results.push(...(response.results as unknown as NotionBlock[]));

    cursor = response.has_more
      ? response.next_cursor ?? undefined
      : undefined;
  } while (cursor);

  return results
    .map((block) => {
      const type = block.type;

      if (!type) {
        return '';
      }

      const data = block[type];

      if (
        typeof data === 'object' &&
        data !== null &&
        'rich_text' in data
      ) {
        const richText = (data as { rich_text?: RichTextItem[] }).rich_text;

        if (richText) {
          return getPlainText(richText).trim();
        }
      }

      if (
        typeof data === 'object' &&
        data !== null &&
        'caption' in data
      ) {
        const caption = (data as { caption?: RichTextItem[] }).caption;

        if (caption) {
          return getPlainText(caption).trim();
        }
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

// Notion's search endpoint matches page TITLES, not page content, so passing
// the customer's sentence as the query returned almost nothing. All customer-
// facing articles are titled "AI Article — ...", so we load that set once and
// cache it instead of searching per message.
const ARTICLE_QUERY = 'AI Article';
const CUSTOMER_FACING_MARKER = 'Customer-facing AI knowledge';
const CACHE_TTL_MS = 5 * 60_000;
const FETCH_CONCURRENCY = 3; // Notion allows ~3 requests/second

let cache: { at: number; items: NotionKnowledgeItem[] } | null = null;

function getPageTitle(page: unknown): string {
  const p = page as {
    properties?: Record<string, { type?: string; title?: RichTextItem[] }>;
  };
  if (!p.properties) return '';
  const titleProp = Object.values(p.properties).find((v) => v?.type === 'title');
  return titleProp?.title?.[0]?.plain_text ?? '';
}

async function loadArticles(): Promise<NotionKnowledgeItem[]> {
  const response = await notion.search({
    query: ARTICLE_QUERY,
    page_size: 100,
    filter: { property: 'object', value: 'page' },
  });

  const pages = response.results;
  const items: NotionKnowledgeItem[] = [];

  for (let i = 0; i < pages.length; i += FETCH_CONCURRENCY) {
    const chunk = pages.slice(i, i + FETCH_CONCURRENCY);

    const loaded = await Promise.all(
      chunk.map(async (page): Promise<NotionKnowledgeItem | null> => {
        const content = await getPageContent(page.id);

        // Only pages explicitly marked as customer-facing may reach the model.
        if (!content || !content.includes(CUSTOMER_FACING_MARKER)) {
          return null;
        }

        return {
          title: getPageTitle(page),
          content,
          source: 'notion-ai-article',
          pageId: page.id,
        };
      })
    );

    for (const item of loaded) {
      if (item) items.push(item);
    }
  }

  return items;
}

export async function searchWosNotionKnowledge(
  // Kept for API compatibility with core.ts; all articles are loaded and cached.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _query: string
): Promise<NotionKnowledgeItem[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.items;
  }

  try {
    const items = await loadArticles();
    cache = { at: Date.now(), items };
    return items;
  } catch (error) {
    // Knowledge is an enhancement: if Notion is down or misconfigured, keep
    // serving the last good copy, or answer without knowledge, instead of
    // failing the whole request with a 500.
    console.error(
      '[WOS_NOTION_ERROR]',
      error instanceof Error ? error.message : String(error)
    );
    return cache?.items ?? [];
  }
}
