import type { SavedWord } from './types';
import { getStorageOwner } from './account-storage';
import { validSavedClip } from './saved-line';

const KEY = 'replay.saved';

/** Storage can be unavailable in mobile webviews and private browsing. */
export function loadSavedWords(owner = getStorageOwner()): SavedWord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(owner === 'local' ? KEY : `${KEY}.${owner}`) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedWord =>
      item !== null && typeof item === 'object' &&
      typeof item.word === 'string' && typeof item.sentence === 'string' &&
      typeof item.translation === 'string' && typeof item.addedAt === 'number'
    ).map(item => { const clean = { ...item }; if (clean.clip && !validSavedClip(clean.clip)) delete clean.clip; if (typeof clean.sentenceTranslation !== 'string') delete clean.sentenceTranslation; return clean; });
  } catch {
    return [];
  }
}

export function persistSavedWords(words: SavedWord[], owner = getStorageOwner()): boolean {
  try {
    localStorage.setItem(owner === 'local' ? KEY : `${KEY}.${owner}`, JSON.stringify(words));
    return true;
  } catch {
    return false;
  }
}
