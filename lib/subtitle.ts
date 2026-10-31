import type { Cue } from './types';
import { parseSrt } from './srt';
import { splitBilingual, isJunkLine } from './lang';

/* ------------------------------------------------------------------ */
/*  ASS / SSA                                                          */
/* ------------------------------------------------------------------ */

/** ASS 时间：H:MM:SS.cc（cc 是厘秒，两位） */
function parseAssTime(s: string): number {
  const m = s.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!m) return NaN;
  return (
    Number(m[1]) * 3600 +
    Number(m[2]) * 60 +
    Number(m[3]) +
    Number(m[4].padEnd(3, '0')) / 1000
  );
}

/**
 * ASS 的 Text 字段可能含逗号，所以只切前 n-1 个逗号。
 */
function splitAssFields(s: string, n: number): string[] {
  const out: string[] = [];
  let rest = s;
  for (let i = 0; i < n - 1; i++) {
    const idx = rest.indexOf(',');
    if (idx === -1) break;
    out.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  out.push(rest);
  return out;
}

/**
 * 清掉 ASS 的花式标签，只留下人能读的字。
 * 重点是丢掉 {\p1}...{\p0} 里的矢量绘图——那是字幕组的 logo，不是台词。
 */
function cleanAssText(raw: string): string[] {
  let s = raw;

  // 矢量绘图段落：{\p1}m 195 227 l 228 227 ...{\p0}
  s = s.replace(/\{[^{}]*\\p[1-9][^{}]*\}[\s\S]*?(?=\{[^{}]*\\p0|$)/gi, ' ');

  // 其余覆盖标签 {\pos(..)}{\fad(..)}{\an8}...
  s = s.replace(/\{[^{}]*\}/g, ' ');

  // 硬换行 \N，软换行 \n
  s = s.replace(/\\[Nn]/g, '\n');

  // 残留的 HTML
  s = s.replace(/<[^>]+>/g, ' ');

  // &H00FFFFFF& 这类颜色残留、\h 硬空格
  s = s.replace(/\\h/gi, ' ');
  s = s.replace(/&H[0-9A-Fa-f]{2,8}&/g, ' ');

  return s
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * 解析 ASS / SSA。
 *
 * 不依赖固定字段顺序：先读 [Events] 里的 Format 行，按名字取字段。
 */
export function parseAss(raw: string): Cue[] {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  const cues: Cue[] = [];
  let id = 1;
  let inEvents = false;
  let fields: string[] = [];

  for (const line of lines) {
    const t = line.trim();

    if (/^\[Events\]/i.test(t)) {
      inEvents = true;
      fields = [];
      continue;
    }
    if (/^\[/.test(t)) {
      inEvents = false;
      continue;
    }
    if (!inEvents) continue;

    if (/^Format\s*:/i.test(t)) {
      fields = t
        .slice(t.indexOf(':') + 1)
        .split(',')
        .map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue\s*:/i.test(t)) continue;

    const payload = t.slice(t.indexOf(':') + 1).trim();
    const parts = splitAssFields(payload, fields.length || 10);

    const pick = (name: string): string => {
      const i = fields.indexOf(name);
      if (i >= 0) return parts[i] ?? '';
      // 没有 Format 行时按常见顺序兜底：Layer,Start,End,Style,Name,ML,MR,MV,Effect,Text
      const fallback: Record<string, number> = {
        layer: 0,
        start: 1,
        end: 2,
        style: 3,
        name: 4,
        text: 9,
      };
      const j = fallback[name];
      return j === undefined ? '' : (parts[j] ?? '');
    };

    const start = parseAssTime(pick('start'));
    const end = parseAssTime(pick('end'));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end <= start) continue;

    const bodyLines = cleanAssText(pick('text')).filter((l) => !isJunkLine(l));
    if (bodyLines.length === 0) continue;

    const { text: main, native } = splitBilingual(bodyLines);
    if (!main) continue;

    cues.push({ id: id++, start, end, text: main, native });
  }

  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/* ------------------------------------------------------------------ */
/*  统一入口                                                           */
/* ------------------------------------------------------------------ */

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

export function detectFormat(raw: string, filename?: string): SubtitleFormat {
  const ext = filename?.split('.').pop()?.toLowerCase();
  if (ext === 'ass' || ext === 'ssa') return 'ass';
  if (ext === 'vtt') return 'vtt';
  if (ext === 'srt') return 'srt';

  if (/\[Script Info\]/i.test(raw) || /^\s*Dialogue\s*:/im.test(raw)) return 'ass';
  if (/^\s*WEBVTT/i.test(raw)) return 'vtt';
  return 'srt';
}

/**
 * 按内容自动识别格式并解析。srt / vtt / ass 都能吃。
 */
export function parseSubtitle(raw: string, filename?: string): Cue[] {
  const format = detectFormat(raw, filename);
  if (format === 'ass') return parseAss(raw);
  return parseSrt(raw);
}

export const formatLabel: Record<SubtitleFormat, string> = {
  srt: 'SRT',
  vtt: 'VTT',
  ass: 'ASS',
};
