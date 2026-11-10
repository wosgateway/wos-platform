export type WosLanguage = 'th' | 'lo' | 'en';

export interface WosLanguageProfile {
  language: WosLanguage;
  isMixedThaiLao: boolean;
  hasThai: boolean;
  hasLao: boolean;
  source: 'current' | 'history' | 'default';
}

type ScriptCounts = { thai: number; lao: number; latin: number };

function countScripts(value: string): ScriptCounts {
  return {
    thai: (value.match(/[\u0E00-\u0E7F]/g) ?? []).length,
    lao: (value.match(/[\u0E80-\u0EFF]/g) ?? []).length,
    latin: (value.match(/[A-Za-z]/g) ?? []).length,
  };
}

function profileFromText(value: string, source: 'current' | 'history'): WosLanguageProfile | null {
  const counts = countScripts(value);
  const hasThai = counts.thai > 0;
  const hasLao = counts.lao > 0;

  if (hasThai && hasLao) {
    const language: WosLanguage = counts.lao > counts.thai ? 'lo' : 'th';
    return { language, isMixedThaiLao: true, hasThai, hasLao, source };
  }
  if (hasThai) return { language: 'th', isMixedThaiLao: false, hasThai, hasLao, source };
  if (hasLao) return { language: 'lo', isMixedThaiLao: false, hasThai, hasLao, source };
  if (counts.latin > 0) return { language: 'en', isMixedThaiLao: false, hasThai, hasLao, source };
  return null;
}

/**
 * Resolve the customer's language from the current message first. Short replies
 * (numbers, names, acknowledgements without script markers) inherit the latest
 * meaningful customer language. Thai+Lao messages retain a mixed-script flag
 * so the response layer can preserve code-switching instead of flattening it.
 */
export function resolveWosLanguageProfile(
  message: string,
  history: string[] = [],
): WosLanguageProfile {
  const current = profileFromText(message.trim(), 'current');
  if (current) return current;

  for (const item of [...history].reverse()) {
    const inherited = profileFromText(item, 'history');
    if (inherited) return inherited;
  }

  return {
    language: 'th',
    isMixedThaiLao: false,
    hasThai: false,
    hasLao: false,
    source: 'default',
  };
}
