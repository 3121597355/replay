/**
 * 翻译缓存。
 *
 * 2260 句的剧集重翻一遍要几分钟，还烧 token。按字幕文件内容的指纹
 * 存一份译文，下次导入同一份字幕直接套上，一句都不用再请求。
 *
 * 只存 [cueId, 译文] 对，不存整句原文——原文能从字幕重新解析出来，
 * 存两份纯属浪费配额。
 */

import { storagePrefix } from './account-storage';
const prefix = () => storagePrefix('replay.trans');
/** 最多留几部。超了淘汰最久没打开的。localStorage 只有 5MB 左右。 */
const MAX_ENTRIES = 24;

export interface TransCacheEntry {
  /** 格式版本，以后要改结构靠它识别旧数据 */
  v: 1;
  /** 原始文件名，给用户认的 */
  name: string;
  /** 写入时间 */
  savedAt: number;
  /** 用的什么模型，换模型后译文风格可能不同，留个记录 */
  model: string;
  /** [cueId, 译文] */
  items: [number, string][];
}

/**
 * 内容指纹。
 * 用不着密码学强度——同机去重而已，FNV-1a 双路足够。
 */
export function hashText(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function safeParse(raw: string | null): TransCacheEntry | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as TransCacheEntry;
    if (o?.v !== 1 || !Array.isArray(o.items)) return null;
    return o;
  } catch {
    return null;
  }
}

export function readCache(hash: string): TransCacheEntry | null {
  try {
    return safeParse(localStorage.getItem(prefix() + hash));
  } catch {
    return null;
  }
}

/** 列出所有缓存，按最近使用排序。 */
export function listCaches(): { hash: string; entry: TransCacheEntry }[] {
  const out: { hash: string; entry: TransCacheEntry }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix())) continue;
      const entry = safeParse(localStorage.getItem(k));
      if (entry) out.push({ hash: k.slice(prefix().length), entry });
    }
  } catch {
    /* 隐私模式下 localStorage 可能直接抛 */
  }
  return out.sort((a, b) => b.entry.savedAt - a.entry.savedAt);
}

/** 超出上限时淘汰最旧的。 */
function evict() {
  const all = listCaches();
  if (all.length <= MAX_ENTRIES) return;
  for (const { hash } of all.slice(MAX_ENTRIES)) {
    try {
      localStorage.removeItem(prefix() + hash);
    } catch {
      /* ignore */
    }
  }
}

/**
 * 写入（覆盖）。返回是否成功——配额满了会失败，调用方应当知道。
 */
export function writeCache(
  hash: string,
  name: string,
  model: string,
  items: [number, string][]
): boolean {
  if (items.length === 0) return false;
  const entry: TransCacheEntry = { v: 1, name, savedAt: Date.now(), model, items };
  try {
    localStorage.setItem(prefix() + hash, JSON.stringify(entry));
    evict();
    return true;
  } catch {
    // 配额满：先清掉最旧的一批再重试一次
    const all = listCaches();
    for (const { hash: h } of all.slice(Math.max(1, Math.floor(all.length / 2)))) {
      try {
        localStorage.removeItem(prefix() + h);
      } catch {
        /* ignore */
      }
    }
    try {
      localStorage.setItem(prefix() + hash, JSON.stringify(entry));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 增量合并：把新译文并进已有缓存。
 * 翻到一半关页面也不至于前功尽弃。
 */
export function mergeCache(
  hash: string,
  name: string,
  model: string,
  items: [number, string][]
): boolean {
  if (items.length === 0) return false;
  const prev = readCache(hash);
  const map = new Map<number, string>(prev?.items ?? []);
  for (const [id, t] of items) {
    if (t && t.trim()) map.set(id, t);
  }
  return writeCache(hash, name, prev?.model || model, Array.from(map.entries()));
}

export function clearCache(hash: string) {
  try {
    localStorage.removeItem(prefix() + hash);
  } catch {
    /* ignore */
  }
}

export function clearAllCaches(): number {
  const all = listCaches();
  for (const { hash } of all) clearCache(hash);
  return all.length;
}

/** 给设置面板显示：几部、占多少 */
export function cacheStats(): { count: number; bytes: number } {
  let bytes = 0;
  let count = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix())) continue;
      const v = localStorage.getItem(k);
      if (v) {
        bytes += v.length * 2; // UTF-16 估算
        count++;
      }
    }
  } catch {
    /* ignore */
  }
  return { count, bytes };
}

/** 把缓存套到 cues 上，返回新的数组和命中句数。 */
export function applyCache<T extends { id: number; translation?: string }>(
  cues: T[],
  entry: TransCacheEntry
): { cues: T[]; applied: number } {
  const map = new Map<number, string>(entry.items);
  let applied = 0;
  const next = cues.map((c) => {
    const t = map.get(c.id);
    if (!t || c.translation) return c;
    applied++;
    return { ...c, translation: t };
  });
  return { cues: next, applied };
}
