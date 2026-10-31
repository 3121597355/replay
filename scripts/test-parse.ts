/**
 * 用真实字幕文件验证解析器。
 * 跑法：npx tsx scripts/test-parse.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseSubtitle, detectFormat } from '../lib/subtitle';

const BASE =
  'H:\\video\\海边的曼彻斯特字幕【YYeTs人人影视原创翻译】\\Manchester.by.the.Sea.2016.720p.BluRay.x264-GECKOS';

const FILES: string[] = [
  path.join(BASE, 'Manchester.by.the.Sea.2016.720p.BluRay.x264-GECKOS.简体&英文.srt'),
  path.join(BASE, 'Manchester.by.the.Sea.2016.720p.BluRay.x264-GECKOS.简体&英文.ass'),
  path.join(BASE, 'Manchester.by.the.Sea.2016.720p.BluRay.x264-GECKOS.英文.srt'),
  'H:\\video\\obs\\Amazon\\欧阳万成：好交易\\S01\\欧阳万成：好交易_S01E01_Jimmy O_ Yang_ Good Deal_1_en-us_cc.srt',
  'H:\\video\\obs\\Amazon\\欧阳万成 猜猜多少钱？\\S01\\欧阳万成 猜猜多少钱？_S01E01_欧阳万成 猜猜多少钱？_1_en-us_cc.srt',
];

const JUNK = /(zimuzu|yyets|字幕组|人人影视|仅供学习|www\.)/i;

let pass = 0;
let fail = 0;

for (const file of FILES) {
  const name = path.basename(file);
  console.log('\n' + '='.repeat(72));
  console.log(name);

  if (!fs.existsSync(file)) {
    console.log('  ❌ 文件不存在');
    fail++;
    continue;
  }

  const raw = fs.readFileSync(file, 'utf8');
  const fmt = detectFormat(raw, file);
  const t0 = Date.now();
  const cues = parseSubtitle(raw, file);
  const ms = Date.now() - t0;

  const bilingual = cues.filter((c) => c.native).length;
  const junkLeaked = cues.filter((c) => JUNK.test(c.text) || (c.native && JUNK.test(c.native))).length;
  const empty = cues.filter((c) => !c.text.trim()).length;
  const badTime = cues.filter((c) => !(c.end > c.start) || c.start < 0).length;

  console.log(`  格式: ${fmt.toUpperCase()}   解析: ${cues.length} 条   耗时: ${ms}ms`);
  console.log(`  双语: ${bilingual}   垃圾行泄漏: ${junkLeaked}   空文本: ${empty}   时间轴异常: ${badTime}`);
  console.log('  --- 前 3 条 ---');
  for (const c of cues.slice(0, 3)) {
    const t = (s: number) =>
      `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    console.log(`   [${t(c.start)}-${t(c.end)}] ${c.text}`);
    if (c.native) console.log(`              中文: ${c.native}`);
  }

  const ok = cues.length > 0 && junkLeaked === 0 && empty === 0 && badTime === 0;
  console.log(ok ? '  ✅ 通过' : '  ❌ 有问题');
  ok ? pass++ : fail++;
}

console.log('\n' + '='.repeat(72));
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
