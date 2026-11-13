/**
 * 播放进度记忆。
 *
 * 一部剧十几集，每集两小时——今天看到 47 分钟，明天打开还得自己拖回去，
 * 这种摩擦足以让人放弃。按字幕内容指纹记一下位置，再打开时直接问「继续？」。
 *
 * 按字幕指纹保存独立进度；视频与当前字幕的完整恢复由 learning-session.ts 负责。
 */
import { storagePrefix } from './account-storage';
const prefix = () => storagePrefix('replay.progress');
/** 存多少部就清掉最旧的 */
const MAX = 60;
/** 时长的 2% 以内算看完了，没必要记住 */
const NEAR_END = 0.98;

export interface Progress {
  /** 播放位置（秒） */
  time: number;
  /** 第几句 */
  cue: number;
  /** 记录时间 */
  at: number;
  /** 总时长，用来算百分比和判断是不是快看完了 */
  duration?: number;
  /** 字幕文件名，给提示文案用 */
  name?: string;
}

export function saveProgress(
  hash: string,
  p: Omit<Progress, 'at'> & { at?: number }
): void {
  if (!hash) return;
  try {
    // 太靠开头（前 3 秒）没记的意义
    if (p.time < 3) return;
    // 已经快播完，清掉旧记录，下次从头开始
    if (p.duration && p.time / p.duration > NEAR_END) {
      localStorage.removeItem(prefix() + hash);
      return;
    }
    const entry: Progress = { ...p, at: Date.now() };
    localStorage.setItem(prefix() + hash, JSON.stringify(entry));
    evict();
  } catch {
    /* 配额满了就算了，不打断播放 */
  }
}

export function loadProgress(hash: string): Progress | null {
  if (!hash) return null;
  try {
    const raw = localStorage.getItem(prefix() + hash);
    if (!raw) return null;
    const p = JSON.parse(raw) as Progress;
    if (typeof p?.time !== 'number' || p.time < 3) return null;
    return p;
  } catch {
    return null;
  }
}

export function clearProgress(hash: string): void {
  try {
    localStorage.removeItem(prefix() + hash);
  } catch {
    /* ignore */
  }
}

function evict() {
  const keys: { k: string; at: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix())) continue;
      let at = 0;
      try {
        at = (JSON.parse(localStorage.getItem(k) ?? '{}') as Progress).at ?? 0;
      } catch {
        /* 坏数据当作最旧 */
      }
      keys.push({ k, at });
    }
  } catch {
    return;
  }
  if (keys.length <= MAX) return;
  keys.sort((a, b) => a.at - b.at);
  for (const { k } of keys.slice(0, keys.length - MAX)) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

/** 秒 → `12:34` / `1:02:34` */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p2(m)}:${p2(ss)}` : `${m}:${p2(ss)}`;
}
