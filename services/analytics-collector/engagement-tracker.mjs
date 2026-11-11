// Keep browser source literal: Worker bundlers may inject closure helpers into
// function.toString(), which are unavailable in the separate tracker.js response.
// Page IDs live in memory; a short-lived session ID links same-tab navigation.
export const engagementTrackerSource = String.raw`function createEngagementTracker({ id, send, touch, restore, ensureFresh }) {
  if (id !== 'replay') return { start() {}, finish() {} };
  let current;
  let internalNavigationAt = -Infinity;
  const clock = () => performance.now();
  function tick() {
    if (!current) return;
    const now = clock();
    const elapsed = Math.max(0, now - current.tick);
    if (current.state === 'active' && elapsed <= 30000) current.activeMs += elapsed;
    current.tick = now;
  }
  function snapshot(state, final = false) {
    if (!current) return;
    tick();
    if (current.state === 'active' && state !== 'left') touch();
    current.state = state;
    send(JSON.stringify({ id, eventId: current.id, type: 'engagement', path: current.path,
      sequence: ++current.sequence, activeMs: Math.min(86400000, Math.round(current.activeMs)),
      state, flags: current.flags, referrer: current.referrer, ...current.linked }), 0, final);
  }
  function start(visitId, path, linked) {
    internalNavigationAt = -Infinity;
    let referrer = ''; try { referrer = new URL(document.referrer).origin; } catch {}
    current = { id: visitId, path, referrer, linked, activeMs: 0, flags: 0, sequence: 0, tick: clock(), state: 'active' };
    snapshot('active');
  }
  function finish(state = 'route') { snapshot(state, true); current = undefined; }
  document.addEventListener('visibilitychange', () => {
    if (current && document.visibilityState === 'visible' && ensureFresh(current.linked)) return;
    if (!current || current.state === 'left' || current.state === 'route') return;
    snapshot(document.visibilityState === 'visible' ? 'active' : 'hidden', document.visibilityState !== 'visible');
  });
  addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
    try { const url = new URL(anchor.href); if (url.origin === location.origin && url.pathname !== location.pathname) internalNavigationAt = clock(); } catch {}
  });
  addEventListener('pagehide', () => snapshot(clock() - internalNavigationAt < 5000 ? 'route' : 'left', true));
  addEventListener('pageshow', event => {
    // BFCache restores the same page visit and continues its duration, without a new PV.
    if (event.persisted && current) { if (ensureFresh(current.linked)) return; restore(current.linked); internalNavigationAt = -Infinity; snapshot(document.visibilityState === 'visible' ? 'active' : 'hidden'); }
  });
  setInterval(() => { if (current?.state === 'active' && document.visibilityState === 'visible' && !ensureFresh(current.linked)) snapshot('active'); }, 15000);
  window.__replayEngagementRecord = name => {
    if (!current || /^\/(admin|api)(\/|$)/.test(location.pathname)) return;
    ensureFresh(current.linked);
    const flag = ['sample_ready', 'video_import', 'download_import'].includes(name) ? 1
      : name === 'learning_start' ? 2
      : ['word_lookup', 'word_save', 'cue_save', 'loop_enable', 'export_anki', 'export_srt', 'export_vtt'].includes(name) ? 4
      : ['sample_error', 'video_error'].includes(name) ? 8 : 0;
    if (flag && !(current.flags & flag)) { current.flags |= flag; snapshot(current.state); }
  };
  return { start, finish };
}`;
