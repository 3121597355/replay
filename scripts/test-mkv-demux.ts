/**
 * 验证纯 JS 的 MKV 字幕提取。
 * 用法：npx tsx scripts/test-mkv-demux.ts [file.mkv]
 *
 * 大文件不会读进内存：用一个只实现 size + slice 的 mock File，
 * 每次 slice 现读现给，14GB 的也测得了。
 */
import fs from 'node:fs';
import { extractMkvSubtitles, canHandleMkv } from '../lib/demux/mkv';

const path = process.argv[2] ?? process.env.TEMP + '\\test-subs.mkv';

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${sec}`;
}

/** 只给 extractMkvSubtitles 需要的那两个能力 */
function makeFileHandle(p: string): { file: File; size: number; close: () => void } {
  const fd = fs.openSync(p, 'r');
  const size = fs.fstatSync(fd).size;

  const file = {
    size,
    slice(start: number, end: number) {
      const s = Math.max(0, start);
      const e = Math.min(size, end);
      const len = Math.max(0, e - s);
      // 用 Uint8Array 而不是 Buffer：fs.readSync 的签名收 ArrayBufferView，
      // Buffer 虽然也是 Uint8Array 子类，但这版 @types/node 的类型定义不认
      const buf = new Uint8Array(len);
      if (len > 0) fs.readSync(fd, buf, 0, len, s);
      return {
        arrayBuffer: async () => {
          // 转成独立的 ArrayBuffer，避免共享底层 pool
          const out = new ArrayBuffer(len);
          new Uint8Array(out).set(buf);
          return out;
        },
      };
    },
  } as unknown as File;

  return { file, size, close: () => fs.closeSync(fd) };
}

async function main() {
  if (!fs.existsSync(path)) {
    console.error(`文件不存在: ${path}`);
    process.exit(1);
  }
  const { file, size, close } = makeFileHandle(path);
  console.log(`文件: ${path}  ${(size / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log(`能识别: ${await canHandleMkv(file)}`);

  let last = -1;
  const t0 = Date.now();
  const tracks = await extractMkvSubtitles(file, (p) => {
    const bucket = Math.floor(p / 10) * 10;
    if (bucket !== last) {
      last = bucket;
      process.stdout.write(`\r  扫描 ${p}%   `);
    }
  });
  const ms = Date.now() - t0;
  close();
  console.log(`\n耗时 ${(ms / 1000).toFixed(1)} 秒 · 找到 ${tracks.length} 条字幕轨`);

  for (const t of tracks) {
    console.log(`\n=== 轨道 #${t.index}（TrackNumber ${t.streamIndex}） ===`);
    console.log(`  codec=${t.codec}  语言=${t.lang ?? '未标注'}  共 ${t.cues.length} 条`);
    for (const c of t.cues.slice(0, 5)) {
      console.log(`    ${fmt(c.start)} → ${fmt(c.end)}  ${c.text.replace(/\n/g, ' / ').slice(0, 62)}`);
    }
  }

  const main0 = tracks[0];
  console.log('\n=== 断言 ===');
  let pass = 0;
  let total = 0;
  const t = (name: string, ok: boolean, extra = '') => {
    total++;
    if (ok) pass++;
    console.log(`  ${ok ? '✓' : '★'} ${name}${extra ? `  ${extra}` : ''}`);
  };

  if (path.includes('test-subs')) {
    t('找到字幕轨', tracks.length >= 1, `实际 ${tracks.length}`);
    t('codec 是 S_TEXT/UTF8', main0?.codec?.startsWith('S_TEXT/UTF8') ?? false, main0?.codec ?? '-');
    t('共 46 条', main0?.cues.length === 46, String(main0?.cues.length ?? 0));
    t('第一条时间接近 7.09 秒', Math.abs((main0?.cues[0]?.start ?? 0) - 7.09) < 1.5, String(main0?.cues[0]?.start?.toFixed(2) ?? '-'));
    t('每条都带中文', (main0?.cues.filter((c) => /[\u4e00-\u9fa5]/.test(c.text)).length ?? 0) === 46);
  } else {
    // 真实电影：只做结构性断言
    t('找到字幕轨', tracks.length >= 1, `实际 ${tracks.length}`);
    t('条数 > 500', (main0?.cues.length ?? 0) > 500, String(main0?.cues.length ?? 0));
    t('时长覆盖到片尾', (main0?.cues[main0.cues.length - 1]?.start ?? 0) > 3600, `${fmt(main0?.cues[main0.cues.length - 1]?.start ?? 0)}`);
  }
  t('时间轴递增', main0?.cues.every((c, i) => i === 0 || c.start >= main0.cues[i - 1].start) ?? false);

  console.log(`\n结果: ${pass}/${total}`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => {
  console.error('出错:', e);
  process.exit(1);
});

