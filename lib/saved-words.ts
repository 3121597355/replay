import type { SavedWord } from './types';
import { storageKey } from './account-storage';

const KEY = 'replay.saved';

/** Storage can be unavailable in mobile webviews and private browsing. */
export function loadSavedWords(): SavedWord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(KEY)) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedWord =>
      item !== null && typeof item === 'object' &&
      typeof item.word === 'string' && typeof item.sentence === 'string' &&
      typeof item.translation === 'string' && typeof item.addedAt === 'number'
    );
  } catch {
    return [];
  }
}

export function persistSavedWords(words: SavedWord[]): boolean {
  try {
    localStorage.setItem(storageKey(KEY), JSON.stringify(words));
    return true;
  } catch {
    return false;
  }
}
