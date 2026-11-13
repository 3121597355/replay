import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { hashPassword, verifyPassword, createRecoveryCode, recoveryDigest } from '../lib/account-password';
import { safeReturnPath, normalizeUsername, validUsername } from '../lib/account-types';
import { setStorageOwner, storageKey } from '../lib/account-storage';
import { loadSavedWords, persistSavedWords } from '../lib/saved-words';
import { createLearningSessionStore, type LearningSession } from '../lib/learning-session';
import { parseReviewSchedule } from '../lib/review-schedule';
test('salted scrypt passwords verify without accepting wrong or malformed hashes', async () => {
  const first = await hashPassword('测试-safe-password'), second = await hashPassword('测试-safe-password');
  assert.notEqual(first, second); assert.equal(await verifyPassword('测试-safe-password', first), true);
  assert.equal(await verifyPassword('wrong-password', first), false); assert.equal(await verifyPassword('测试-safe-password', undefined), false);
});
test('recovery codes contain 128 random bits and accept formatting variations only', () => {
  const first = createRecoveryCode(), second = createRecoveryCode();
  assert.match(first, /^[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/); assert.notEqual(first, second);
  assert.equal(recoveryDigest(first), recoveryDigest(first.replace(/-/g, ' ').toLowerCase()));
  assert.notEqual(recoveryDigest(first), recoveryDigest(second));
});
test('return paths cannot escape the site or bypass path restrictions', () => {
  for (const path of ['https://evil.test', '//evil.test', '/\\evil.test', '/admin', '/account/recover', '/learn\r\nx: y', '/%2f%2fevil.test', '/account/../admin']) assert.equal(safeReturnPath(path), '/learn');
  assert.equal(safeReturnPath('/learn?import=test#video'), '/learn?import=test#video');
  assert.equal(safeReturnPath('/review'), '/review'); assert.equal(validUsername(normalizeUsername(' ＡB用户 ')), true);
  assert.equal(validUsername('<script>'), false);
});
test('switching accounts isolates saved words and legacy records remain intact', () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) }, configurable: true });
  const word = { word: 'hello', sentence: 'Hello there.', translation: '你好', addedAt: 1 };
  setStorageOwner('local'); persistSavedWords([word]);
  setStorageOwner('account-a'); assert.deepEqual(loadSavedWords(), []); persistSavedWords([{ ...word, word: 'a' }]);
  setStorageOwner('account-b'); assert.deepEqual(loadSavedWords(), []);
  setStorageOwner('account-a'); assert.equal(loadSavedWords()[0].word, 'a');
  setStorageOwner('local'); assert.equal(loadSavedWords()[0].word, 'hello'); assert.equal(storageKey('replay.saved'), 'replay.saved');
});
test('each account restores its own video and subtitle state from a fresh store', async () => {
  Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
  if (typeof navigator === 'undefined') Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  Object.defineProperty(navigator, 'storage', { value: { estimate: async () => ({ quota: 1e9, usage: 0 }) }, configurable: true });
  const first = createLearningSessionStore('account-a'), second = createLearningSessionStore('account-b');
  const video = new File(['private video bytes'], 'a.mp4', { type: 'video/mp4', lastModified: 1 });
  const data: LearningSession = { id: 'session-a', source: first.fileLearningSource(video), videoName: video.name, cues: [{ id: 0, start: 1, end: 2, text: 'Private sentence' }], hash: null, time: 1, selected: 0, rate: 1, loop: false, showTrans: true, updatedAt: 1 };
  await first.saveLearningSession(data, video);
  assert.equal(await second.loadLearningSession(), null);
  const restored = await createLearningSessionStore('account-a').loadLearningSession();
  assert.equal(restored?.session.cues[0].text, 'Private sentence'); assert.equal(await restored?.video?.text(), 'private video bytes');
  await second.clearLearningSession(); assert.ok(await createLearningSessionStore('account-a').loadLearningSession());
});
test('corrupted review entries cannot produce invalid stages or future locks', () => {
  const clean = parseReviewSchedule({ good: { stage: 2, due: 123 }, bad: { stage: 100, due: 1 }, missing: null, nan: { stage: 1, due: NaN }, negative: { stage: -1, due: 0 } });
  assert.deepEqual(Object.keys(clean), ['good']); assert.deepEqual(Object.keys(parseReviewSchedule([])), []);
});
