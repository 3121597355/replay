import type { Cue, SavedWord } from './types';
import { learningStore, type LearningSession } from './learning-session';
import { validSavedClip } from './saved-line';
import { readCache } from './transcache';
import { parseSrt } from './srt';
import { fetchTextWithTimeout } from './browser';
import sample from '@/public/sample/manchester-repair-v2.json';

const text = (value?: string) => typeof value === 'string' ? value.trim() : '';
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
export const isSentenceCollection = (word: SavedWord) => !!word.sentence && word.word === word.sentence.slice(0, 60);
export function storedSentenceTranslation(word: SavedWord): string {
  return text(word.sentenceTranslation) || (isSentenceCollection(word) ? text(word.translation) : '');
}
export function savedSentenceAnswerLabel(word: SavedWord): string {
  return `${word.sentence || word.word}。原句译文：${storedSentenceTranslation(word) || '尚未保存'}${isSentenceCollection(word) ? '' : `。单词释义：${word.translation || '尚未保存'}`}`;
}
export function sentenceTranslationFromCues(word: SavedWord, cues: Cue[]): string {
  const matches = cues.filter(cue => normalize(cue.text) === normalize(word.sentence)
    && (!validSavedClip(word.clip) || (Math.abs(cue.start - word.clip.start) < .05 && Math.abs(cue.end - word.clip.end) < .05)));
  return matches.length === 1 ? text(matches[0].translation) || text(matches[0].native) : '';
}
export function sentenceTranslationFromSession(word: SavedWord, session: LearningSession | null, owner: string): string {
  if (!session || !word.sentence.trim()) return '';
  if (validSavedClip(word.clip)) {
    const source = word.clip.source, current = session.source;
    if (source.kind !== current.kind) return '';
    if (source.kind === 'file' && (current.kind !== 'file' || source.name !== current.name || source.size !== current.size || source.lastModified !== current.lastModified)) return '';
  }
  const cache = session.hash ? readCache(session.hash, owner) : null;
  const items = new Map<number, string>((cache?.items || []).filter(item => Array.isArray(item) && typeof item[0] === 'number' && typeof item[1] === 'string'));
  return sentenceTranslationFromCues(word, session.cues.map(cue => ({ ...cue, translation: text(cue.translation) || items.get(cue.id) })));
}
let sampleCues: Promise<Cue[]> | undefined;
export async function resolveSavedSentenceTranslation(word: SavedWord, owner: string): Promise<string> {
  const stored = storedSentenceTranslation(word); if (stored) return stored;
  if (validSavedClip(word.clip) && word.clip.source.kind === 'sample') {
    if (!sampleCues) sampleCues = fetchTextWithTimeout(sample.subtitle, undefined, 10000).then(parseSrt).catch(error => { sampleCues = undefined; throw error; });
    const translated = sentenceTranslationFromCues(word, await sampleCues); if (translated) return translated;
  }
  const latest = await learningStore(owner).loadLearningSession().catch(() => null);
  return sentenceTranslationFromSession(word, latest?.session || null, owner);
}
