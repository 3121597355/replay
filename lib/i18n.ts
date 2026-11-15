import english from './locales/en.json';

export type Language = 'zh' | 'en';
export const LANGUAGE_KEY = 'replay-language';
const messages: Record<string, string> = english;
const patterns = Object.entries(messages).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => {
  const slots: number[] = [];
  const parts = key.split(/\{(\d+)\}/);
  const pattern = parts.map((part, index) => index % 2 ? (slots.push(Number(part)), '(.+?)') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return { expression: new RegExp(`^${pattern}$`), value, slots };
});

/** Translate interface copy only; never pass imported subtitles or user content. */
export function translate(language: Language, source: string, ...values: (string | number)[]): string {
  let template = language === 'en' ? messages[source] ?? source : source;
  // Stored interface notices may already contain counts or API details.
  // Only known message templates match; imported media content never enters here.
  if (language === 'en' && template === source && !values.length) {
    for (const pattern of patterns) {
      const match = pattern.expression.exec(source);
      if (!match) continue;
      template = pattern.value;
      pattern.slots.forEach((slot, index) => { values[slot] = match[index + 1]; });
      break;
    }
  }
  return template.replace(/\{(\d+)\}/g, (match, index) => values[Number(index)] === undefined ? match : String(values[Number(index)]));
}

export function preferredLanguage(saved: string | null, browserLanguages: readonly string[]): Language {
  if (saved === 'zh' || saved === 'en') return saved;
  return browserLanguages[0]?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
