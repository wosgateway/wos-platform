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

export async function searchWosNotionKnowledge(
  query: string
): Promise<NotionKnowledgeItem[]> {
  const response = await notion.search({
    query,
    page_size: 100,
    filter: {
      property: 'object',
      value: 'page',
    },
  });

  const items: NotionKnowledgeItem[] = [];

  for (const rawPage of response.results) {
    const page = rawPage;

    const title =
      'properties' in page &&
      page.properties &&
      'title' in page.properties &&
      page.properties.title &&
      'title' in page.properties.title &&
      Array.isArray(page.properties.title.title)
        ? page.properties.title.title[0]?.plain_text ?? ''
        : '';

    const content = await getPageContent(page.id);

    if (!content) {
      continue;
    }

    if (!content.includes('Customer-facing AI knowledge')) {
      continue;
    }

    items.push({
      title,
      content,
      source: 'notion-ai-article',
      pageId: page.id,
    });
  }

  return items;
}
