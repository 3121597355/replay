import type { Cue } from './types';
import { splitBilingual, isJunkLine } from './lang';

const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return (
    Number(h) * 3600 +
    Number(m) * 60 +
    Number(s) +
    Number(ms.padEnd(3, '0')) / 1000
  );
}

function cleanLine(line: string): string {
  return line
    .replace(/<[^>]+>/g, '') // <i>, <b>, <font ...>
    .replace(/\{\\[^}]+\}/g, '') // {\an8} 之类的 ASS 标记
    .replace(/\\[Nn]/g, ' ') // 有些 srt 用 \N 当换行
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析 SRT / VTT 文本为 Cue 数组。
 * 容错：缺序号、缺空行、时间轴用点号分隔都能处理。
 * 双语字幕会自动拆成 text + native。
 */
export function parseSrt(raw: string): Cue[] {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  let id = 1;

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;

    // 跳过 WEBVTT 头
    if (/^WEBVTT/i.test(lines[0])) continue;

    const timeIdx = lines.findIndex((l) => TIME_RE.test(l) && l.includes('-->'));
    if (timeIdx === -1) continue;

    const timeLine = lines[timeIdx];
    const [left, right] = timeLine.split('-->');
    const lm = left.match(TIME_RE);
    const rm = right.trim().match(TIME_RE);
    if (!lm || !rm) continue;

    const start = toSeconds(lm[1], lm[2], lm[3], lm[4]);
    const end = toSeconds(rm[1], rm[2], rm[3], rm[4]);

    const bodyLines = lines
      .slice(timeIdx + 1)
      .map(cleanLine)
      .filter((l) => l && !isJunkLine(l));

    const { text: body, native } = splitBilingual(bodyLines);
    if (!body) continue;

    cues.push({ id: id++, start, end, text: body, native });
  }

  return cues;
}

export function formatTime(seconds: number): string {  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** 把 Cue 数组重新导出成 SRT，供下载 */
export function toSrt(cues: Cue[]): string {
  const fmt = (t: number) => {
    const ms = Math.round((t % 1) * 1000);
    const s = Math.floor(t);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };
  return cues
    .map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}`)
    .join('\n\n');
}

/** 粗略判断词汇难度，用于给用户提示 */
export function estimateLevel(cues: Cue[]): string {
  if (cues.length === 0) return '—';
  const words = cues.flatMap((c) => c.text.toLowerCase().match(/[a-z']+/g) ?? []);
  if (words.length === 0) return '—';
  const unique = new Set(words);
  const avgLen =
    Array.from(unique).reduce((a, w) => a + w.length, 0) / unique.size;
  const avgSentence =
    words.length / Math.max(1, cues.length);

  const score = avgLen * 1.6 + avgSentence * 0.9;
  if (score < 15) return 'A2 – B1';
  if (score < 18) return 'B1 – B2';
  if (score < 21) return 'B2 – C1';
  return 'C1+';
}
