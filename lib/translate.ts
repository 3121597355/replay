import type { Cue } from './types';
import { isSoundCue } from './lang';

export interface TranslateConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_CONFIG: TranslateConfig = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
};

const STORAGE_KEY = 'replay.translate.config';

export function loadConfig(): TranslateConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: TranslateConfig) {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    return true;
  } catch {
    return false;
  }
}

/**
 * 翻译提示词。
 * 不写死源语言——英语、日语、韩语都能进来，让模型自己认。
 * 硬编码「英文字幕」会导致日语字幕被当成英文处理。
 */
const SYSTEM_PROMPT = `你是一个语言学习助手。用户会给你一批带编号的字幕（可能是英语、日语、韩语等，也可能是多种语言混在一起）。

请对每一条：
1. 识别它是什么语言，然后翻译成自然、口语化的简体中文（不要逐字直译）
   - 如果这一条本身已经是中文，原样返回
   - 如果是音效描述（如 "[music]"、"[笑]"），保持原样返回
2. 挑出 0-2 个中国学习者容易卡住的词或短语，给出简短中文释义
   - 日语请给出假名读音，例如 {"word":"大丈夫","hint":"だいじょうぶ · 没关系"}

严格只输出 JSON 数组，不要任何解释和 markdown 代码块。格式：
[{"i":0,"translation":"中文翻译","words":[{"word":"原词","hint":"中文释义"}]}]`;

/** 每批多少条。太大输出会截断，太小请求次数多。32 是实测的平衡点。 */
const BATCH = 32;
/**
 * 同时跑几批。
 * 串行跑 2260 句要七分多钟；并发 4 能压到一分钟出头。
 * 再往上容易撞限流，反而更慢。
 */
const CONCURRENCY = 4;
/** 失败重试次数（配置类错误不重试） */
const RETRIES = 2;
const RETRY_BASE_MS = 900;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TranslateOutcome {
  cues: Cue[];
  /** 成功翻译的条数 */
  ok: number;
  /** 失败批次的条数 */
  failed: number;
  /** 跳过的音效行条数 */
  skipped: number;
  /** 最后一次失败的原因，用于界面上告诉用户到底哪儿错了 */
  error?: string;
}

interface BatchItem {
  i: number;
  translation: string;
  words?: { word: string; hint: string }[];
}

/** 发一批，拿回解析好的结果。失败就抛。 */
async function requestBatch(batch: Cue[], cfg: TranslateConfig): Promise<BatchItem[]> {
  if (!cfg.apiKey) throw new Error('没有 API Key');

  const payload = batch.map((c, idx) => ({ i: idx, text: c.text }));

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.3,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const brief = detail.slice(0, 120).replace(/\s+/g, ' ');
    const err = new Error(`${res.status} ${res.statusText}${brief ? ` · ${brief}` : ''}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  const json = await res.json();
  const content: string = json.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error('接口返回空内容');

  const cleaned = content.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned) as BatchItem[];
  } catch {
    throw new Error('返回内容不是合法 JSON（可能被截断了）');
  }
}

/**
 * 带重试的请求。
 * 401 / 403 是 key 或地址写错，重试没意义；
 * 429 是限流，要等久一点；其余按指数退避。
 */
async function requestWithRetry(
  batch: Cue[],
  cfg: TranslateConfig,
  attempt = 0
): Promise<BatchItem[]> {
  try {
    return await requestBatch(batch, cfg);
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status === 401 || status === 403) throw err;
    if (attempt >= RETRIES) throw err;

    const wait =
      status === 429 ? 2500 * (attempt + 1) : RETRY_BASE_MS * Math.pow(2, attempt);
    await sleep(wait);
    return requestWithRetry(batch, cfg, attempt + 1);
  }
}

/**
 * 并发跑一批任务，同时最多 limit 个。
 * 返回顺序与输入一致。
 */
async function runPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * 批量翻译。
 *
 * 三件事让它比串行快七八倍：
 *   1. 音效行根本不发——剧集字幕里这类能占三成
 *   2. 每批 32 条，请求数砍掉近三分之一
 *   3. 四批并发
 *
 * 返回新数组，不改传入的对象。onBatch 每成功一批就回调，
 * 调用方可以立刻落盘。
 */
export async function translateCues(
  cues: Cue[],
  cfg: TranslateConfig,
  onProgress?: (done: number, total: number) => void,
  onBatch?: (items: [number, string][]) => void
): Promise<TranslateOutcome> {
  const result = cues.map((c) => ({ ...c }));

  // 音效行不翻：既不消耗请求，也不算失败
  const targets = cues.filter((c) => !isSoundCue(c.text));
  const skipped = cues.length - targets.length;

  if (targets.length === 0) {
    return { cues: result, ok: 0, failed: 0, skipped };
  }

  // id → 在 result 里的下标，避免每批都全表扫
  const indexOf = new Map<number, number>();
  cues.forEach((c, i) => indexOf.set(c.id, i));

  const batches: Cue[][] = [];
  for (let i = 0; i < targets.length; i += BATCH) {
    batches.push(targets.slice(i, i + BATCH));
  }

  let done = 0;
  let ok = 0;
  let failed = 0;
  let lastError: string | undefined;

  await runPool(batches, CONCURRENCY, async (batch) => {
    try {
      const parsed = await requestWithRetry(batch, cfg);
      const landed: [number, string][] = [];

      for (const item of parsed) {
        const cue = batch[item.i];
        if (!cue || !item.translation) continue;
        const idx = indexOf.get(cue.id);
        if (idx === undefined) continue;
        result[idx] = {
          ...result[idx],
          translation: item.translation,
          words: item.words ?? [],
        };
        landed.push([cue.id, item.translation]);
        ok++;
      }

      if (landed.length > 0) onBatch?.(landed);
    } catch (err) {
      failed += batch.length;
      lastError = err instanceof Error ? err.message : String(err);
      console.warn('翻译批次失败', err);
    } finally {
      done += batch.length;
      onProgress?.(done, targets.length);
    }
  });

  return { cues: result, ok, failed, skipped, error: lastError };
}

/** 发一条最小请求，验证 baseUrl / key / model 三者能不能通 */
export async function testConfig(
  cfg: TranslateConfig
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!cfg.apiKey) return { ok: false, error: '还没填 API Key' };
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'say ok' }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        ok: false,
        error: `${res.status} ${res.statusText}${detail ? ` · ${detail.slice(0, 100).replace(/\s+/g, ' ')}` : ''}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '网络请求失败',
    };
  }
}
