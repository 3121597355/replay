/**
 * 字幕提取的统一入口。
 *
 * 优先级：纯 JS 解析 → ffmpeg.wasm 兜底。
 *
 * 纯 JS 只做「读容器、找字幕轨、解文本」，不碰任何编解码器，
 * 所以是毫秒级、几百 KB 的代码，而 ffmpeg 要下 31MB。
 * 只有遇到我们不认识的容器（avi、ts、mov 的奇葩变体）才回退。
 */
import { extractMp4Subtitles, canHandleMp4, type DemuxedTrack } from './mp4';
import { extractMkvSubtitles, canHandleMkv } from './mkv';

export type { DemuxedTrack, DemuxedCue } from './mp4';

export type Container = 'mp4' | 'mkv';

export interface FastResult {
  /** 能不能用纯 JS 处理这个文件 */
  handled: boolean;
  /** 容器类型 */
  container?: Container;
  /** 找到的字幕轨（可能为空——说明这视频本来就没软字幕） */
  tracks: DemuxedTrack[];
  /** 耗时毫秒，给界面显示 */
  ms: number;
  /** 出错时的原因 */
  error?: string;
}

/**
 * 认容器。
 * mp4 家族（mp4/m4v/mov）看 ftyp；mkv/webm 看 EBML 魔数。
 */
export async function detectContainer(file: File): Promise<Container | null> {
  if (await canHandleMkv(file)) return 'mkv';
  if (await canHandleMp4(file)) return 'mp4';
  return null;
}

/** 用纯 JS 提取。认不出的容器返回 handled: false，由调用方走 ffmpeg。 */
export async function extractFast(
  file: File,
  onProgress?: (pct: number) => void
): Promise<FastResult> {
  const t0 = Date.now();
  const container = await detectContainer(file);

  if (!container) {
    return { handled: false, tracks: [], ms: Date.now() - t0 };
  }

  try {
    const tracks =
      container === 'mkv'
        ? await extractMkvSubtitles(file, onProgress)
        : await extractMp4Subtitles(file, onProgress);
    return { handled: true, container, tracks, ms: Date.now() - t0 };
  } catch (err) {
    return {
      handled: true,
      container,
      tracks: [],
      ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 秒 → SRT 时间戳 */
function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const s = Math.floor(ms / 1000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)},${String(ms % 1000).padStart(3, '0')}`;
}

/**
 * 把解出来的轨转成 SRT 文本。
 * 走 SRT 而不是直接构造 Cue，是为了复用现有解析器里的
 * 双语拆分、垃圾行过滤、ASS 标签清理等逻辑，避免两套实现。
 */
export function trackToSrt(track: DemuxedTrack): string {
  const blocks: string[] = [];
  let n = 0;
  for (const c of track.cues) {
    const text = c.text.trim();
    if (!text) continue;
    n++;
    blocks.push(`${n}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${text}`);
  }
  return blocks.join('\n\n') + '\n';
}

/** 给界面显示的一行摘要 */
export function describeTrack(track: DemuxedTrack): string {
  const lang = track.lang && track.lang !== 'und' ? track.lang : '';
  const codec = track.codec
    .replace('S_TEXT/', '')
    .replace('|compressed', '')
    .toLowerCase();
  return [codec, lang].filter(Boolean).join(' · ') || '字幕';
}
