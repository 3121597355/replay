/**
 * 剧集配对回归测试。
 * 用法：npx tsx scripts/test-pairing.ts
 *
 * 用例来自真实片源：人人影视的双语包、Netflix 的 WEB-DL、
 * 以及 H 盘那些命名各异的文件。
 */
import {
  episodeKey,
  guessLanguage,
  kindOf,
  pairEpisodes,
  type MediaFile,
} from '../lib/pairing';

let pass = 0;
let total = 0;
function t(name: string, got: unknown, want: unknown) {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  console.log(`  ${ok ? '✓' : '★'} ${name}${ok ? '' : `\n      期望 ${JSON.stringify(want)}\n      实际 ${JSON.stringify(got)}`}`);
}

console.log('=== 集数识别 ===');
t('S01E01', episodeKey('Friends.S01E01.720p.mkv'), 's01e01');
t('小写 s1e2', episodeKey('friends.s1e2.mkv'), 's01e02');
t('带点分隔', episodeKey('Show.S01.E02.mkv'), 's01e02');
t('1x01', episodeKey('Breaking.Bad.1x01.mkv'), 's01e01');
t('EP03', episodeKey('SomeShow EP03.mkv'), 'e03');
t('E05', episodeKey('Show-E05.srt'), 'e05');
t('第3集', episodeKey('海贼王 第3集.mkv'), 'e03');
t('第 12 话', episodeKey('某番 第 12 话.ass'), 'e12');
t('电影（无集数）', episodeKey('Manchester.by.the.Sea.2016.720p.mkv'), 'manchester.by.the.sea.2016.720p');
t('中文电影名', episodeKey('海边的曼彻斯特.srt'), '海边的曼彻斯特');
t('电影字幕带语言后缀也算同一个键', episodeKey('Manchester.by.the.Sea.2016.720p.简体&英文.srt'), 'manchester.by.the.sea.2016.720p');
t('叠两层后缀也能剥', episodeKey('Movie.2020.chs.简体.srt'), 'movie.2020');

console.log('\n=== 文件类型 ===');
t('mkv 是视频', kindOf('a.mkv'), 'video');
t('mp4 是视频', kindOf('a.MP4'), 'video');
t('ass 是字幕', kindOf('a.ass'), 'subtitle');
t('srt 是字幕', kindOf('a.srt'), 'subtitle');
t('txt 不是媒体', kindOf('a.txt'), null);
t('无扩展名', kindOf('README'), null);

console.log('\n=== 语言猜测 ===');
t('简体&英文', guessLanguage('xxx.简体&英文.srt'), 'bilingual');
t('简英', guessLanguage('xxx.简英.ass'), 'bilingual');
t('中英双语', guessLanguage('xxx.中英双语.srt'), 'bilingual');
t('chs_eng', guessLanguage('xxx.chs_eng.srt'), 'bilingual');
t('简体', guessLanguage('xxx.简体.srt'), 'zh');
t('chs', guessLanguage('xxx.chs.srt'), 'zh');
t('英文', guessLanguage('xxx.英文.srt'), 'en');
t('en-us（Netflix）', guessLanguage('xxx_1_en-us_cc.srt'), 'en');
t('无标记', guessLanguage('xxx.srt'), 'unknown');

console.log('\n=== 配对：人人影视双语包 ===');
const yyets: MediaFile[] = [
  { name: 'Manchester.by.the.Sea.2016.720p.BluRay.x264-GECKOS.mkv', kind: 'video', size: 5000 },
  { name: 'Manchester.by.the.Sea.2016.720p.BluRay.x264-GECKOS.简体&英文.srt', kind: 'subtitle' },
  { name: 'Manchester.by.the.Sea.2016.720p.BluRay.x264-GECKOS.简体.srt', kind: 'subtitle' },
  { name: 'Manchester.by.the.Sea.2016.720p.BluRay.x264-GECKOS.英文.srt', kind: 'subtitle' },
];
{
  const eps = pairEpisodes(yyets);
  t('配成 1 集', eps.length, 1);
  t('挑中双语那条', eps[0].bestLang, 'bilingual');
  t('三条字幕都保留', eps[0].subtitles.length, 3);
}

