import { guessLanguage } from './pairing';
import { parseSubtitle } from './subtitle';
import { buildSrt } from './subtitle-export';

export async function chooseDownloadSubtitle(videoName: string, files: File[]) {
  const entries = await Promise.all(files.map(async file => {
    const text = await file.text();
    const cues = parseSubtitle(text, file.name);
    const language = guessLanguage(file.name);
    const bilingual = cues.some(cue => cue.native);
    const rank = bilingual ? 0 : language === 'en' ? 1 : language === 'unknown' ? 2 : 3;
    return { file, text, cues, language, bilingual, rank };
  }));
  const usable = entries.filter(entry => entry.cues.length).sort((a, b) => a.rank - b.rank);
  if (files.length && !usable.length) throw new Error('这些 SRT 没有可读字幕，请检查文件内容后重新导入。');
  const selected = usable[0];
  if (!selected) return { selected: null, files, note: '视频已导入，请载入对应字幕。' };

  if (!selected.bilingual && selected.language === 'en') {
    const chinese = usable.find(entry => entry.language === 'zh' && !entry.bilingual);
    if (chinese && selected.cues.length === chinese.cues.length
      && selected.cues.every((cue, index) => cue.start === chinese.cues[index].start && cue.end === chinese.cues[index].end)) {
      const merged = selected.cues.map((cue, index) => ({ ...cue, native: chinese.cues[index].text }));
      const text = buildSrt(merged);
      const file = new File([text], `${videoName.replace(/\.mp4$/i, '')}.中英双语.srt`, { type: 'application/x-subrip' });
      return { selected: { file, text }, files: [file, ...files], note: '视频与配套字幕已导入，中英字幕时间完全一致，已合并显示。' };
    }
    if (chinese) return { selected, files, note: '已载入英文字幕；中英时间轴不同，保留原文件供手动切换。' };
  }
  return { selected, files, note: '视频与配套字幕已导入。' };
}
