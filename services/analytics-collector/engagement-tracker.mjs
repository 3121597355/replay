// Serialized into tracker.js. IDs live only in memory, never in cookies or storage.
export function createEngagementTracker({ id, send }) {
  if (id !== 'replay') return { start() {}, finish() {} };
  let current;
  let internalNavigationAt = -Infinity;
  const clock = () => performance.now();
  function tick() {
    if (!current) return;
    const now = clock();
    if (current.state === 'active') current.activeMs += Math.min(30000, Math.max(0, now - current.tick));
    current.tick = now;
  }
  function snapshot(state, final = false) {
    if (!current) return;
    tick(); current.state = state;
    send(JSON.stringify({ id, eventId: current.id, type: 'engagement', path: current.path,
      sequence: ++current.sequence, activeMs: Math.min(86400000, Math.round(current.activeMs)),
      state, flags: current.flags, referrer: current.referrer }), 0, final);
  }
  function start(visitId, path) {
    internalNavigationAt = -Infinity;
    let referrer = ''; try { referrer = new URL(document.referrer).origin; } catch {}
    current = { id: visitId, path, referrer, activeMs: 0, flags: 0, sequence: 0, tick: clock(), state: 'active' };
    snapshot('active');
  }
  function finish(state = 'route') { snapshot(state, true); current = undefined; }
  document.addEventListener('visibilitychange', () => {
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
    if (event.persisted && current) { internalNavigationAt = -Infinity; snapshot(document.visibilityState === 'visible' ? 'active' : 'hidden'); }
  });
  setInterval(() => { if (current?.state === 'active' && document.visibilityState === 'visible') snapshot('active'); }, 15000);
  window.__replayEngagementRecord = name => {
    if (!current || /^\/(admin|api)(\/|$)/.test(location.pathname)) return;
    const flag = ['sample_ready', 'video_import', 'download_import'].includes(name) ? 1
      : name === 'learning_start' ? 2
      : ['word_lookup', 'word_save', 'cue_save', 'loop_enable', 'export_anki', 'export_srt', 'export_vtt'].includes(name) ? 4
      : ['sample_error', 'video_error'].includes(name) ? 8 : 0;
    if (flag && !(current.flags & flag)) { current.flags |= flag; snapshot(current.state); }
  };
  return { start, finish };
}
