import { createEngagementTracker } from './engagement-tracker.mjs';
// Shared by the local collector and the independently deployed public collector.
export const trackerSource = String.raw`(() => {
  const script = document.currentScript;
  const id = script && script.dataset.websiteId;
  if (!id || navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return;
  const endpoint = new URL('/collect', script.src).href;
  const key = endpoint + '|' + id;
  window.__yilanTrackers = window.__yilanTrackers || new Set();
  if (window.__yilanTrackers.has(key)) return;
  window.__yilanTrackers.add(key);
  let lastPath;
  function eventId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  }
  async function send(body, attempt = 0, final = false) {
    if (final && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }))) return; } catch {}
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body, credentials: 'omit', keepalive: true,
      });
      if (response.status >= 500) throw new Error('unavailable');
    } catch {
      if (attempt < 2) setTimeout(() => send(body, attempt + 1), 800 * (attempt + 1));
    }
  }
  const engagement = (${createEngagementTracker.toString()})({ id, send });
  function track() {
    if (document.visibilityState !== 'visible' || location.pathname === lastPath) return;
    engagement.finish('route');
    lastPath = location.pathname;
    if (/^\/(admin|api)(\/|$)/.test(lastPath)) return;
    // Only the path is sent. Query strings, fragments, titles and user content stay local.
    let referrer = ''; try { referrer = new URL(document.referrer).origin; } catch {}
    const visitId = eventId();
    void send(JSON.stringify({ id, eventId: visitId, path: lastPath.slice(0, 300), referrer }));
    engagement.start(visitId, lastPath.slice(0, 300));
  }
  document.addEventListener('visibilitychange', track);
  addEventListener('popstate', track);
  addEventListener('pageshow', () => track());
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      track();
      return result;
    };
  }
  track();
})();`;
