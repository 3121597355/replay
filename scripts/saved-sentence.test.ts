import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { learningStore, type LearningSession } from '../lib/learning-session';
import { resolveSavedSentenceTranslation, sentenceTranslationFromCues, sentenceTranslationFromSession, storedSentenceTranslation } from '../lib/saved-sentence';
import { loadSavedWords, persistSavedWords } from '../lib/saved-words';
import type { SavedWord } from '../lib/types';
const word: SavedWord = { word: 'consider', sentence: 'Please consider it.', translation: 'v. 考虑', addedAt: 1 };
const session: LearningSession = { id: 'original', videoName: 'film.mp4', source: { kind: 'file', name: 'film.mp4', size: 12, type: 'video/mp4', lastModified: 1234 }, cues: [{ id: 10, text: word.sentence, native: '请考虑一下。', start: 1, end: 3 }], hash: 'hash1', time: 0, selected: 0, rate: 1, loop: false, showTrans: true, updatedAt: 1 };
const located: SavedWord = { ...word, clip: { videoId: 'original', videoName: session.videoName, start: 1, end: 3, source: session.source as Extract<LearningSession['source'], { kind: 'file' }> } };
beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => entries.get(key) || null, setItem: (key: string, value: string) => entries.set(key, value) }, configurable: true });
});
test('dictionary meaning is never a sentence translation; old whole-sentence cards remain supported', () => {
  assert.equal(storedSentenceTranslation(word), '');
  assert.equal(storedSentenceTranslation({ ...word, sentenceTranslation: '请考虑一下。' }), '请考虑一下。');
  assert.equal(storedSentenceTranslation({ ...word, word: word.sentence, translation: '请考虑一下。' }), '请考虑一下。');
  const long = 'This is a long subtitle line whose length exceeds the sixty character collection label limit.';
  assert.equal(storedSentenceTranslation({ ...word, word: long.slice(0, 60), sentence: long, translation: '长句译文' }), '长句译文');
});
test('old word cards recover full native dialogue without modifying dictionary definitions', () => {
  assert.equal(sentenceTranslationFromSession(located, session, 'local'), '请考虑一下。');
  assert.equal(sentenceTranslationFromSession(word, session, 'local'), '请考虑一下。');
  assert.equal(word.translation, 'v. 考虑');
  assert.equal(sentenceTranslationFromSession(located, { ...session, source: { ...session.source, kind: 'file', name: 'other.mp4' } as LearningSession['source'] }, 'local'), '');
  assert.equal(sentenceTranslationFromCues(located, [{ ...session.cues[0], start: 20, end: 22 }]), '');
  assert.equal(sentenceTranslationFromCues(word, [...session.cues, { ...session.cues[0], id: 11, start: 20, end: 22 }]), '');
  assert.equal(sentenceTranslationFromCues(located, [...session.cues, { ...session.cues[0], id: 11, start: 20, end: 22 }]), '请考虑一下。');
});
test('translation cache reads the captured account, not another active account or word definition', () => {
  const untranslated = { ...session, cues: [{ ...session.cues[0], native: undefined }] };
  localStorage.setItem('replay.trans.alice.hash1', JSON.stringify({ v: 1, items: [[10, '甲账号整句译文']] }));
  localStorage.setItem('replay.trans.bob.hash1', JSON.stringify({ v: 1, items: [[10, '乙账号整句译文']] }));
  assert.equal(sentenceTranslationFromSession(located, untranslated, 'alice'), '甲账号整句译文');
  assert.equal(sentenceTranslationFromSession(located, untranslated, 'bob'), '乙账号整句译文');
  assert.equal(sentenceTranslationFromSession(located, untranslated, 'local'), '');
});
test('the actual packaged sample restores the screenshot sentence with matching original times', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => { assert.equal(String(url), '/sample/manchester-repair-v2.srt'); return new Response(readFileSync(new URL('../public/sample/manchester-repair-v2.srt', import.meta.url), 'utf8')); };
  try {
    const sampleWord: SavedWord = { ...word, sentence: 'Or you might want to consider replacing the whole apparatus.', clip: { videoId: 'sample', videoName: 'sample', start: 18.953, end: 21.722, source: { kind: 'sample', video: '/sample/manchester-repair-v2.mp4' } } };
    assert.equal(await resolveSavedSentenceTranslation(sampleWord, 'sample-fixture'), '或者你也可以考虑把整套装置换掉。');
    assert.equal(sampleWord.translation, 'v. 考虑');
  } finally { globalThis.fetch = oldFetch; }
});
test('resolving and persisting preserves clip, word definition and collection date across reload', async () => {
  await learningStore('sentence-fixture').saveLearningSession(session);
  const sentenceTranslation = await resolveSavedSentenceTranslation(located, 'sentence-fixture');
  persistSavedWords([{ ...located, sentenceTranslation }], 'sentence-fixture');
  assert.deepEqual(loadSavedWords('sentence-fixture'), [{ ...located, sentenceTranslation: '请考虑一下。' }]);
  assert.deepEqual(loadSavedWords('other-owner'), []);
});
