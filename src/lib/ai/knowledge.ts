export type KnowledgeResult = {
  title: string;
  content: string;
  source: string;
  tags?: string[];
};

const WOS_KNOWLEDGE: KnowledgeResult[] = [
  {
    title: 'WOS คออะไร',
    content:
      'WOS (Wellness Operating System) คอ ThailandLaos Cross-Border Wellness Gateway ทเชอมลกคาจากลาวกบผใหบรการดาน healthcare, wellness, hotel, transport และบรการทเกยวของในประเทศไทย',
    source: 'wos-ai-knowledge',
    tags: ['wos', 'company', 'laos', 'thailand'],
  },
  {
    title: 'WOS สำหรบลกคาจากลาว',
    content:
      'WOS ชวยลกคาจากลาววางแผนการเดนทางดานสขภาพ เลอกบรการจากผใหบรการทผานการคดเลอกในประเทศไทย และประสานงานการเดนทางและการดแลทเกยวของ',
    source: 'wos-ai-knowledge',
    tags: ['laos', 'customer-journey', 'cross-border'],
  },
];

export function searchWosKnowledge(query: string): KnowledgeResult[] {
  const normalizedQuery = query.toLowerCase();

  return WOS_KNOWLEDGE.filter((item) => {
    const haystack = [
      item.title,
      item.content,
      ...(item.tags ?? []),
    ]
      .join(' ')
      .toLowerCase();

    return normalizedQuery
      .split(/\s+/)
      .some((word) => word.length > 1 && haystack.includes(word));
  });
}
