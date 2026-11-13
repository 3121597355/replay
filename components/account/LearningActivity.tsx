'use client';
import { useEffect, useState } from 'react';
export default function LearningActivity({ enabled, review = false }: { enabled: boolean; review?: boolean }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let seconds = 0, previous = performance.now(), interaction = Date.now(), lastSend = Date.now(), stopped = false;
    const send = (action = '') => {
      const amount = Math.min(60, Math.floor(seconds));
      if (stopped || (!amount && !action)) return;
      seconds -= amount;
      const body = JSON.stringify({ eventId: crypto.randomUUID(), seconds: amount, action });
      async function request(attempt = 0): Promise<void> {
        try {
          const response = await fetch('/api/account/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
          if (response.status === 401) { stopped = true; setExpired(true); window.dispatchEvent(new Event('replay:account-updated')); }
          else if (response.status >= 500) throw new Error();
        } catch { if (attempt === 0) setTimeout(() => void request(1), 1500); }
      }
      void request(); lastSend = Date.now();
    };
    const touch = () => { interaction = Date.now(); };
    const action = (event: Event) => {
      touch();
      const name = (event as CustomEvent<string>).detail;
      const mapped: Record<string, string> = { learning_start: 'play', word_save: 'save', cue_save: 'save', loop_enable: 'loop', review_complete: 'review' };
      if (mapped[name]) send(mapped[name]);
    };
    const tick = () => {
      const now = performance.now(), delta = Math.min(2, Math.max(0, (now - previous) / 1000)); previous = now;
      const video = document.querySelector('video');
      const active = review ? Date.now() - interaction < 60000 : video && !video.paused && !video.ended && video.readyState >= 2;
      if (document.visibilityState === 'visible' && active) seconds += delta;
      if (Date.now() - lastSend >= 20000) send();
    };
    const hide = () => { if (document.visibilityState === 'hidden') send(); previous = performance.now(); };
    const leave = () => send();
    const timer = setInterval(tick, 1000);
    window.addEventListener('replay:learning-action', action); window.addEventListener('pointerdown', touch, { passive: true }); window.addEventListener('keydown', touch); window.addEventListener('pagehide', leave); document.addEventListener('visibilitychange', hide);
    return () => { clearInterval(timer); send(); window.removeEventListener('replay:learning-action', action); window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch); window.removeEventListener('pagehide', leave); document.removeEventListener('visibilitychange', hide); };
  }, [enabled, review]);
  return expired ? <div className="account-inline-note" role="status">登录已过期，本地内容仍然保留。<a href="/login?returnTo=%2Flearn">重新登录，继续保存学习天数 →</a></div> : null;
}
