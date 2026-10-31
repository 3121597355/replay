/**
 * 从 ECDICT 生成前端用的迷你词典。
 *
 *   输入：_dict/ecdict.csv      66MB，77 万词条，带词频排名和中文释义
 *         _dict/lemma.en.txt    8.4 万组词形归并
 *   输出：public/dict/words.json    高频词 + 中文释义
 *         public/dict/lemma.json    变形 → 原形
 *
 * 只保留词频前 N 的词。剩下的词查不到就走在线词典兜底。
 *
 * 用法：node scripts/build-dict.mjs
 */
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DICT = path.join(ROOT, '_dict', 'ecdict.csv');
const SRC_LEMMA = path.join(ROOT, '_dict', 'lemma.en.txt');
const OUT_DIR = path.join(ROOT, 'public', 'dict');

/** 保留到第几档词频。10000 大致覆盖日常对话的 95%。 */
const MAX_FRQ = 12000;
/** 额外保证收录的考试纲词，超出词频范围也要。 */
const KEEP_TAGS = ['zk', 'gk', 'cet4', 'cet6'];

/** 释义里的学科噪音，看剧时用不上。 */
const NOISE = /^\[?(计|网络|医|化|物|数|法|商|机|电子|航|生物|地质|气象|农|兽医|冶|矿|纺|印|建|军|体育|音乐|美|摄|戏|心|逻|修辞|律)\]/;

/**
 * 中文释义清理。
 * 原始格式可能是 "v. 是, 表示\n[计] 后端" —— 换行有两种存法，都要处理。
 */
function cleanTranslation(raw) {
  if (!raw) return [];
  const lines = raw
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const kept = [];
  for (const line of lines) {
    if (NOISE.test(line)) continue;
    // 去掉残留的领域标记前缀
    const clean = line.replace(/^\[[^\]]*\]\s*/, '').trim();
    if (!clean || clean.length > 150) continue;
    if (!/[a-z]{2,}/i.test(clean) && !/[\u4e00-\u9fa5]/.test(clean)) continue;
    kept.push(clean);
    if (kept.length >= 3) break;
  }
  return kept;
}

/**
 * 音标修正。
 * ECDICT 是老词库，用的是西里尔字母 ә (U+04D9) 和撇号 ' 表示重音，
 * 直接显示会花屏，换成标准 IPA。
 */
function cleanPhonetic(raw) {
  if (!raw) return '';
  return raw
    .replace(/\u04d9/g, '\u0259') // ә → ə  西里尔 schwa 换成正牌 IPA
    .replace(/\u04d0/g, '\u0250') // Ӑ → ɐ
    .replace(/\u0259u/g, '\u0259\u028a') // əu → əʊ 双元音要连写
    .replace(/:/g, '\u02d0') // : → ː 长音符
    .replace(/'/g, '\u02c8') // ' → ˈ 主重音
    .trim();
}

/** 极简 CSV 行解析，支持引号内的逗号和转义引号。 */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function readLemma() {
  const rl = createInterface({ input: createReadStream(SRC_LEMMA, 'utf8'), crlfDelay: Infinity });
  /** variant -> { base, freq }，同形冲突保留词频高的那个 */
  const map = new Map();
  for await (const line of rl) {
    if (!line || line.startsWith(';')) continue;
    const m = line.match(/^([^/]+)\/(\d+)\s*->\s*(.+)$/);
    if (!m) continue;
    const [, base, freqStr, variants] = m;
    const freq = Number(freqStr);
    for (const raw of variants.split(',')) {
      const v = raw.trim().toLowerCase();
      if (!v || v === base) continue;
      const prev = map.get(v);
      if (!prev || freq > prev.freq) map.set(v, { base, freq });
    }
  }
  return map;
}

async function readDict() {
  const rl = createInterface({ input: createReadStream(SRC_DICT, 'utf8'), crlfDelay: Infinity });
  /** word -> { p, c, f } */
  const words = new Map();
  let headerSkipped = false;
  let scanned = 0;

  for await (const line of rl) {
    if (!headerSkipped) {
      headerSkipped = true;
      continue;
    }
    scanned++;
    // 跨行字段先不处理：ECDICT 把换行转义成了 \n，行不会真的断
    const f = parseCsvLine(line);
    if (f.length < 11) continue;

    const word = (f[0] || '').trim();
    const phonetic = (f[1] || '').trim();
    const translation = f[3] || '';
    const tag = f[7] || '';
    const frq = Number(f[9]) || 0;

    if (!word || !/^[a-zA-Z][a-zA-Z'-]*$/.test(word)) continue;
    if (word.length < 1 || word.length > 24) continue;

    const isHighFreq = frq > 0 && frq <= MAX_FRQ;
    const isExamWord = KEEP_TAGS.some((t) => tag.split(' ').includes(t));
    if (!isHighFreq && !isExamWord) continue;

    const defs = cleanTranslation(translation);
    if (defs.length === 0) continue;

    const key = word.toLowerCase();
    const prev = words.get(key);
    // 同一个词可能有多条（大小写变体），保留词频更好的
    if (prev && prev.f > 0 && (frq === 0 || prev.f <= frq)) continue;

    const entry = { c: defs, f: frq || 999999 };
    const ipa = cleanPhonetic(phonetic);
    if (ipa) entry.p = ipa;
    words.set(key, entry);
  }
  return { words, scanned };
}

async function main() {
  console.log('读取 lemma.en.txt …');
  const lemmaMap = await readLemma();
  console.log(`  词形映射 ${lemmaMap.size} 条`);

  console.log('读取 ecdict.csv …');
  const { words, scanned } = await readDict();
  console.log(`  扫描 ${scanned} 行，收录 ${words.size} 个词`);

  // lemma 只保留「变形本身没被收录」的，词典里已有的词不需要绕一圈
  const lemma = {};
  let lemmaKept = 0;
  for (const [variant, info] of lemmaMap) {
    if (words.has(variant)) continue;
    if (!words.has(info.base)) continue;
    lemma[variant] = info.base;
    lemmaKept++;
  }
  console.log(`  精简后 lemma ${lemmaKept} 条`);

  await mkdir(OUT_DIR, { recursive: true });

  const wordsJson = JSON.stringify(
    Object.fromEntries([...words.entries()].sort((a, b) => a[0].localeCompare(b[0])))
  );
  const lemmaJson = JSON.stringify(lemma);

  await writeFile(path.join(OUT_DIR, 'words.json'), wordsJson, 'utf8');
  await writeFile(path.join(OUT_DIR, 'lemma.json'), lemmaJson, 'utf8');

  const mb = (s) => (Buffer.byteLength(s, 'utf8') / 1024 / 1024).toFixed(2);
  console.log(`\n输出：`);
  console.log(`  words.json  ${mb(wordsJson)} MB`);
  console.log(`  lemma.json  ${mb(lemmaJson)} MB`);

  // 抽查几个
  const probe = ['hello', 'think', 'robbery', 'understand', 'weird', 'ghost'];
  console.log('\n抽查：');
  for (const w of probe) {
    const e = words.get(w);
    console.log(`  ${w.padEnd(12)} ${e ? `${e.p ?? '-'}  ${e.c.join(' / ').slice(0, 60)}` : '（未收录）'}`);
  }
  console.log('\n变形抽查：');
  for (const v of ['went', 'children', 'running', 'thought', 'robberies']) {
    console.log(`  ${v.padEnd(12)} → ${lemma[v] ?? (words.has(v) ? '（本身就是词条）' : '（查不到）')}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
