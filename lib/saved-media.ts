import { getStorageOwner } from './account-storage';
import type { SavedLineClip } from './types';
import { sameSavedVideo, validSavedClip } from './saved-line';

/** Collection videos are local, separate from the replaceable last learning session. */
export function createSavedMediaStore(owner = 'local') {
  const name = `replay-saved-media-${owner}`;
  const memory = new Map<string, File>();
  const persisted = new Set<string>();
  let pending: Promise<unknown> = Promise.resolve();
  function queue<T>(work: () => Promise<T>) {
    const next = pending.catch(() => undefined).then(work); pending = next.catch(() => undefined); return next;
  }
  function open() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('本地存储不可用')); return; }
      const request = indexedDB.open(name, 1);
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new Error('本地存储打开超时')); }, 5000);
      request.onupgradeneeded = () => request.result.createObjectStore('video');
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      request.onsuccess = () => { clearTimeout(timer); if (expired) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    });
  }
  const complete = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
  function read(clip: SavedLineClip): Promise<File | undefined> { return queue(async () => {
    if (!validSavedClip(clip) || clip.source.kind !== 'file') return;
    if (memory.has(clip.videoId)) { const file = memory.get(clip.videoId)!; return sameSavedVideo(clip, file) ? file : undefined; }
    const db = await open();
    try {
      const record = await new Promise<{ blob: Blob; source: SavedLineClip['source'] } | undefined>((resolve, reject) => { const request = db.transaction('video').objectStore('video').get(clip.videoId); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      if (!(record?.blob instanceof Blob) || record.source?.kind !== 'file' || record.blob.size !== record.source.size) return;
      const file = new File([record.blob], record.source.name, { type: record.source.type, lastModified: record.source.lastModified });
      if (!sameSavedVideo(clip, file)) return;
      memory.set(clip.videoId, file); persisted.add(clip.videoId); return file;
    } finally { db.close(); }
  }); }
  async function save(clip: SavedLineClip, file: File): Promise<boolean> {
    if (!validSavedClip(clip) || !sameSavedVideo(clip, file)) return false;
    return queue(async () => {
      const previous = memory.get(clip.videoId);
      const alreadySaved = persisted.has(clip.videoId) && previous && sameSavedVideo(clip, previous);
      memory.set(clip.videoId, file);
      let db: IDBDatabase | undefined;
      try {
        if (alreadySaved) return true;
        persisted.delete(clip.videoId);
        db = await open();
        let estimate: StorageEstimate | undefined;
        try { estimate = await navigator.storage?.estimate(); } catch { /* Quota estimation is optional. */ }
        if (estimate?.quota && (estimate.usage || 0) + file.size > estimate.quota * .9) return false;
        const tx = db.transaction('video', 'readwrite'), finished = complete(tx); tx.objectStore('video').put({ blob: file, source: clip.source }, clip.videoId); await finished; persisted.add(clip.videoId); return true;
      } catch { return false; } finally { db?.close(); }
    });
  }
  function remove(videoId: string) {
    return queue(async () => { memory.delete(videoId); persisted.delete(videoId); const db = await open(); try { const tx = db.transaction('video', 'readwrite'), finished = complete(tx); tx.objectStore('video').delete(videoId); await finished; } finally { db.close(); } });
  }
  return { read, save, remove };
}
const stores = new Map<string, ReturnType<typeof createSavedMediaStore>>();
export function savedMediaStore(owner = getStorageOwner()) {
  let store = stores.get(owner); if (!store) { store = createSavedMediaStore(owner); stores.set(owner, store); } return store;
}
