import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../services/analytics-collector/worker.mjs';
import { passwordHash, sourceHost } from '../services/analytics-collector/admin.mjs';

const day = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
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
