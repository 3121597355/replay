/**
 * 把带译文的时间轴导出成字幕文件。
 *
 * 翻完一部剧，译文只存在本站的 localStorage 里是可惜的——
 * 导成 srt 之后，播放器、剪辑软件、Anki 插件都能直接用。
 */
import type { Cue } from './types';

/**
 * 秒 → SRT 的 `HH:MM:SS,mmm`
 *
 * 先化成整毫秒再拆，不要「秒 - 整数秒」再乘 1000：
 * 11.9995 - 11 = 0.9994999999999994，乘一千取整会掉到 999，
 * 字幕时间轴经常是 23.976fps 这类带小数的值，逐级相减误差会累积。
 */
function srtTime(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);

  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(ms).padStart(3, '0')}`;
}

export interface SrtExportOptions {
  /** 双语时谁在上面。默认原文在上（学英语时的习惯） */
  order?: 'source-first' | 'native-first';
  /** 没有译文的句子怎么办：只出原文，还是整条跳过 */
  emptyTranslation?: 'keep-source' | 'skip';
}

/**
 * 生成 SRT 文本。
 * 有译文的句子出双行，没译文的只出原文。
 */
export function buildSrt(cues: Cue[], opts: SrtExportOptions = {}): string {
  const { order = 'source-first', emptyTranslation = 'keep-source' } = opts;
  const blocks: string[] = [];
  let n = 0;

  for (const c of cues) {
    const src = (c.text ?? '').trim();
    if (!src) continue;

    const zh = (c.translation ?? c.native ?? '').trim();
    if (!zh && emptyTranslation === 'skip') continue;

    const lines = zh
      ? order === 'source-first'
        ? [src, zh]
        : [zh, src]
      : [src];

    n++;
    blocks.push(`${n}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${lines.join('\n')}`);
  }

  return blocks.join('\n\n') + '\n';
}

/** 生成 VTT，给网页播放器用 */
export function buildVtt(cues: Cue[], opts: SrtExportOptions = {}): string {
  const srt = buildSrt(cues, opts);
  return (
    'WEBVTT\n\n' +
    srt
      .replace(/\r\n/g, '\n')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  );
}

/** 从原字幕文件名推一个导出名：xxx.srt → xxx.双语.srt */
export function deriveName(sourceName: string | undefined, ext = 'srt'): string {
  if (!sourceName) return `replay-双语.${ext}`;
  const base = sourceName.replace(/\.[^.]+$/, '');
  return `${base}.双语.${ext}`;
}
