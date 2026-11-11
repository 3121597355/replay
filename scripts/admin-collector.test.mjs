import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../services/analytics-collector/worker.mjs';
import { passwordHash, sourceHost } from '../services/analytics-collector/admin.mjs';
import vm from 'node:vm';
import { trackerSource as unbundledTrackerSource } from '../services/analytics-collector/tracker.mjs';
// The same browser lifecycle checks can exercise the exact Wrangler output.
const trackerSource = process.env.REPLAY_TRACKER_BUNDLE_FILE
  ? readFileSync(process.env.REPLAY_TRACKER_BUNDLE_FILE, 'utf8') : unbundledTrackerSource;

const day = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
test('停留快照累计去重、乱序不覆盖状态，页面跳转不算网站离开', async () => {
  const f = await fixture();
  const body = { id: 'replay', eventId: 'engagement-visit-00001', path: '/learn?private=1', type: 'engagement', sequence: 1, activeMs: 0, state: 'active', flags: 0 };
  assert.equal((await f.call('/collect', 'POST', body)).status, 204);
  await f.call('/collect', 'POST', { ...body, sequence: 3, activeMs: 45000, flags: 3, state: 'route' });
  await f.call('/collect', 'POST', { ...body, sequence: 2, activeMs: 15000, flags: 1, state: 'hidden' });
  await f.call('/collect', 'POST', { ...body, sequence: 3, activeMs: 45000, flags: 3, state: 'route' });
  const row = f.db.prepare('SELECT * FROM page_engagement').get();
  assert.equal(row.active_ms, 45000); assert.equal(row.sequence, 3); assert.equal(row.state, 'route'); assert.equal(row.path, '/learn');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM visits').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM product_events').get().n, 0);
  await f.call('/collect', 'POST', { ...body, eventId: 'engagement-visit-00002', activeMs: 5000, state: 'left', flags: 8 });
  const admin = await f.login();
  const report = await (await f.call('/v1/websites/replay/admin/report', 'GET', undefined, admin)).json();
  const e = report.engagement;
  assert.equal(e.summary.completedViews, 2); assert.equal(e.summary.averageSeconds, 25);
  assert.equal(e.summary.quickLeaveRate, 50); assert.equal(e.summary.departures, 1);
  assert.equal(e.summary.learningWithoutPlay, 1); assert.equal(e.summary.learningWithPlay, 1); assert.equal(e.summary.learningWithError, 1);
  assert.equal(e.pages[0].views, 2); assert.equal(e.pages[0].departures, 1); assert.equal(e.hourly.length, 24);
  assert.equal(e.hourly.reduce((n, r) => n + r.departures, 0), 1);
  assert.equal(e.departureBuckets[0].count, 1); assert.equal(e.durationBuckets[2].count, 1);
  assert.equal(e.devices[0].averageSeconds, 25);
  for (const invalid of [{ activeMs: -1 }, { activeMs: 86400001 }, { activeMs: 1.2 }, { sequence: 0 }, { state: 'made-up' }, { flags: 16 }])
    assert.equal((await f.call('/collect', 'POST', { ...body, ...invalid })).status, 400);
  assert.equal((await f.call('/collect', 'POST', { ...body, sequence: 4, path: '/different', state: 'left' })).status, 204);
  assert.equal(f.db.prepare('SELECT state FROM page_engagement WHERE visit_id=?').get(body.eventId).state, 'route');
  await f.call('/v1/websites/replay/admin/settings', 'PUT', { apiEnabled: false, eventsEnabled: false, exportsEnabled: true }, admin);
  await f.call('/collect', 'POST', { ...body, eventId: 'engagement-visit-00003' });
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM page_engagement').get().n, 2);
  f.db.close();
});
test('暂时切后台不判离开，超时推断与恢复修正，小时按北京时间', async () => {
  const f = await fixture();
  const base = { id: 'replay', eventId: 'engagement-visit-hidden', path: '/', type: 'engagement', sequence: 1, activeMs: 16000, state: 'hidden', flags: 0 };
  await f.call('/collect', 'POST', base);
  const admin = await f.login(), read = async () => (await (await f.call('/v1/websites/replay/admin/report', 'GET', undefined, admin)).json()).engagement;
  assert.equal((await read()).summary.completedViews, 0);
  f.db.prepare('UPDATE page_engagement SET updated_at=?').run(new Date(Date.now() - 31 * 60000).toISOString());
  assert.equal((await read()).summary.inferredDepartures, 1);
  await f.call('/collect', 'POST', { ...base, sequence: 2, state: 'active' });
  assert.equal((await read()).summary.completedViews, 0);
  f.db.prepare('UPDATE page_engagement SET updated_at=?').run(new Date(Date.now() - 121000).toISOString());
  assert.equal((await read()).summary.inferredDepartures, 1);
  await f.call('/collect', 'POST', { ...base, sequence: 3, state: 'left' });
  f.db.prepare('UPDATE page_engagement SET updated_at=?').run(`${day}T00:30:00.000Z`);
  assert.equal((await read()).hourly[8].departures, 1);
  f.db.close();
});
test('真实追踪脚本：前台累计、后台不计时、BFCache不重复PV、功能归属与离页信号', () => {
  let time = 0; const sent = [], timers = [], docListeners = {}, winListeners = {};
  const document = { currentScript: { dataset: { websiteId: 'replay' }, src: 'https://collector.example/tracker.js' }, visibilityState: 'visible', referrer: 'https://www.xiaohongshu.com/post?secret=1', addEventListener: (name, fn) => (docListeners[name] ||= []).push(fn) };
  const location = { pathname: '/learn', origin: 'https://www.replayen.com' }, window = {};
  const context = { document, location, window, performance: { now: () => time }, crypto, URL, Blob,
    navigator: { sendBeacon: (_url, blob) => { sent.push(blob); return true; } },
    fetch: async (_url, options) => { sent.push(JSON.parse(options.body)); return { status: 204 }; },
    addEventListener: (name, fn) => (winListeners[name] ||= []).push(fn), setInterval: fn => timers.push(fn), setTimeout: () => {},
    history: { pushState() {}, replaceState() {} } };
  // Decode beacons synchronously through a minimal Blob stub for deterministic lifecycle assertions.
  context.Blob = class { constructor(parts) { Object.assign(this, JSON.parse(parts[0])); } };
  vm.runInNewContext(trackerSource, context);
  const emitDoc = name => docListeners[name].forEach(fn => fn({}));
  const emitWin = (name, event = {}) => winListeners[name].forEach(fn => fn(event));
  time = 15000; timers.forEach(fn => fn());
  assert.equal(sent.at(-1).activeMs, 15000);
  time = 20000; document.visibilityState = 'hidden'; emitDoc('visibilitychange');
  assert.equal(sent.at(-1).state, 'hidden'); assert.equal(sent.at(-1).activeMs, 20000);
  time = 80000; document.visibilityState = 'visible'; emitDoc('visibilitychange');
  assert.equal(sent.at(-1).activeMs, 20000);
  window.__replayEngagementRecord('learning_start'); assert.equal(sent.at(-1).flags, 2);
  window.__replayEngagementRecord('word_lookup'); assert.equal(sent.at(-1).flags, 6);
  time = 85000; emitWin('pagehide'); assert.equal(sent.at(-1).state, 'left'); assert.equal(sent.at(-1).activeMs, 25000);
  time = 95000; emitWin('pageshow', { persisted: true }); assert.equal(sent.at(-1).state, 'active'); assert.equal(sent.at(-1).activeMs, 25000);
  assert.equal(sent.filter(row => row.type === undefined).length, 1);
  location.pathname = '/download'; context.history.pushState({}, '', '/download');
  assert.equal(sent.at(-3).state, 'route'); assert.equal(sent.filter(row => row.type === undefined).length, 2);
  emitWin('click', { button: 0, target: { closest: () => ({ href: 'https://www.replayen.com/', target: '', hasAttribute: () => false }) } });
  emitWin('pagehide'); assert.equal(sent.at(-1).state, 'route');
  location.pathname = '/admin'; context.history.pushState({}, '', '/admin'); const count = sent.length;
  timers.forEach(fn => fn()); window.__replayEngagementRecord('word_save'); assert.equal(sent.length, count);
  assert.ok(sent.every(row => !JSON.stringify(row).includes('secret=1')));
});
async function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../services/analytics-collector/schema.sql', import.meta.url), 'utf8'));
  const statement = (sql, bindings = []) => ({ bind: (...values) => statement(sql, values), first: async () => db.prepare(sql).get(...bindings) || null, run: async () => db.prepare(sql).run(...bindings), all: async () => ({ results: db.prepare(sql).all(...bindings) }) });
  const env = { DB: { prepare: statement, batch: async statements => Promise.all(statements.map(s => s.all())) }, VISITOR_SALT: 'test-visitor-salt-at-least-32-characters', READ_TOKEN: 'test-existing-reader-at-least-32-characters', YILAN_SITES: '{"replay":["https://www.replayen.com"]}', REPLAY_ADMIN_SECRET: 'test-admin-session-at-least-32-characters', REPLAY_ADMIN_PASSWORD_HASH: 'test-salt:' + await passwordHash('test-admin-password', 'test-salt'), RATE_LIMITER: { limit: async () => ({ success: true }) }, LOGIN_LIMITER: { limit: async () => ({ success: true }) } };
  function request(path, method = 'GET', body, token = '') { return new Request('https://collector.example' + path, { method, headers: { Origin: 'https://www.replayen.com', 'CF-Connecting-IP': '192.0.2.1', 'User-Agent': 'Mozilla/5.0 Chrome/140.0', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  const call = (path, method, body, token) => worker.fetch(request(path, method, body, token), env);
  const login = async () => (await (await call('/v1/websites/replay/admin/login', 'POST', { username: 'admin', password: 'test-admin-password' })).json()).token;
  return { db, env, call, login };
}
test('管理员鉴权、只读权限、密钥轮换与持久化设置', async () => {
  const f = await fixture(); const base = '/v1/websites/replay/admin/';
  assert.equal((await f.call(base + 'settings')).status, 401);
  assert.equal((await f.call(base + 'report')).status, 401);
  assert.equal((await f.call(base + 'login', 'POST', { username: 'admin', password: 'wrong' })).status, 401);
  const admin = await f.login(); assert.ok(admin.startsWith('rpa.'));
  assert.equal((await f.call(base + 'settings', 'GET', undefined, admin.slice(0, -1) + '!')).status, 401);
  assert.equal((await f.call(base + 'settings', 'PUT', { apiEnabled: true, eventsEnabled: true, exportsEnabled: true }, admin)).status, 400);
  const first = await (await f.call(base + 'token', 'POST', {}, admin)).json(); assert.ok(/^rps_[a-f0-9]{64}$/.test(first.token));
  assert.equal((await f.call(base + 'report', 'GET', undefined, first.token)).status, 401);
  const enabled = await f.call(base + 'settings', 'PUT', { apiEnabled: true, eventsEnabled: true, exportsEnabled: true }, admin); assert.equal(enabled.status, 200);
  assert.equal((await f.call(base + 'report', 'GET', undefined, first.token)).status, 200);
  assert.equal((await f.call(base + 'settings', 'GET', undefined, first.token)).status, 401);
  assert.equal((await f.call(base + 'token', 'POST', {}, first.token)).status, 401);
  const second = await (await f.call(base + 'token', 'POST', {}, admin)).json();
  assert.equal((await f.call(base + 'report', 'GET', undefined, first.token)).status, 401);
  assert.equal((await f.call(base + 'report', 'GET', undefined, second.token)).status, 200);
  const stored = f.db.prepare('SELECT data FROM admin_settings').get().data; assert.ok(!stored.includes(second.token)); assert.ok(JSON.parse(stored).apiEnabled);
  assert.equal((await f.call(base + 'report?start=2026-02-30&end=2026-03-01', 'GET', undefined, admin)).status, 400);
  f.env.LOGIN_LIMITER.limit = async () => ({ success: false });
  assert.equal((await f.call(base + 'login', 'POST', { username: 'admin', password: 'test-admin-password' })).status, 429);
  f.db.close();
});
test('功能事件去重、不增加 PV、后台不统计且旧一览协议保持兼容', async () => {
  const f = await fixture();
  const visit = { id: 'replay', eventId: 'test-visit-0000000001', path: '/learn?token=private', referrer: 'https://user:pass@www.xiaohongshu.com/post?private=1' };
  assert.equal((await f.call('/collect', 'POST', visit)).status, 204);
  await f.call('/collect', 'POST', visit);
  const event = { id: 'replay', eventId: 'test-event-0000000001', type: 'event', name: 'word_lookup', path: '/learn' };
  await f.call('/collect', 'POST', event); await f.call('/collect', 'POST', event);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM visits').get().n, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM product_events').get().n, 1);
  assert.equal(f.db.prepare('SELECT path FROM visits').get().path, '/learn');
  assert.equal(f.db.prepare('SELECT referrer FROM visit_metadata').get().referrer, 'www.xiaohongshu.com');
  assert.equal((await f.call('/collect', 'POST', { ...event, name: 'arbitrary-secret' })).status, 400);
  await f.call('/collect', 'POST', { ...visit, eventId: 'test-visit-admin0001', path: '/admin' });
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM visits').get().n, 1);
  const old = await (await f.call(`/v1/websites/replay/data?start=${day}&end=${day}`, 'GET', undefined, f.env.READ_TOKEN)).json();
  assert.equal(old.version, 1); assert.equal(old.points[0].pageviews, 1); assert.equal(old.points[0].visitors, 1); assert.equal(old.pages[0].path, '/learn');
  const admin = await f.login(); const report = await (await f.call(`/v1/websites/replay/admin/report?start=${day}&end=${day}`, 'GET', undefined, admin)).json();
  assert.equal(report.summary.pageviews, 1); assert.equal(report.summary.events, 1); assert.equal(report.events[0].name, 'word_lookup'); assert.equal(report.devices[0].name, 'desktop');
  await f.call('/v1/websites/replay/admin/settings', 'PUT', { apiEnabled: false, eventsEnabled: false, exportsEnabled: false }, admin);
  await f.call('/collect', 'POST', { ...event, eventId: 'test-event-0000000002' });
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM product_events').get().n, 1);
  assert.equal(sourceHost('javascript:alert(1)'), 'direct');
  f.db.close();
});

test('管理员修改密码需验证旧密码，持久化摘要并使全部旧会话失效', async () => {
  const f = await fixture(), base = '/v1/websites/replay/admin/';
  const admin = await f.login();
  const body = { currentPassword: 'test-admin-password', password: 'a-new-admin-password-2026' };
  assert.equal((await f.call(base + 'password', 'POST', body)).status, 401);
  assert.equal((await f.call(base + 'password', 'POST', { ...body, currentPassword: 'wrong' }, admin)).status, 400);
  assert.equal((await f.call(base + 'password', 'POST', { ...body, password: 'short' }, admin)).status, 400);
  const key = (await (await f.call(base + 'token', 'POST', {}, admin)).json()).token;
  await f.call(base + 'settings', 'PUT', { apiEnabled: true, eventsEnabled: true, exportsEnabled: true }, admin);
  assert.equal((await f.call(base + 'password', 'POST', body, key)).status, 401);
  assert.equal((await f.call(base + 'password', 'POST', body, admin)).status, 200);
  assert.equal((await f.call(base + 'settings', 'GET', undefined, admin)).status, 401);
  assert.equal((await f.call(base + 'login', 'POST', { username: 'admin', password: body.currentPassword })).status, 401);
  const result = await f.call(base + 'login', 'POST', { username: 'admin', password: body.password });
  assert.equal(result.status, 200);
  const next = (await result.json()).token;
  const config = await (await f.call(base + 'settings', 'GET', undefined, next)).json();
  assert.equal(config.hasToken, true); assert.ok(!JSON.stringify(config).includes('passwordHash'));
  assert.equal((await f.call(base + 'report', 'GET', undefined, key)).status, 200);
  const stored = f.db.prepare('SELECT data FROM admin_settings').get().data;
  assert.ok(!stored.includes(body.password)); assert.equal(JSON.parse(stored).sessionVersion, 1);
  f.db.close();
});

test('访问质量按会话聚合：跨页不增加访问、跨日访客去重、单页学习不跳出、丢包不伪造时长', async () => {
  const f = await fixture(), admin = await f.login();
  const read = async (start = day) => (await (await f.call(`/v1/websites/replay/admin/report?start=${start}&end=${day}`, 'GET', undefined, admin)).json()).traffic;
  assert.equal((await read()).summary.averageSeconds, null);
  const pv = (session, page, path = '/') => ({ id: 'replay', sessionId: `session-quality-${session}`, pageIndex: page, eventId: `page-quality-${session}-${page}`, path });
  const beat = (body, ms, state = 'left', flags = 0, sequence = 1, activityIndex = body.pageIndex) => ({ ...body, type: 'engagement', sequence, activeMs: ms, state, flags, activityIndex });
  const a = pv('0001', 1), a2 = pv('0001', 2, '/learn'), b = pv('0002', 1, '/learn'), c = pv('0003', 1), d = pv('0004', 1, '/learn'), lost = pv('lost', 1);
  for (const body of [a, a, a2, b, c, d, lost]) assert.equal((await f.call('/collect', 'POST', body)).status, 204);
  for (const body of [beat(a, 5000, 'route'), beat(a2, 15000), beat(b, 60000), beat(c, 5000), beat(d, 3000, 'left', 2)]) await f.call('/collect', 'POST', body);
  // A delayed old-page leave cannot close a newer active page or change association.
  await f.call('/collect', 'POST', beat(a, 5000, 'left', 0, 2));
  await f.call('/collect', 'POST', { ...beat(a, 6000, 'left', 0, 3), sessionId: 'session-quality-other' });
  assert.equal(f.db.prepare('SELECT session_id FROM traffic_pages WHERE event_id=?').get(a.eventId).session_id, a.sessionId);
  f.db.prepare('UPDATE traffic_pages SET updated_at=?').run(new Date(Date.now() - 31 * 60000).toISOString());
  const s = (await read()).summary;
  assert.equal(s.visitors, 1); assert.equal(s.sessions, 5); assert.equal(s.pageviews, 6);
  assert.equal(s.completedSessions, 5); assert.equal(s.measuredSessions, 4); assert.equal(s.bounces, 1);
  assert.equal(s.bounceRate, 25); assert.equal(s.averageSeconds, 22); // (20 + 60 + 5 + 3)/4, not a page average.
  // Recover an active session: no longer included in the completed denominator.
  await f.call('/collect', 'POST', beat(a2, 16000, 'active', 0, 2));
  assert.equal((await read()).summary.completedSessions, 4);
  // BFCache return to an older page updates navigation order without adding a PV.
  await f.call('/collect', 'POST', beat(a, 7000, 'active', 0, 4, 3));
  assert.equal((await read()).summary.pageviews, 6);
  assert.equal((await read()).summary.completedSessions, 4);
  // Heartbeat arriving first is not a PV; duplicate PV later promotes exactly once.
  const hbFirst = pv('0005', 1);
  await f.call('/collect', 'POST', beat(hbFirst, 2000));
  assert.equal((await read()).summary.sessions, 5);
  await f.call('/collect', 'POST', hbFirst); await f.call('/collect', 'POST', hbFirst);
  assert.equal((await read()).summary.pageviews, 7);
  const yesterday = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
  f.db.prepare('UPDATE traffic_pages SET started_at=? WHERE session_id=?').run(`${yesterday}T00:00:00.000Z`, b.sessionId);
  const crossDay = await read(yesterday);
  assert.equal(crossDay.summary.visitors, 1); assert.equal(crossDay.points.reduce((n, p) => n + p.visitors, 0), 2);
  assert.equal(crossDay.entries.find(p => p.path === '/learn').sessions, 2);
  const visitor = f.db.prepare('SELECT visitor FROM traffic_pages LIMIT 1').get().visitor;
  assert.match(visitor, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(crossDay).includes('192.0.2.1'));
  const before = (await read(yesterday)).summary.sessions;
  await f.call('/collect', 'POST', { ...pv('admin', 1), path: '/admin' });
  assert.equal((await read(yesterday)).summary.sessions, before);
  assert.equal((await f.call('/collect', 'POST', { ...a, pageIndex: 0 })).status, 400);
  assert.equal((await f.call('/collect', 'POST', { ...a, activityIndex: -1 })).status, 400);
  f.db.close();
});

test('真实追踪脚本：刷新/跨页沿用会话，30分钟后台恢复新会话，存储不可用不阻塞', () => {
  let time = Date.now(); const stored = new Map();
  function browser(path, unavailable = false) {
    const sent = [], timers = [], doc = {}, win = {};
    const document = { currentScript: { dataset: { websiteId: 'replay' }, src: 'https://collector.example/tracker.js' }, visibilityState: 'visible', referrer: '', addEventListener: (n, fn) => (doc[n] ||= []).push(fn) };
    const context = { document, window: {}, location: { pathname: path, origin: 'https://www.replayen.com' }, crypto, URL, performance: { now: () => time }, Date: class extends Date { static now() { return time; } },
      sessionStorage: { getItem: k => { if (unavailable) throw Error('disabled'); return stored.get(k) || null; }, setItem: (k, v) => { if (unavailable) throw Error('disabled'); stored.set(k, v); } },
      navigator: { sendBeacon: (_u, blob) => { sent.push(blob); return true; } }, Blob: class { constructor(parts) { Object.assign(this, JSON.parse(parts[0])); } },
      fetch: async (_u, options) => { sent.push(JSON.parse(options.body)); return { status: 204 }; }, setInterval: fn => timers.push(fn), setTimeout() {}, addEventListener: (n, fn) => (win[n] ||= []).push(fn), history: { pushState() {}, replaceState() {} } };
    vm.runInNewContext(trackerSource, context);
    return { context, sent, timers, emit: (scope, name, event = {}) => (scope === 'doc' ? doc : win)[name]?.forEach(fn => fn(event)), pv: () => sent.filter(b => !b.type) };
  }
  const first = browser('/'); const session = first.pv()[0].sessionId;
  time += 5000; first.emit('win', 'pagehide');
  const second = browser('/learn'); assert.equal(second.pv()[0].sessionId, session); assert.equal(second.pv()[0].pageIndex, 2);
  const refresh = browser('/learn'); assert.equal(refresh.pv()[0].sessionId, session); assert.equal(refresh.pv()[0].pageIndex, 3);
  refresh.context.document.visibilityState = 'hidden'; refresh.emit('doc', 'visibilitychange');
  time += 31 * 60000;
  refresh.context.document.visibilityState = 'visible'; refresh.emit('doc', 'visibilitychange');
  assert.equal(refresh.pv().length, 2); assert.notEqual(refresh.pv()[1].sessionId, session); assert.equal(refresh.pv()[1].pageIndex, 1);
  assert.equal(refresh.sent.at(-1).activeMs, 0);
  // Returning an older BFCache page joins the current session rather than reviving an expired one.
  first.emit('win', 'pageshow', { persisted: true });
  assert.equal(first.pv().length, 2); assert.equal(first.pv()[1].sessionId, refresh.pv()[1].sessionId);
  const freshId = first.pv()[1].eventId;
  first.emit('win', 'pagehide'); first.emit('win', 'pageshow', { persisted: true });
  assert.equal(first.pv().length, 2); assert.equal(first.sent.at(-1).eventId, freshId);
  const offline = browser('/', true); time += 15000; offline.timers.forEach(fn => fn());
  assert.equal(offline.pv().length, 1); assert.equal(offline.sent.at(-1).activeMs, 15000);
  offline.context.location.pathname = '/admin'; offline.context.history.pushState(); const count = offline.sent.length;
  time += 31 * 60000; offline.timers.forEach(fn => fn()); assert.equal(offline.sent.length, count);
});
