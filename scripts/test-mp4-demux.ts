/**
 * 验证纯 JS 的 MP4 字幕提取。
 * 用法：npx tsx scripts/test-mp4-demux.ts [file.mp4]
 */
import fs from 'node:fs';
import { extractMp4Subtitles, canHandleMp4 } from '../lib/demux/mp4';

const path = process.argv[2] ?? 'public/sample/demo.mp4';

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${sec}`;
}

async function main() {
  const buf = fs.readFileSync(path);
  const file = new File([buf], path.split(/[\\/]/).pop() ?? 'x.mp4', { type: 'video/mp4' });
  console.log(`文件: ${path}  ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`能识别: ${await canHandleMp4(file)}`);

  const t0 = Date.now();
  const tracks = await extractMp4Subtitles(file);
  const ms = Date.now() - t0;

  console.log(`\n耗时 ${ms} ms · 找到 ${tracks.length} 条字幕轨`);

  // 先把所有轨都打出来，别在循环里 exit
  for (const t of tracks) {
    console.log(`\n=== 轨道 #${t.index}（流 ${t.streamIndex}） ===`);
    console.log(`  codec=${t.codec}  语言=${t.lang ?? '未标注'}  共 ${t.cues.length} 条`);
    for (const c of t.cues.slice(0, 4)) {
      console.log(`    ${fmt(c.start)} → ${fmt(c.end)}  ${c.text.replace(/\n/g, ' / ').slice(0, 62)}`);
    }
  }

  if (!path.includes('demo.mp4')) return;

  console.log('\n=== 断言（demo.mp4）===');
  let pass = 0;
  let total = 0;
  const t = (name: string, ok: boolean, extra = '') => {
    total++;
    if (ok) pass++;
    console.log(`  ${ok ? '✓' : '★'} ${name}${extra ? `  ${extra}` : ''}`);
  };

  const main0 = tracks[0];
  t('只识别出 1 条字幕轨', tracks.length === 1, `实际 ${tracks.length}`);
  t('是 tx3g', main0?.codec === 'tx3g', main0?.codec ?? '-');
  t('语言标为 chi', main0?.lang === 'chi', main0?.lang ?? '-');
  t('共 46 条', main0?.cues.length === 46, String(main0?.cues.length ?? 0));
  t(
    '第一条是引擎那句',
    /motor'?s gonna die tomorrow/i.test(main0?.cues[0]?.text ?? '')
  );
  t(
    '每条都带中文',
    (main0?.cues.filter((c) => /[\u4e00-\u9fa5]/.test(c.text)).length ?? 0) === 46
  );
  t(
    '时间轴递增',
    (main0?.cues.every((c, i) => i === 0 || c.start >= main0.cues[i - 1].start) ?? false)
  );
  t('结束时间大于开始', (main0?.cues.every((c) => c.end > c.start) ?? false));

  console.log(`\n结果: ${pass}/${total}`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => {
  console.error('出错:', e);
  process.exit(1);
});
