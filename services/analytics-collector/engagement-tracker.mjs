// Serialized into tracker.js. IDs live only in memory, never in cookies or storage.
export function createEngagementTracker({ id, send }) {
  if (id !== 'replay') return { start() {}, finish() {} };
  let current;
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
    let referrer = ''; try { referrer = new URL(document.referrer).origin; } catch {}
    current = { id: visitId, path, referrer, activeMs: 0, flags: 0, sequence: 0, tick: clock(), state: 'active' };
    snapshot('active');
  }
  function finish(state = 'route') { snapshot(state, true); current = undefined; }
  document.addEventListener('visibilitychange', () => {
    if (!current || current.state === 'left' || current.state === 'route') return;
    snapshot(document.visibilityState === 'visible' ? 'active' : 'hidden', document.visibilityState !== 'visible');
  });
  addEventListener('pagehide', () => snapshot('left', true));
  addEventListener('pageshow', event => {
    // BFCache restores the same page visit and continues its duration, without a new PV.
    if (event.persisted && current) snapshot(document.visibilityState === 'visible' ? 'active' : 'hidden');
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
