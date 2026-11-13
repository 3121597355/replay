import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createLearningSessionStore, type LearningSession } from '../lib/learning-session';
import { createSavedMediaStore } from '../lib/saved-media';
import { legacySavedClip, savedClipFor, sameSavedVideo, validSavedClip } from '../lib/saved-line';
import { loadSavedWords, persistSavedWords } from '../lib/saved-words';
import { setStorageOwner } from '../lib/account-storage';
import { isAudioSource } from '../lib/media';
import { kindOf, pairEpisodes } from '../lib/pairing';
import type { SavedWord } from '../lib/types';

const word: SavedWord = { word: 'consider', sentence: 'Please consider it.', translation: '请考虑一下。', addedAt: 1 };
const file = (name = 'original.mp4', bytes = 'original media') => new File([bytes], name, { type: name.endsWith('.wav') ? 'audio/wav' : 'video/mp4', lastModified: 1234 });
function session(media: File, id = 'original'): LearningSession {
  return { id, source: createLearningSessionStore().fileLearningSource(media), videoName: media.name, cues: [{ id: 0, start: 1, end: 3, text: word.sentence }], hash: null, time: 0, selected: 0, rate: 1, loop: false, showTrans: true, updatedAt: 1 };
}
function clip(media = file()) { const data = session(media); return savedClipFor(data.cues[0], data.id, data.videoName, data.source)!; }
beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
  if (typeof navigator === 'undefined') Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  Object.defineProperty(navigator, 'storage', { value: { estimate: async () => ({ quota: 1e9, usage: 0 }) }, configurable: true });
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) }, configurable: true });
  setStorageOwner('local');
});

test('legacy exact text may recover one cue, but never guesses between repeated dialogue', () => {
  const data = session(file());
  assert.equal(legacySavedClip({ ...word, sentence: ' Please  consider it. ' }, data)?.start, 1);
  assert.equal(legacySavedClip(word, { ...data, cues: [...data.cues, { ...data.cues[0], id: 1, start: 10, end: 12 }] }), undefined);
  assert.equal(legacySavedClip({ ...word, sentence: 'Other film.' }, data), undefined);
  assert.equal(legacySavedClip(word, null), undefined);
  assert.deepEqual(legacySavedClip({ ...word, clip: clip() }, null), clip());
});
test('untrusted origins and invalid ranges are rejected; local file must match metadata', () => {
  const original = clip(); assert.ok(validSavedClip(original));
  for (const changed of [{ start: -1 }, { end: NaN }, { end: .5 }, { end: 305 }, { videoId: '../foreign' }, { source: { kind: 'sample', video: 'https://tracking.example/video.mp4' } }, { source: { ...original.source, size: 0 } }]) assert.equal(validSavedClip({ ...original, ...changed }), false);
  assert.ok(sameSavedVideo(original, file())); assert.equal(sameSavedVideo(original, file('other.mp4')), false);
  assert.equal(sameSavedVideo(original, new File(['original media'], 'original.mp4', { lastModified: 999 })), false);
});
test('a saved video survives learning material replacement and reload, with owner isolation', async () => {
  const media = file(), original = clip(media), store = createSavedMediaStore('alice'), learning = createLearningSessionStore('alice');
  assert.ok(await store.save(original, media));
  await learning.saveLearningSession(session(media), media);
  const other = file('new.mp4', 'new video'); await learning.saveLearningSession(session(other, 'new'), other);
  assert.equal(await (await createSavedMediaStore('alice').read(original))?.text(), 'original media');
  assert.equal(await createSavedMediaStore('bob').read(original), undefined);
  assert.equal((await createLearningSessionStore('alice').loadLearningSession())?.video?.name, 'new.mp4');
});
test('queued save/delete/save remains playable after refresh; final delete cannot revive cache', async () => {
  const media = file(), original = clip(media), store = createSavedMediaStore();
  await Promise.all([store.save(original, media), store.remove(original.videoId), store.save(original, media)]);
  assert.equal(await (await createSavedMediaStore().read(original))?.text(), 'original media');
  const reading = store.read(original); const removing = store.remove(original.videoId); await reading; await removing;
  assert.equal(await store.read(original), undefined); assert.equal(await createSavedMediaStore().read(original), undefined);
});
test('quota failure keeps page memory, permits retry, and refuses different source metadata', async () => {
  const media = file(), original = clip(media), store = createSavedMediaStore();
  Object.defineProperty(navigator, 'storage', { value: { estimate: async () => ({ quota: 5, usage: 0 }) }, configurable: true });
  assert.equal(await store.save(original, media), false); assert.equal(await store.read(original), media);
  assert.equal(await createSavedMediaStore().read(original), undefined);
  Object.defineProperty(navigator, 'storage', { value: { estimate: async () => { throw Error('optional API unavailable'); } }, configurable: true });
  assert.equal(await store.save(original, media), true);
  const changed = { ...original, source: { ...original.source, name: 'other.mp4' } };
  assert.equal(await createSavedMediaStore().read(changed), undefined);
});
test('saved words preserve legacy fields and asynchronous linking writes to captured owner', () => {
  persistSavedWords([word], 'alice'); persistSavedWords([{ ...word, word: 'bob' }], 'bob'); setStorageOwner('bob');
  const captured = loadSavedWords('alice'); captured[0] = { ...captured[0], clip: clip() }; persistSavedWords(captured, 'alice');
  assert.equal(loadSavedWords()[0].word, 'bob'); assert.ok(loadSavedWords('alice')[0].clip);
  persistSavedWords([{ ...word, clip: { ...clip(), end: -1 } }], 'alice');
  assert.deepEqual(loadSavedWords('alice'), [word]);
});
test('podcast import classification, folder pairing and audio persistence use real media bytes', async () => {
  for (const name of ['lesson.MP3', 'episode.m4a', 'news.wav', 'talk.ogg', 'talk.flac']) { assert.ok(isAudioSource({ name, type: '' })); assert.equal(kindOf(name), 'video'); }
  assert.equal(isAudioSource({ name: 'film.mp4', type: 'video/mp4' }), false); assert.ok(isAudioSource({ name: 'unknown', type: 'audio/mpeg' }));
  const pairs = pairEpisodes([{ name: 'podcast.E01.mp3', kind: 'video' }, { name: 'podcast.E01.en.srt', kind: 'subtitle' }]);
  assert.equal(pairs.length, 1); assert.ok(pairs[0].video && pairs[0].best);
  const media = file('news.wav'), data = session(media), store = createLearningSessionStore(); await store.saveLearningSession(data, media);
  const restored = await createLearningSessionStore().loadLearningSession(); assert.equal(restored?.video?.type, 'audio/wav'); assert.equal(await restored?.video?.text(), 'original media');
  assert.ok(await createSavedMediaStore().save(clip(media), media)); assert.equal(await (await createSavedMediaStore().read(clip(media)))?.text(), 'original media');
});
