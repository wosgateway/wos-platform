import { searchPrograms } from '@/lib/ai/programs';

export async function searchCatalog(query: string, limit = 10) {
  return searchPrograms(query, limit);
}
