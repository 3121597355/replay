/**
 * 选一个剧集文件夹，自动把视频和字幕配成对。
 *
 * 用的是 File System Access API（Chrome / Edge 支持，Safari 和 Firefox 不支持）。
 * 不支持的时候上层退回「一个个选文件」，功能不丢，只是麻烦点。
 */
import { kindOf, type MediaFile } from './pairing';

/** 目录里最多往下钻几层（Season 1/ 这种一层就够，多了容易扫到无关目录） */
const MAX_DEPTH = 3;

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * 手动把 async iterator 抽干。
 * 项目的 TS target 压到 es5，`for await` 和展开运算符都用不了。
 */
async function drain(iterable: any): Promise<any[]> {
  const out: any[] = [];
  const it = iterable[Symbol.asyncIterator]();
  for (;;) {
    const r = await it.next();
    if (r.done) break;
    out.push(r.value);
  }
  return out;
}

async function scanDir(
  dir: any,
  onProgress: ((count: number) => void) | undefined,
  depth: number
): Promise<MediaFile[]> {
  if (depth > MAX_DEPTH) return [];

  const files: MediaFile[] = [];
  let entries: any[] = [];
  try {
    entries = await drain(dir.values());
  } catch {
    return files; // 没权限或已经被移走
  }

  for (const entry of entries) {
    if (entry.kind === 'file') {
      const kind = kindOf(entry.name);
      if (!kind) continue;
      let size = 0;
      try {
        size = (await entry.getFile()).size;
      } catch {
        /* 拿不到大小不影响配对 */
      }
      files.push({ name: entry.name, kind, path: entry.name, size, handle: entry });
      onProgress?.(files.length);
    } else if (entry.kind === 'directory') {
      const sub = await scanDir(entry, onProgress, depth + 1);
      for (const f of sub) {
        files.push({ ...f, path: `${entry.name}/${f.path ?? f.name}` });
      }
    }
  }
  return files;
}

/**
 * 弹目录选择框并扫描。用户取消返回 null。
 * 必须在点击事件里调用——浏览器要求用户手势。
 */
export async function pickAndScan(
  onProgress?: (count: number) => void
): Promise<MediaFile[] | null> {
  if (!supportsDirectoryPicker()) return null;
  const picker = (window as any).showDirectoryPicker;
  const dir = await picker.call(window, { mode: 'read' });
  if (!dir) return null;
  return scanDir(dir, onProgress, 0);
}

/** 读一份文件成 File */
export async function readHandle(handle: unknown): Promise<File | null> {
  if (!handle) return null;
  try {
    const h = handle as any;
    // 有的浏览器重新打开页面后权限会退回 'prompt'
    if (typeof h.queryPermission === 'function') {
      const state = await h.queryPermission({ mode: 'read' });
      if (state !== 'granted') {
        const asked = await h.requestPermission({ mode: 'read' });
        if (asked !== 'granted') return null;
      }
    }
    return (await h.getFile()) as File;
  } catch {
    return null;
  }
}

/** 读字幕文本 */
export async function readTextHandle(handle: unknown): Promise<string | null> {
  const f = await readHandle(handle);
  if (!f) return null;
  try {
    return await f.text();
  } catch {
    return null;
  }
}
