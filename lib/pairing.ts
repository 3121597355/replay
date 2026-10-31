/**
 * 剧集配对。
 *
 * 一个剧集文件夹里通常长这样：
 *   S01E01.mkv  S01E01.简体&英文.ass  S01E01.英.srt  S01E01.简.srt
 *   S01E02.mkv  S01E02.简体&英文.ass  ...
 *
 * 命名千奇百怪：S01E01 / 1x01 / EP01 / 第01集 / 就一个 01。
 * 这里做的是「按集数归组，给每集挑一条最合适的字幕」。
 */

export type MediaKind = 'video' | 'subtitle';

export interface MediaFile {
  name: string;
  kind: MediaKind;
  /** 相对路径（目录导入时用，方便显示和去重） */
  path?: string;
  size?: number;
  /** File System Access API 的句柄，存下来下次能直接读 */
  handle?: unknown;
}

export type SubLanguage = 'bilingual' | 'zh' | 'en' | 'unknown';

export interface Episode {
  /** 归组键，例如 s01e01 */
  key: string;
  /** 给人看的标签，例如 S01E01 或 第3集 */
  label: string;
  video?: MediaFile;
  subtitles: MediaFile[];
  /** 挑出来最该用的那条字幕 */
  best?: MediaFile;
  bestLang?: SubLanguage;
}

const VIDEO_EXT = new Set(['mkv', 'mp4', 'webm', 'avi', 'mov', 'm4v', 'ts', 'flv', 'wmv']);
const SUB_EXT = new Set(['srt', 'vtt', 'ass', 'ssa', 'sub']);

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function kindOf(name: string): MediaKind | null {
  const e = extOf(name);
  if (VIDEO_EXT.has(e)) return 'video';
  if (SUB_EXT.has(e)) return 'subtitle';
  return null;
}

const pad2 = (s: string) => s.padStart(2, '0');

/**
 * 字幕文件的语言/版本后缀。
 *
 *   Manchester...GECKOS.mkv
 *   Manchester...GECKOS.简体&英文.srt   ← 多了这一段
 *   Manchester...GECKOS.chs.srt
 *   Show.S01E01.eng.srt
 *
 * 不剥掉的话，同一集的视频和字幕会算出不同的键，永远配不上。
 */
const VARIANT_SUFFIX =
  /[.\-_ ](简体&英文|简英|中英双语|中英|双语|简体|繁体|简中|繁中|中文|英文|chs&eng|chs_eng|chs|cht|chi|eng|en|zh|sc|tc|cc|sdh|forced)$/i;

/** 反复剥，防备 `xxx.chs.简体.srt` 这种叠了两层的 */
function stripVariantSuffix(base: string): string {
  let s = base;
  for (let i = 0; i < 3; i++) {
    const next = s.replace(VARIANT_SUFFIX, '');
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * 从文件名提取集数键。
 *
 * 按可靠度依次尝试，命中即返回：
 *   S01E02 / s1e2          → s01e02
 *   1x02                   → s01e02
 *   EP02 / E02             → e02
 *   第2集 / 第 2 话         → e02
 * 都没有就把文件名（剥掉语言后缀）当键——电影、单集素材走到这里。
 */
export function episodeKey(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');

  let m = base.match(/[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})/);
  if (m) return `s${pad2(m[1])}e${pad2(m[2])}`;

  m = base.match(/(\d{1,2})[xX](\d{1,3})/);
  if (m) return `s${pad2(m[1])}e${pad2(m[2])}`;

  m = base.match(/[Ee][Pp]?[\s._-]*(\d{1,3})(?!\d)/);
  if (m) return `e${pad2(m[1])}`;

  m = base.match(/第\s*(\d{1,3})\s*[集话話]/);
  if (m) return `e${pad2(m[1])}`;

  // 没有集数标记：剥掉语言后缀，让电影的字幕和视频落到同一个键
  return stripVariantSuffix(base).toLowerCase();
}

/** 给界面的短标签 */
export function episodeLabel(key: string, filename: string): string {
  const se = key.match(/^s(\d+)e(\d+)$/);
  if (se) return `S${se[1]}E${se[2]}`;
  const e = key.match(/^e(\d+)$/);
  if (e) return `第 ${Number(e[1])} 集`;
  // 没识别出集数，就用去掉扩展名的文件名
  return filename.replace(/\.[^.]+$/, '');
}

/**
 * 猜字幕语言。
 * 只影响「同一集有多条字幕时挑哪条」，猜错也不致命。
 */
export function guessLanguage(filename: string): SubLanguage {
  const n = filename.toLowerCase();
  const hasZh = /简体|简中|中文|chs|\.chi\b|\.sc\b|cht|繁体|繁中/.test(n);
  const hasEn = /英文|英语|eng|\.en\b|en-us|en_us/.test(n);

  if (/双语|中英|简英|简英双语|bilingual|chs&eng|chs_eng|zh-en/.test(n)) return 'bilingual';
  if (hasZh && hasEn) return 'bilingual';
  if (hasZh) return 'zh';
  if (hasEn) return 'en';
  return 'unknown';
}

/** 挑字幕的优先级：双语 > 中文 > 未知 > 英文（学英语时双语最省事） */
const LANG_RANK: Record<SubLanguage, number> = {
  bilingual: 0,
  zh: 1,
  unknown: 2,
  en: 3,
};

/**
 * 把一堆文件配成剧集。
 *
 * 同一集可能有多条字幕，选一条放进 best；其余留在 subtitles 里，
 * 界面上还能手动切。
 */
export function pairEpisodes(files: MediaFile[]): Episode[] {
  const groups = new Map<string, Episode>();

  for (const f of files) {
    if (f.kind !== 'video' && f.kind !== 'subtitle') continue;

    const key = episodeKey(f.name);
    let ep = groups.get(key);
    if (!ep) {
      ep = { key, label: episodeLabel(key, f.name), subtitles: [] };
      groups.set(key, ep);
    }

    if (f.kind === 'video') {
      // 同一集有多个视频（比如 mkv + mp4），留大的那个
      if (!ep.video || (f.size ?? 0) > (ep.video.size ?? 0)) ep.video = f;
    } else {
      ep.subtitles.push(f);
    }
  }

  const list = Array.from(groups.values());

  for (const ep of list) {
    if (ep.subtitles.length === 0) continue;
    // 稳定排序：语言优先，同语言按文件名
    const sorted = [...ep.subtitles].sort((a, b) => {
      const la = LANG_RANK[guessLanguage(a.name)];
      const lb = LANG_RANK[guessLanguage(b.name)];
      if (la !== lb) return la - lb;
      return a.name.localeCompare(b.name);
    });
    ep.best = sorted[0];
    ep.bestLang = guessLanguage(sorted[0].name);
  }

  // 按集数排序（识别出集数的排前面，按编号升序）
  return list.sort((a, b) => {
    const na = a.key.match(/^s\d+e(\d+)$/)?.[1] ?? a.key.match(/^e(\d+)$/)?.[1];
    const nb = b.key.match(/^s\d+e(\d+)$/)?.[1] ?? b.key.match(/^e(\d+)$/)?.[1];
    if (na && nb) return Number(na) - Number(nb);
    if (na) return -1;
    if (nb) return 1;
    return a.key.localeCompare(b.key);
  });
}

export interface ScanSummary {
  episodes: Episode[];
  /** 有视频没字幕——最需要提示的情况 */
  needsSubtitle: number;
  /** 有字幕没视频 */
  needsVideo: number;
  /** 视频和字幕都在 */
  ready: number;
  /** 非媒体文件数量（不影响结果，只是让用户知道扫了些什么） */
  ignored: number;
}
