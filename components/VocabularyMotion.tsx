'use client';

import { useSyncExternalStore } from 'react';

const key = 'replay-vocab-motion';
const changed = 'replay:vocab-motion';
let fallback: boolean | undefined;
function snapshot() {
  if (fallback !== undefined) return fallback;
  try { return localStorage.getItem(key) !== 'off'; } catch { return true; }
}
function subscribe(notify: () => void) {
  const storageChanged = (event: StorageEvent) => { if (event.key === key || event.key === null) { fallback = undefined; notify(); } };
  window.addEventListener(changed, notify);
  window.addEventListener('storage', storageChanged);
  return () => { window.removeEventListener(changed, notify); window.removeEventListener('storage', storageChanged); };
}
export function useVocabularyMotion() {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
export default function VocabularyMotionToggle() {
  const enabled = useVocabularyMotion();
  function toggle() {
    const next = !enabled;
    try { localStorage.setItem(key, next ? 'on' : 'off'); fallback = undefined; } catch { fallback = next; }
    window.dispatchEvent(new Event(changed));
  }
  return <button type="button" className="vocab-motion-toggle" role="switch" aria-checked={enabled} aria-label="卡片翻转动画" onClick={toggle} title={enabled ? '关闭卡片翻转动画，直接显示释义' : '开启卡片翻转动画'}>翻转动画：{enabled ? '开' : '关'}</button>;
}
