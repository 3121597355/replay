import { analyticsConfig } from './analytics-config';

export type AnalyticsEvent = 'sample_ready' | 'video_import' | 'subtitle_import' | 'learning_start' | 'word_lookup' | 'word_save' | 'cue_save' | 'export_anki' | 'export_srt' | 'export_vtt' | 'download_import' | 'sample_error' | 'video_error' | 'loop_enable';

/** Fixed event names only: never send words, subtitles, filenames or API settings. */
export function trackEvent(name: AnalyticsEvent) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('replay:learning-action', { detail: name }));
  if (typeof window === 'undefined' || navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl || /^\/(admin|api)(\/|$)/.test(location.pathname)) return;
  let config; try { config = analyticsConfig({ endpoint: process.env.NEXT_PUBLIC_YILAN_COLLECTOR_URL ?? 'https://yilan-collector.yilan-public-collector.workers.dev', siteId: process.env.NEXT_PUBLIC_YILAN_WEBSITE_ID }); } catch { return; }
  if (!config) return;
  try { (window as Window & { __replayEngagementRecord?: (name: string) => void }).__replayEngagementRecord?.(name); } catch { /* Metrics never block learning. */ }
  const endpoint = new URL('/collect', config.src);
  const body = JSON.stringify({ id: config.siteId, eventId: crypto.randomUUID(), type: 'event', name, path: location.pathname.slice(0, 300) });
  // Retry the same ID; collection is idempotent. Analytics never blocks learning.
  async function send(attempt = 0): Promise<void> {
    try { const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, credentials: 'omit', keepalive: true }); if (response.status >= 500) throw new Error('unavailable'); }
    catch { if (attempt < 2) setTimeout(() => void send(attempt + 1), 800 * (attempt + 1)); }
  }
  void send();
}
