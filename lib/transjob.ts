/**
 * 翻译任务：模块级单例。
 *
 * 之前翻译写在组件里，用户切到别的页面 → 组件卸载 →
 * fetch 其实还在跑、缓存也在写，但界面上什么都看不到，
 * 回来还得重新导入字幕才知道翻到哪了。
 *
 * 挪到模块作用域之后：任务不受组件生死影响，组件只是订阅者。
 * 关掉标签页才会真的中断——真要跨会话续跑，靠的是翻译缓存。
 */
import { translateCues, type TranslateConfig, type TranslateOutcome } from './translate';
import { mergeCache } from './transcache';
import type { Cue } from './types';

export type JobStatus = 'running' | 'done' | 'aborted';

export interface TransJob {
  hash: string;
  name: string;
  /** 已处理的句数（不是成功数，失败的也算处理过） */
  done: number;
  total: number;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  ok: number;
  failed: number;
  skipped: number;
  error?: string;
}

let current: TransJob | null = null;
const listeners = new Set<() => void>();

function emit() {
  // Set 不能直接 for-of 遍历（target 低于 es2015 时），用 forEach
  listeners.forEach((fn) => fn());
}

/** 给 useSyncExternalStore 用 */
export function subscribeJob(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 快照。每次变化都换新对象，保证引用相等判断有效。 */
export function getJob(): TransJob | null {
  return current;
}

export function isRunning(): boolean {
  return current?.status === 'running';
}

/** 用户手动中止。当前批次会跑完，后续批次不再发。 */
let abortRequested = false;
export function abortJob() {
  if (current?.status === 'running') abortRequested = true;
}

/**
 * 启动翻译。
 *
 * 返回 outcome 时说明跑完了；返回 null 说明已有任务在跑，这次没启动。
 * 调用方即使组件已卸载也不影响这里继续执行。
 */
export async function startJob(
  cues: Cue[],
  cfg: TranslateConfig,
  hash: string,
  name: string
): Promise<TranslateOutcome | null> {
  if (current?.status === 'running') return null;
  abortRequested = false;

  const pending = cues.filter((c) => !c.translation && !c.native);

  current = {
    hash,
    name,
    done: 0,
    total: pending.length,
    status: 'running',
    startedAt: Date.now(),
    ok: 0,
    failed: 0,
    skipped: 0,
  };
  emit();

  const out = await translateCues(
    pending,
    cfg,
    (done, total) => {
      if (current?.status !== 'running') return;
      current = { ...current, done, total };
      emit();
    },
    (items) => {
      // 每批立刻落盘，中途关页面也不白翻
      mergeCache(hash, name, cfg.model, items);
    }
  );

  // 跑完再整体写一次，补齐逐批可能漏掉的
  const items = out.cues
    .filter((c) => c.translation)
    .map((c) => [c.id, c.translation as string] as [number, string]);
  if (items.length > 0) mergeCache(hash, name, cfg.model, items);

  current = {
    ...current,
    status: abortRequested ? 'aborted' : 'done',
    finishedAt: Date.now(),
    ok: out.ok,
    failed: out.failed,
    skipped: out.skipped,
    error: out.error,
  };
  emit();

  return out;
}

/** 清掉任务记录（切字幕时用，避免旧任务的进度串到新字幕上） */
export function resetJob() {
  if (current?.status === 'running') return; // 正在跑就别抹掉
  current = null;
  emit();
}
