import type { Cue, SavedWord } from './types';

function csvEscape(v: string): string {
  const s = v.replace(/\r?\n/g, '<br>').replace(/"/g, '""');
  return `"${s}"`;
}

/**
 * 导出为 Anki 可导入的 CSV。
 * 列：正面（句子）| 背面（翻译 + 生词）| 标签
 * Anki 导入时选择「逗号分隔」、勾选「允许 HTML」。
 */
export function exportAnkiCsv(cues: Cue[], filename = 'replay-cards.csv'): number {
  const rows: string[] = ['Front,Back,Tags'];

  for (const c of cues) {
    const wordsHtml = (c.words ?? [])
      .map((w) => `<b>${w.word}</b> — ${w.hint}`)
      .join('<br>');
    const front = c.text;
    const back = [c.translation ?? '', wordsHtml].filter(Boolean).join('<hr>');
    if (!front.trim()) continue;
    rows.push(
      [csvEscape(front), csvEscape(back), csvEscape('replay 看剧学英语')].join(',')
    );
  }

  const csv = '\uFEFF' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
  return rows.length - 1;
}

/** 导出用户手动收藏的生词 */
export function exportSavedWords(words: SavedWord[], filename = 'replay-words.csv'): number {
  if (words.length === 0) return 0;
  const rows: string[] = ['Front,Back,Tags'];
  for (const w of words) {
    const back = [w.translation, w.sentence ? `<i>${w.sentence}</i>` : '']
      .filter(Boolean)
      .join('<hr>');
    rows.push([csvEscape(w.word), csvEscape(back), csvEscape('replay 生词')].join(','));
  }
  const csv = '\uFEFF' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
  return words.length;
}

export function exportSrtBlob(text: string, filename = 'replay.srt') {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
