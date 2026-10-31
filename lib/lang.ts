/** 语言判定与双语字幕拆分，srt / ass 解析器共用。 */

/** 汉字 + 假名 + 谚文，统称「东亚文字」 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/**
 * 假名。
 * 只要有平假名或片假名，基本可以断定是日语——
 * 日语也会有纯汉字句（「大丈夫」），那种只能靠上下文，这里按中文处理也说得过去。
 */
const KANA = /[\u3040-\u309f\u30a0-\u30ff]/;

/** 谚文（韩语） */
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff]/;

/**
 * 日语判定。
 * 必须在 looksChinese 之前判——否则「そうは思わない」因为含汉字/假名
 * 会被当成中文，双语字幕的原文和译文就反了。
 */
export function looksJapanese(s: string): boolean {
  return KANA.test(s);
}

export function looksKorean(s: string): boolean {
  return HANGUL.test(s);
}

/**
 * 字幕组署名、站点、免责声明。这些不是台词，不该进学习列表。
 * 只在「整行基本就是这个」的时候才该命中，所以下面还有长度兜底。
 */
const JUNK_RE =
  /(zimuzu|yyets|yts\b|人人影视|人人字幕|字幕组|字幕社|字幕由|原创翻译|双语字幕|字幕下载|翻译\s*[:：]|校对\s*[:：]|时间轴\s*[:：]|特效\s*[:：]|后期\s*[:：]|压制\s*[:：]|监制\s*[:：]|仅供学习|禁止|版权|www\.|https?:\/\/|\.com\b|\.tv\b|\.net\b|\.org\b|关注公众号|微信公众号|微信群|qq群|QQ群|更多资源|更多字幕|请登陆|请登录|招募)/i;

/** 判断一整行是不是字幕组信息 */
export function isJunkLine(line: string): boolean {
  const s = line.trim();
  if (!s) return true;
  // 纯符号 / 纯标点，例如 “♪♪”“。。。”
  if (!/[a-zA-Z0-9\u4e00-\u9fff]/.test(s)) return true;
  if (JUNK_RE.test(s)) return true;
  return false;
}

/**
 * 音效 / 音乐描述，不需要翻译。
 *
 *   [music continues]  [laughing, talking indistinctly]  ♪ ♪
 *
 * 这些翻成中文没有意义，中文观众看到的也是「[音乐]」。
 * 剧集字幕里这类能占三成，全送去翻译纯属烧时间和 token。
 *
 * 注意只匹配「整句被括号包住」的情况：
 *   Man: [indistinctly] ...this guy across the bar
 * 这种带台词的不算，照常翻。
 */
export function isSoundCue(line: string): boolean {
  const s = line.trim();
  if (!s) return true;
  if (/^[[(（【][^[\])）】]*[\])）】]$/.test(s)) return true;
  if (/^[♪♫♬\s.·…-]+$/.test(s)) return true;
  return false;
}

/** 至少两个连续拉丁字母才算英文行，避免被 "OK" 这种词带偏 */
export function looksEnglish(s: string): boolean {
  return /[a-zA-Z]{2,}/.test(s) && !CJK.test(s);
}

/** 中文行：含东亚文字，且不是日语、不是韩语 */
export function looksChinese(s: string): boolean {
  return CJK.test(s) && !KANA.test(s) && !HANGUL.test(s);
}

/**
 * 把一条字幕里的多行拆成「主文本 + 中文行」。
 *
 * 现实中的双语字幕，原文和译文先后不固定：
 *   -听着  -我爸爸
 *   - Listen. Shh. - My daddy--
 *   そうは思わない
 *   我可不这么想
 *
 * 原文可能是英语、日语、韩语——只要不是中文，就当原文。
 * 拆开之后，主文本用来精听，中文行可以单独开关，互不干扰。
 */
export function splitBilingual(lines: string[]): {
  text: string;
  native?: string;
} {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0) return { text: '' };
  if (clean.length === 1) return { text: clean[0] };

  const src: string[] = [];
  const zh: string[] = [];
  const mixed: string[] = [];

  for (const line of clean) {
    // 顺序要紧：日/韩要在「中文」之前判，否则会被当成中文
    if (looksEnglish(line) || looksJapanese(line) || looksKorean(line)) src.push(line);
    else if (looksChinese(line)) zh.push(line);
    else mixed.push(line);
  }

  if (src.length > 0 && zh.length > 0) {
    return {
      text: [...src, ...mixed].join(' ').trim(),
      native: zh.join(' ').trim(),
    };
  }

  return { text: clean.join(' ') };
}
