import { engagementTrackerSource } from './engagement-tracker.mjs';
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
  const storageKey = 'replay:traffic-session:v1';
  let session;
  function refreshSession() { if (id === 'replay') try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey));
    if (/^[\w-]{16,80}$/.test(stored?.id || '') && Number.isInteger(stored.pageIndex) && stored.pageIndex >= 0
      && stored.pageIndex < 100000 && Number.isFinite(stored.lastActivity) && stored.lastActivity <= Date.now()) session = stored;
  } catch {} }
  refreshSession();
  const expired = () => !session || Date.now() - session.lastActivity >= 1800000 || session.pageIndex >= 100000;
  function touch() {
    if (!session || id !== 'replay') return;
    session.lastActivity = Date.now();
    try { sessionStorage.setItem(storageKey, JSON.stringify(session)); } catch {}
  }
  function association() {
    if (id !== 'replay') return {};
    if (expired()) session = { id: eventId(), lastActivity: Date.now(), pageIndex: 0 };
    session.pageIndex++; touch();
    return { sessionId: session.id, pageIndex: session.pageIndex, activityIndex: session.pageIndex };
  }
  const engagement = (${engagementTrackerSource})({ id, send, touch, restore: linked => {
    session.pageIndex++; touch(); linked.activityIndex = session.pageIndex;
  }, ensureFresh: linked => {
    refreshSession();
    if (document.visibilityState === 'visible' && (expired() || (linked && linked.sessionId !== session?.id))) { track(true); return true; }
    return false;
  } });
  function track(force = false) {
    if (document.visibilityState !== 'visible' || (!force && location.pathname === lastPath)) return;
    refreshSession();
    const rotate = id === 'replay' && session && expired();
    engagement.finish(rotate || force ? 'left' : 'route');
    if (rotate) session = undefined;
    lastPath = location.pathname;
    if (/^\/(admin|api)(\/|$)/.test(lastPath)) return;
    // Only three explicit campaign labels are accepted; arbitrary query strings stay local.
    const utm = {};
    try { const params = new URL(location.href || location.origin + location.pathname).searchParams;
      for (const name of ['source', 'medium', 'campaign']) { const value = params.get('utm_' + name); if (value && /^[\p{L}\p{N} ._\-]{1,100}$/u.test(value)) utm[name] = value; }
    } catch {}
    let referrer = ''; try { referrer = new URL(document.referrer).origin; } catch {}
    const visitId = eventId();
    const linked = association();
    void send(JSON.stringify({ id, eventId: visitId, path: lastPath.slice(0, 300), referrer, utm, ...linked }));
    engagement.start(visitId, lastPath.slice(0, 300), linked);
  }
  document.addEventListener('visibilitychange', () => track());
  addEventListener('popstate', () => track());
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
