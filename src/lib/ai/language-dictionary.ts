import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveWosLanguageProfile, type WosLanguage } from './language-routing';

const gunzipAsync = promisify(gunzip);
type Dictionary = Record<string, string>;
type DictName = 'lao2eng' | 'eng2lao' | 'thai2eng' | 'eng2thai';
const cache = new Map<DictName, Promise<Dictionary>>();

export type { WosLanguage } from './language-routing';

export function detectWosLanguage(text: string, history: string[] = []): WosLanguage {
  return resolveWosLanguageProfile(text, history).language;
}

async function loadDictionary(name: DictName): Promise<Dictionary> {
  const existing = cache.get(name);
  if (existing) return existing;
  const task = (async () => {
    const file = path.join(process.cwd(), 'public', 'ai-dictionaries', name + '.json.gz');
    const compressed = await readFile(file);
    const json = await gunzipAsync(compressed);
    return JSON.parse(json.toString('utf8')) as Dictionary;
  })();
  cache.set(name, task);
  return task;
}

function normalizeTerm(value: string): string {
  return value.trim().toLocaleLowerCase();
}

async function findHints(text: string, dict: Dictionary, max = 8): Promise<string[]> {
  const normalized = normalizeTerm(text);
  if (!normalized) return [];
  return Object.keys(dict)
    .filter((key) => key.length >= 2 && normalized.includes(normalizeTerm(key)))
    .sort((a, b) => b.length - a.length)
    .slice(0, max)
    .map((key) => key + ' = ' + dict[key]);
}

export async function getLanguageDictionaryHints(text: string, language: WosLanguage): Promise<string> {
  try {
    const names: DictName[] = language === 'lo'
      ? ['lao2eng', 'eng2lao']
      : language === 'th'
        ? ['thai2eng', 'eng2thai']
        : ['eng2lao', 'eng2thai'];
    const dictionaries = await Promise.all(names.map(loadDictionary));
    const hints = (await findHints(text, dictionaries[0], 6))
      .concat(await findHints(text, dictionaries[1], 4));
    return hints.length > 0 ? hints.slice(0, 8).join('\\n') : 'No exact dictionary entries matched the customer wording.';
  } catch (error) {
    console.warn('[WOS_LANGUAGE_DICTIONARY_UNAVAILABLE]', error instanceof Error ? error.message : String(error));
    return 'Dictionary reference unavailable; follow the language rules and verified WOS knowledge.';
  }
}

export function languageName(language: WosLanguage): string {
  return language === 'lo' ? 'Lao' : language === 'th' ? 'Thai' : 'English';
}
