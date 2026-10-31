/**
 * 本地迷你词典。
 *
 * 数据来自 ECDICT（MIT），构建脚本见 scripts/build-dict.mjs。
 * 收录 11352 个高频词 + 15843 条词形归并，共约 1.3MB。
 * 没收录的词走「查不到」态，UI 上如实说明，不假装有。
 */

export interface DictEntry {
  /** 音标 */
  p?: string;
  /** 中文释义，最多 3 条 */
  c: string[];
  /** 词频排名，越小越高频 */
  f: number;
}

interface DictData {
  words: Record<string, DictEntry>;
  lemma: Record<string, string>;
}

let pending: Promise<DictData> | null = null;
let loaded: DictData | null = null;

/** 首次调用触发下载，之后走缓存。 */
export function loadDict(): Promise<DictData> {
  if (loaded) return Promise.resolve(loaded);
  if (!pending) {
    pending = Promise.all([
      fetch('/dict/words.json').then((r) => r.json()),
      fetch('/dict/lemma.json').then((r) => r.json()),
    ])
      .then(([words, lemma]) => {
        loaded = { words, lemma };
        return loaded;
      })
      .catch((e) => {
        pending = null;
        throw e;
      });
  }
  return pending;
}

export function isDictReady() {
  return loaded !== null;
}

export interface LookupResult {
  /** 用户点的那个词，原样 */
  query: string;
  /** 实际查到的词条 */
  headword: string;
  entry: DictEntry;
  /** 点了变形（went）查到原形（go）时为 true */
  viaLemma: boolean;
}

/**
 * 规则还原，给词典和 lemma 表都没覆盖的词兜底。
 * 只负责合理猜测，查不到就认输。
 */
function ruleReduce(w: string): string[] {
  const out: string[] = [];

  if (w.endsWith('ies') && w.length > 4) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ves') && w.length > 4) out.push(w.slice(0, -3) + 'f', w.slice(0, -3) + 'fe');
  if (w.endsWith('es') && w.length > 3) out.push(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) out.push(w.slice(0, -1));

  if (w.endsWith('ied') && w.length > 4) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ed') && w.length > 3) {
    out.push(w.slice(0, -2));
    out.push(w.slice(0, -1)); // liked → like
    if (w.length > 4 && w[w.length - 3] === w[w.length - 4]) out.push(w.slice(0, -3)); // stopped → stop
  }

  if (w.endsWith('ing') && w.length > 4) {
    out.push(w.slice(0, -3));
    out.push(w.slice(0, -3) + 'e'); // making → make
    if (w.length > 5 && w[w.length - 4] === w[w.length - 5]) out.push(w.slice(0, -4)); // running → run
  }

  if (w.endsWith('ly') && w.length > 4) out.push(w.slice(0, -2));
  if (w.endsWith('er') && w.length > 4) out.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('est') && w.length > 5) out.push(w.slice(0, -3), w.slice(0, -2));

  return out.filter((x) => x.length >= 2 && x !== w);
}

/** 去掉首尾标点，只剩字母（保留词内的 ' 和 -）。 */
export function normalizeWord(raw: string): string {
  return raw.toLowerCase().replace(/^[^a-z]+/, '').replace(/[^a-z'-]+$/, '');
}

export async function lookup(rawWord: string): Promise<LookupResult | null> {
  const w = normalizeWord(rawWord);
  if (!w) return null;

  const { words, lemma } = await loadDict();

  const direct = words[w];
  if (direct) return { query: w, headword: w, entry: direct, viaLemma: false };

  const base = lemma[w];
  if (base && words[base]) {
    return { query: w, headword: base, entry: words[base], viaLemma: true };
  }

  for (const cand of ruleReduce(w)) {
    if (words[cand]) return { query: w, headword: cand, entry: words[cand], viaLemma: true };
    const b2 = lemma[cand];
    if (b2 && words[b2]) {
      return { query: w, headword: b2, entry: words[b2], viaLemma: true };
    }
  }

  return null;
}

export interface Token {
  /** 原文片段，包含空格和标点 */
  raw: string;
  /** 可点击时给出的单词 */
  word?: string;
}

/**
 * 把一句英文切成「可点词 + 不可点符号」。
 * 空格单独成 token，方便用 flex-wrap 断行。
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  // 先按「单词 / 非单词」切开，空格保留
  const chunks = text.match(/[A-Za-z][A-Za-z'’-]*|[^A-Za-z]+/g);
  if (!chunks) return [{ raw: text }];

  for (const chunk of chunks) {
    if (/^[A-Za-z]/.test(chunk)) {
      // 末尾的连字符是标点，不该算进单词
      const cleaned = chunk.replace(/[-–—]+$/, '');
      if (cleaned && /[A-Za-z]/.test(cleaned)) {
        out.push({ raw: cleaned, word: cleaned });
        const tail = chunk.slice(cleaned.length);
        if (tail) out.push({ raw: tail });
      } else {
        out.push({ raw: chunk });
      }
    } else {
      out.push({ raw: chunk });
    }
  }
  return out;
}

/** 朗读单词。浏览器自带，不需要任何接口。 */
export function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.85;
  window.speechSynthesis.speak(u);
}
