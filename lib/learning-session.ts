import type { Cue } from './types';
import { getStorageOwner } from './account-storage';

const DB_NAME = 'replay-learning-session';
const SESSION_STORE = 'session';
const MEDIA_STORE = 'media';
const KEY = 'latest';

export type LearningSource = { kind: 'sample' } | {
  kind: 'file'; name: string; size: number; type: string; lastModified: number;
};
export type LearningSession = {
  id: string; source: LearningSource; videoName: string; cues: Cue[];
  sourceName?: string; hash: string | null; time: number; selected: number;
  rate: number; loop: boolean; showTrans: boolean; updatedAt: number;
};
type StoredSession = { session: LearningSession; hasMedia: boolean };
type StoredMedia = { id: string; blob: Blob };
export type RestoredLearningSession = { session: LearningSession; video?: File; missingVideo: boolean };
export type SessionSaveResult = { saved: boolean; message?: string };

// Keeps navigation instant, including navigation while IndexedDB is still writing.
// Durable storage also restores the session after a full refresh/browser restart.
export function createLearningSessionStore(owner = 'local') {
const databaseName = owner === 'local' ? DB_NAME : `${DB_NAME}-${owner}`;
let remembered: (StoredSession & { video?: File }) | null = null;
let writes: Promise<unknown> = Promise.resolve();
let revision = 0;
const memory = () => remembered;
function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const next = writes.catch(() => undefined).then(action);
  writes = next.catch(() => undefined);
  return next;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前浏览器无法保存学习记录。')); return; }
    const request = indexedDB.open(databaseName, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('本地存储打开超时，请关闭其他 Replay 标签页后重试。')); }, 5000);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SESSION_STORE);
      request.result.createObjectStore(MEDIA_STORE);
    };
    request.onerror = () => { clearTimeout(timer); reject(request.error ?? new Error('本地存储不可用。')); };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('本地保存失败。'));
  });
}
function get<T>(store: IDBObjectStore, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function fileLearningSource(file: File): LearningSource {
  return { kind: 'file', name: file.name, size: file.size, type: file.type, lastModified: file.lastModified };
}
function matchesLearningVideo(source: LearningSource, file: File): boolean {
  return source.kind === 'file' && source.name === file.name && source.size === file.size
    && source.lastModified === file.lastModified;
}

function rememberLearningSession(session: LearningSession, video?: File): void {
  revision++;
  remembered = {
    session,
    video: video ?? (remembered?.session.id === session.id ? remembered.video : undefined),
    hasMedia: remembered?.session.id === session.id ? remembered.hasMedia : false,
  };
}

async function hasRoom(file: File): Promise<boolean> {
  try {
    const estimate = await navigator.storage?.estimate();
    return !estimate?.quota || (estimate.usage ?? 0) + file.size < estimate.quota * 0.9;
  } catch { return true; }
}

/** One local video only; replacing a session releases the previous cached video. */
function saveLearningSession(session: LearningSession, video?: File): Promise<SessionSaveResult> {
  rememberLearningSession(session, video);
  return enqueue(async () => {
    if (remembered?.session.id !== session.id) return { saved: false };
    let db: IDBDatabase | undefined;
    try {
      db = await openDatabase();
      if (remembered?.session.id !== session.id) return { saved: false };
      const source = remembered.session.source;
      let mediaFailed = false;
      if (video || source.kind === 'sample') {
        try {
          if (video && !await hasRoom(video)) throw new Error('本地存储空间不足');
          // Recheck after async quota estimation: an old import must never replace a newer one.
          if (remembered?.session.id !== session.id) return { saved: false };
          const tx = db.transaction([SESSION_STORE, MEDIA_STORE], 'readwrite');
          const committed = done(tx);
          tx.objectStore(MEDIA_STORE).clear();
          if (video) tx.objectStore(MEDIA_STORE).put({ id: session.id, blob: video } satisfies StoredMedia, KEY);
          tx.objectStore(SESSION_STORE).put({ session: remembered.session, hasMedia: !!video } satisfies StoredSession, KEY);
          await committed;
          if (remembered?.session.id === session.id) remembered.hasMedia = !!video;
          return { saved: true };
        } catch { mediaFailed = true; }
      }
      if (remembered?.session.id !== session.id) return { saved: false };
      const tx = db.transaction(mediaFailed ? [SESSION_STORE, MEDIA_STORE] : SESSION_STORE, 'readwrite');
      const committed = done(tx);
      if (mediaFailed) { tx.objectStore(MEDIA_STORE).clear(); remembered.hasMedia = false; }
      tx.objectStore(SESSION_STORE).put({ session: remembered.session, hasMedia: remembered.hasMedia } satisfies StoredSession, KEY);
      await committed;
      const saved = source.kind === 'sample' || remembered.hasMedia;
      return { saved, message: saved ? undefined : '素材未能保存在浏览器中，字幕和进度已保存。下次选择同一个视频或音频即可继续。' };
    } catch {
      return { saved: false, message: '当前浏览器无法保存学习记录。离开后可能需要重新选择素材和字幕。' };
    } finally { db?.close(); }
  });
}

function validSession(value: LearningSession): boolean {
  return !!value && typeof value.id === 'string' && typeof value.videoName === 'string'
    && Array.isArray(value.cues) && value.cues.every(c => typeof c.text === 'string'
      && Number.isFinite(c.start) && Number.isFinite(c.end))
    && Number.isFinite(value.time) && value.time >= 0 && Number.isFinite(value.rate)
    && !!value.source && (value.source.kind === 'sample' || (value.source.kind === 'file'
      && typeof value.source.name === 'string' && Number.isFinite(value.source.size)));
}

async function loadLearningSession(): Promise<RestoredLearningSession | null> {
  if (remembered) return {
    session: remembered.session, video: remembered.video,
    missingVideo: remembered.session.source.kind === 'file' && !remembered.video,
  };
  const before = revision;
  const db = await openDatabase();
  try {
    const tx = db.transaction([SESSION_STORE, MEDIA_STORE]);
    const [record, media] = await Promise.all([
      get<StoredSession>(tx.objectStore(SESSION_STORE), KEY),
      get<StoredMedia>(tx.objectStore(MEDIA_STORE), KEY),
    ]);
    if (before !== revision) {
      const latest = memory();
      return latest ? { session: latest.session, video: latest.video,
        missingVideo: latest.session.source.kind === 'file' && !latest.video } : null;
    }
    if (!record || !validSession(record.session)) return null;
    const source = record.session.source;
    const video = source.kind === 'file' && record.hasMedia && media?.id === record.session.id
      && media.blob instanceof Blob && media.blob.size === source.size
      ? new File([media.blob], source.name, { type: source.type, lastModified: source.lastModified }) : undefined;
    remembered = { ...record, video };
    return { session: record.session, video, missingVideo: source.kind === 'file' && !video };
  } finally { db.close(); }
}

function clearLearningSession(): Promise<void> {
  revision++;
  remembered = null;
  return enqueue(async () => {
    const db = await openDatabase();
    try {
      const tx = db.transaction([SESSION_STORE, MEDIA_STORE], 'readwrite');
      const committed = done(tx);
      tx.objectStore(SESSION_STORE).clear(); tx.objectStore(MEDIA_STORE).clear();
      await committed;
    } finally { db.close(); }
  });
}
return { fileLearningSource, matchesLearningVideo, rememberLearningSession, saveLearningSession, loadLearningSession, clearLearningSession };
}

const stores = new Map<string, ReturnType<typeof createLearningSessionStore>>();
export function learningStore(owner = getStorageOwner()) {
  let store = stores.get(owner);
  if (!store) { store = createLearningSessionStore(owner); stores.set(owner, store); }
  return store;
}
export const fileLearningSource = (file: File) => learningStore().fileLearningSource(file);
export const matchesLearningVideo = (source: LearningSource, file: File) => learningStore().matchesLearningVideo(source, file);
export const rememberLearningSession = (session: LearningSession, video?: File) => learningStore().rememberLearningSession(session, video);
export const saveLearningSession = (session: LearningSession, video?: File) => learningStore().saveLearningSession(session, video);
export const loadLearningSession = () => learningStore().loadLearningSession();
export const clearLearningSession = () => learningStore().clearLearningSession();