console.log('\n=== 配对：整季多集 ===');
const season: MediaFile[] = [
  { name: 'Show.S01E01.mkv', kind: 'video', size: 800 },
  { name: 'Show.S01E01.chs.srt', kind: 'subtitle' },
  { name: 'Show.S01E02.mkv', kind: 'video', size: 800 },
  { name: 'Show.S01E02.chs.srt', kind: 'subtitle' },
  { name: 'Show.S01E03.mkv', kind: 'video', size: 800 },
  { name: 'Show.S01E10.mkv', kind: 'video', size: 800 },
  { name: 'Show.S01E10.chs.srt', kind: 'subtitle' },
];
{
  const eps = pairEpisodes(season);
  t('配成 4 集', eps.length, 4);
  t('按集数升序', eps.map((e) => e.label), ['S01E01', 'S01E02', 'S01E03', 'S01E10']);
  t('E03 有视频没字幕', eps[2].video?.name, 'Show.S01E03.mkv');
  t('E03 best 为空', eps[2].best, undefined);
  t('E10 配上了', eps[3].best?.name, 'Show.S01E10.chs.srt');
}

console.log('\n=== 配对：同集多视频取大的 ===');
{
  const eps = pairEpisodes([
    { name: 'Ep01.mp4', kind: 'video', size: 700 },
    { name: 'Ep01.mkv', kind: 'video', size: 4200 },
  ]);
  t('留下 mkv', eps[0].video?.name, 'Ep01.mkv');
}

console.log('\n=== 配对：字幕没有对应视频 ===');
{
  const eps = pairEpisodes([
    { name: 'Orphan.S02E05.chs.srt', kind: 'subtitle' },
  ]);
  t('仍然成组', eps.length, 1);
  t('video 为空', eps[0].video, undefined);
  t('字幕在', eps[0].best?.name, 'Orphan.S02E05.chs.srt');
}

console.log('\n=== 配对：非媒体文件不参与 ===');
{
  // kindOf 负责过滤，pairEpisodes 只处理已经归好类的
  t('txt 的 kindOf 为 null', kindOf('info.txt'), null);
  t('nfo 的 kindOf 为 null', kindOf('movie.nfo'), null);

  // 模拟真实流程：先按 kindOf 过滤，再交给 pairEpisodes
  const raw = ['Show.S01E01.mkv', 'info.txt', 'movie.nfo', 'Show.S01E01.chs.srt'];
  const files: MediaFile[] = [];
  for (const name of raw) {
    const k = kindOf(name);
    if (k) files.push({ name, kind: k });
  }
  const eps = pairEpisodes(files);
  t('txt/nfo 被过滤掉后只剩 1 集', eps.length, 1);
  t('视频和字幕都进了同一集', [!!eps[0].video, !!eps[0].best], [true, true]);
}

console.log('\n=== 真实场景：Netflix 导出的中文字幕包 ===');
{
  const netflix: MediaFile[] = [
    { name: '欧阳万成：好交易_S01E01_Jimmy O_ Yang_ Good Deal_1_en-us_cc.mkv', kind: 'video' },
    { name: '欧阳万成：好交易_S01E01_Jimmy O_ Yang_ Good Deal_1_en-us_cc.srt', kind: 'subtitle' },
  ];
  const eps = pairEpisodes(netflix);
  t('配成 1 集', eps.length, 1);
  t('识别出 S01E01', eps[0].label, 'S01E01');
  t('字幕标为英文', eps[0].bestLang, 'en');
}

console.log(`\n结果: ${pass}/${total} 通过`);
process.exit(pass === total ? 0 : 1);
