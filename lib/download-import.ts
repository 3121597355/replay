export const COMPANION_ORIGIN = 'http://127.0.0.1:45211';
export const IMPORT_LIMIT = 500 * 1024 * 1024;
const SUBTITLE_LIMIT = 20 * 1024 * 1024;
const TTL = 15 * 60 * 1000;
const DB_NAME = 'replay-download-import';
const STORE = 'imports';

export type DownloadBundle = { video: File; subtitles: File[] };
type StoredFile = { blob: Blob; name: string; type: string; lastModified: number };
type Record = { id: string; expires: number; video: StoredFile; subtitles: StoredFile[] };

export function validateDownloadBundle(value: unknown): DownloadBundle {
  const bundle = value as DownloadBundle;
  if (!bundle || !(bundle.video instanceof File) || !Array.isArray(bundle.subtitles)
    || bundle.subtitles.length > 20 || !/\.mp4$/i.test(bundle.video.name) || bundle.video.size === 0) {
    throw new Error('请选择一份 MP4 视频和对应的 SRT 字幕。');
  }
  const stem = bundle.video.name.replace(/\.mp4$/i, '');
  let subtitleBytes = 0;
  for (const subtitle of bundle.subtitles) {
    if (!(subtitle instanceof File) || !/\.srt$/i.test(subtitle.name) || !subtitle.size
      || !(subtitle.name === `${stem}.srt` || subtitle.name.startsWith(`${stem}.`))) {
      throw new Error('字幕文件名与视频不匹配，请选择同一视频导出的 SRT。');
    }
    subtitleBytes += subtitle.size;
  }
  if (subtitleBytes > SUBTITLE_LIMIT || bundle.video.size + subtitleBytes > IMPORT_LIMIT) {
    throw new Error('这组视频与字幕过大，请使用小于 500 MiB 的学习片段。');
  }
  return bundle;
}

export function validImportToken(value: string | null): value is string {
  return !!value && /^[a-f\d-]{32,64}$/i.test(value);
}

export function isCompanionMessage(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  source: Window | null, token: string): boolean {
  return !!source && event.origin === COMPANION_ORIGIN && event.source === source
    && event.data?.token === token;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('浏览器临时存储不可用，请保存文件后从学习台手动导入。')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      reject(new Error('临时存储打开超时，请关闭其他 Replay 页面后重试。'));
    }, 5000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onerror = () => { clearTimeout(timer); reject(new Error('浏览器临时存储不可用，请从学习台手动导入文件。')); };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (finished) { request.result.close(); return; }
      resolve(request.result);
    };
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('浏览器空间不足或临时存储不可用，请保存文件后手动导入。'));
  });
}

const pack = (file: File): StoredFile => ({ blob: file, name: file.name, type: file.type, lastModified: file.lastModified });
const unpack = (file: StoredFile): File => new File([file.blob], file.name, { type: file.type, lastModified: file.lastModified });

export async function saveDownloadImport(value: DownloadBundle): Promise<string> {
  const bundle = validateDownloadBundle(value);
  const db = await openDatabase();
  try {
    const id = crypto.randomUUID();
    const cleanup = db.transaction(STORE, 'readwrite');
    const cleaned = transactionDone(cleanup);
    const cursor = cleanup.objectStore(STORE).openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      if (entry.value.expires < Date.now()) entry.delete();
      entry.continue();
    };
    await cleaned;
    const tx = db.transaction(STORE, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE);
    store.put({ id, expires: Date.now() + TTL, video: pack(bundle.video), subtitles: bundle.subtitles.map(pack) } satisfies Record);
    await done;
    return id;
  } finally { db.close(); }
}

export async function readDownloadImport(id: string): Promise<DownloadBundle | null> {
  if (!validImportToken(id)) return null;
  const db = await openDatabase();
  try {
    const record = await new Promise<Record | undefined>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('读取下载文件失败，请重新导入。'));
    });
    if (!record || record.expires < Date.now()) return null;
    return validateDownloadBundle({ video: unpack(record.video), subtitles: record.subtitles.map(unpack) });
  } finally { db.close(); }
}

export async function discardDownloadImport(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(STORE).delete(id);
    await done;
  } finally { db.close(); }
}
