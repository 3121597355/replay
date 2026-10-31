/**
 * 验证双语 SRT / VTT 导出。
 * 用法：npx tsx scripts/test-srt-export.ts
 */
import { buildSrt, buildVtt, deriveName } from '../lib/subtitle-export';
import type { Cue } from '../lib/types';

const cues: Cue[] = [
  { id: 1, start: 1.955, end: 3.5, text: 'Hello there.', translation: '你好啊' },
  { id: 2, start: 4, end: 6.25, text: 'How are you?', translation: '你好吗' },
  // 没有译文的句子
  { id: 3, start: 7, end: 8, text: 'Just English here.' },
  // 空文本，应该被跳过
  { id: 4, start: 9, end: 10, text: '   ' },
  // 毫秒进位边界：1.9995 秒 → 四舍五入到 1000ms，必须进位成下一秒
  { id: 5, start: 11.9995, end: 13.0005, text: 'Rounding edge.', translation: '进位边界' },
  // 跨小时
  { id: 6, start: 3725.5, end: 3727, text: 'Past an hour.', translation: '超过一小时' },
  // 字幕自带中文（native 而非 translation）
  { id: 7, start: 14, end: 15, text: 'Native fallback.', native: '自带译文' },
];

function check(name: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? '✓' : '★'} ${name}${detail ? `  ${detail}` : ''}`);
  return cond;
}

console.log('=== SRT（原文在上）===\n');
const srt = buildSrt(cues);
console.log(srt);

let pass = 0;
let total = 0;
const t = (n: string, c: boolean, d?: string) => {
  total++;
  if (check(n, c, d)) pass++;
};

console.log('=== 断言 ===');
t('空文本被跳过（共 6 条而不是 7 条）', srt.includes('\n6\n') || srt.startsWith('1\n'), '');
const blockCount = srt.trim().split(/\n\n+/).length;
t('块数 = 6', blockCount === 6, `实际 ${blockCount}`);
t('时间格式带逗号毫秒', /00:00:01,955 --> 00:00:03,500/.test(srt));
t('双语顺序：原文在上', /Hello there\.\n你好啊/.test(srt));
t('无译文只出原文', /Just English here\.\n\n/.test(srt) || /Just English here\.\n/.test(srt));
t('毫秒进位：11.9995 → 00:00:12,000', srt.includes('00:00:12,000'), srt.match(/00:00:12,\d{3}/)?.[0] ?? '');
t('跨小时：3725.5 → 01:02:05,500', srt.includes('01:02:05,500'));
t('native 也当译文用', /Native fallback\.\n自带译文/.test(srt));
t('以换行结尾', srt.endsWith('\n'));

console.log('\n=== SRT（译文在上）===\n');
const srtZh = buildSrt(cues, { order: 'native-first' });
console.log(srtZh.split('\n\n').slice(0, 2).join('\n\n'));
t('译文在上', /你好啊\nHello there\./.test(srtZh));

console.log('\n=== SRT（跳过无译文）===\n');
const srtStrict = buildSrt(cues, { emptyTranslation: 'skip' });
t('无译文整条跳过', !srtStrict.includes('Just English here.'));
const strictCount = srtStrict.trim().split(/\n\n+/).length;
t('跳过之后剩 5 条', strictCount === 5, `实际 ${strictCount}`);

console.log('\n=== VTT ===\n');
const vtt = buildVtt(cues);
console.log(vtt.split('\n').slice(0, 6).join('\n'));
t('以 WEBVTT 开头', vtt.startsWith('WEBVTT'));
t('时间用点不用逗号', /00:00:01\.955 --> 00:00:03\.500/.test(vtt));

console.log('\n=== 文件名推导 ===');
t('xxx.srt → xxx.双语.srt', deriveName('海边的曼彻斯特.srt') === '海边的曼彻斯特.双语.srt', deriveName('海边的曼彻斯特.srt'));
t('xxx.ass → xxx.双语.vtt', deriveName('a.ass', 'vtt') === 'a.双语.vtt', deriveName('a.ass', 'vtt'));
t('无名称给默认', deriveName(undefined) === 'replay-双语.srt', deriveName(undefined));

console.log(`\n结果: ${pass}/${total} 通过`);
process.exit(pass === total ? 0 : 1);
