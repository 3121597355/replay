import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createLearningSessionStore, type LearningSession } from '../lib/learning-session';

beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
  if (typeof navigator === 'undefined') Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  Object.defineProperty(navigator, 'storage', { value: { estimate: async () => ({ quota: 1e9, usage: 0 }) }, configurable: true });
});

test('a late initial restore cannot override a video selected while storage was loading', async () => {
  const existing = createLearningSessionStore(), first = clip();
  await existing.saveLearningSession(session(first), first);
  const store = createLearningSessionStore(), second = clip('new-selection.mp4', 'new selection');
  const loading = store.loadLearningSession();
  const saving = store.saveLearningSession(session(second, 'selected-while-loading'), second);
  const loaded = await loading;
  await saving;
  assert.equal(loaded?.session.id, 'selected-while-loading');
  assert.equal(loaded?.video, second);
});
const clip = (name = 'lesson.mp4', text = 'original video bytes') => new File([text], name, { type: 'video/mp4', lastModified: 1234 });
function session(file: File, id = 'first'): LearningSession {
  return { id, source: createLearningSessionStore().fileLearningSource(file), videoName: file.name,
    cues: [{ id: 0, start: 1, end: 4, text: 'Hello.', translation: '你好。' }],
    sourceName: 'lesson.srt', hash: 'subtitle-hash', time: 12.5, selected: 0,
    rate: 0.75, loop: true, showTrans: false, updatedAt: 100 };
}

test('a fresh player restores actual video bytes, subtitles, time and playback preferences', async () => {
  const file = clip(), store = createLearningSessionStore(), data = session(file);
  assert.deepEqual(await store.saveLearningSession(data, file), { saved: true });
  const reopened = await createLearningSessionStore().loadLearningSession();
  assert.deepEqual(reopened?.session, data);
  assert.equal(reopened?.missingVideo, false);
  assert.equal(await reopened?.video?.text(), await file.text());
  assert.equal(reopened?.video?.name, file.name);
  assert.equal(reopened?.video?.lastModified, file.lastModified);
});

test('navigation during a media write keeps the File and the latest translated subtitles', async () => {
  const file = clip(), store = createLearningSessionStore(), data = session(file);
  const writing = store.saveLearningSession(data, file);
  const changed = { ...data, time: 18.25, cues: [{ ...data.cues[0], translation: '新译文' }] };
  store.rememberLearningSession(changed);
  assert.equal((await store.loadLearningSession())?.video, file);
  await writing;
  const reopened = await createLearningSessionStore().loadLearningSession();
  assert.equal(reopened?.session.time, 18.25);
  assert.equal(reopened?.session.cues[0].translation, '新译文');
});

test('rapid video replacement never pairs the new subtitles with an old media blob', async () => {
  const store = createLearningSessionStore(), first = clip(), second = clip('second.mp4', 'second bytes');
  const oldWrite = store.saveLearningSession(session(first), first);
  const newWrite = store.saveLearningSession({ ...session(second, 'second'), sourceName: 'second.srt' }, second);
  await Promise.all([oldWrite, newWrite]);
  const reopened = await createLearningSessionStore().loadLearningSession();
  assert.equal(reopened?.session.id, 'second');
  assert.equal(reopened?.session.sourceName, 'second.srt');
  assert.equal(await reopened?.video?.text(), 'second bytes');
  const db = await new Promise<IDBDatabase>(resolve => {
    const request = indexedDB.open('replay-learning-session'); request.onsuccess = () => resolve(request.result);
  });
  const count = await new Promise<number>(resolve => {
    const request = db.transaction('media').objectStore('media').count(); request.onsuccess = () => resolve(request.result);
  });
  db.close(); assert.equal(count, 1);
});

test('quota fallback preserves captions and progress, removes old video and accepts only the original replacement', async () => {
  const store = createLearningSessionStore(), old = clip(), file = clip('new.mp4', 'new bytes');
  await store.saveLearningSession(session(old), old);
  Object.defineProperty(navigator, 'storage', { value: { estimate: async () => ({ quota: 5, usage: 0 }) }, configurable: true });
  const data = session(file, 'new');
  const result = await store.saveLearningSession(data, file);
  assert.equal(result.saved, false); assert.match(result.message!, /字幕和进度已保存/);
  const refreshed = createLearningSessionStore(), reopened = await refreshed.loadLearningSession();
  assert.equal(reopened?.missingVideo, true); assert.equal(reopened?.video, undefined);
  assert.deepEqual(reopened?.session, data);
  assert.equal(refreshed.matchesLearningVideo(data.source, old), false);
  assert.equal(refreshed.matchesLearningVideo(data.source, new File(['new bytes'], file.name, { lastModified: 999 })), false);
  assert.equal(refreshed.matchesLearningVideo(data.source, file), true);
  Object.defineProperty(navigator, 'storage', { value: { estimate: async () => ({ quota: 1e9, usage: 0 }) }, configurable: true });
  await refreshed.saveLearningSession(data, file);
  assert.equal(await (await createLearningSessionStore().loadLearningSession())?.video?.text(), 'new bytes');
});

test('video-only learning restores its progress without requiring an SRT hash', async () => {
  const file = clip(), store = createLearningSessionStore();
  await store.saveLearningSession({ ...session(file), cues: [], hash: null, sourceName: undefined }, file);
  await store.saveLearningSession({ ...session(file), cues: [], hash: null, sourceName: undefined, time: 25 });
  assert.equal((await createLearningSessionStore().loadLearningSession())?.session.time, 25);
});

test('sample sessions restore without persisting a network URL or retaining the previous video', async () => {
  const file = clip(), store = createLearningSessionStore();
  await store.saveLearningSession(session(file), file);
  const sample = { ...session(file, 'sample'), source: { kind: 'sample' as const } };
  await store.saveLearningSession(sample);
  const reopened = await createLearningSessionStore().loadLearningSession();
  assert.deepEqual(reopened?.session, sample); assert.equal(reopened?.missingVideo, false);
  assert.equal(reopened?.video, undefined);
});

test('clearing a session during a queued write removes both media and metadata', async () => {
  const file = clip(), store = createLearningSessionStore();
  const writing = store.saveLearningSession(session(file), file);
  const clearing = store.clearLearningSession();
  await Promise.all([writing, clearing]);
  assert.equal(await store.loadLearningSession(), null);
  assert.equal(await createLearningSessionStore().loadLearningSession(), null);
});

test('unavailable storage reports a failure while navigation can still recover in-memory media', async () => {
  const file = clip(), store = createLearningSessionStore();
  Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true });
  const result = await store.saveLearningSession(session(file), file);
  assert.equal(result.saved, false); assert.match(result.message!, /无法保存/);
  assert.equal((await store.loadLearningSession())?.video, file);
  await assert.rejects(createLearningSessionStore().loadLearningSession());
});
