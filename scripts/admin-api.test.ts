import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET as stats } from '../app/api/stats/v1/[resource]/route';
import { GET as adminGet, POST as adminPost } from '../app/api/admin/[action]/route';

test('后台接口拒绝未登录、跨站修改和伪造会话；登录 cookie 不暴露会话', async () => {
  const original = global.fetch;
  try {
    assert.equal((await adminGet(new NextRequest('https://www.replayen.com/api/admin/report'), { params: Promise.resolve({ action: 'report' }) })).status, 401);
    assert.equal((await adminPost(new NextRequest('https://www.replayen.com/api/admin/token', { method: 'POST', headers: { Origin: 'https://evil.example', Cookie: 'replay_admin=fake' }, body: '{}' }), { params: Promise.resolve({ action: 'token' }) })).status, 403);
    assert.equal((await adminPost(new NextRequest('https://www.replayen.com/api/admin/password', { method: 'POST', headers: { Origin: 'https://evil.example', Cookie: 'replay_admin=fake' }, body: '{}' }), { params: Promise.resolve({ action: 'password' }) })).status, 403);
    global.fetch = async () => Response.json({ error: '请先登录后台' }, { status: 401 });
    assert.equal((await adminGet(new NextRequest('https://www.replayen.com/api/admin/report', { headers: { Cookie: 'replay_admin=forged' } }), { params: Promise.resolve({ action: 'report' }) })).status, 401);
    global.fetch = async () => Response.json({ token: 'rpa.test.signature' });
    const login = await adminPost(new NextRequest('https://www.replayen.com/api/admin/login', { method: 'POST', headers: { Origin: 'https://www.replayen.com' }, body: '{"username":"admin","password":"test"}' }), { params: Promise.resolve({ action: 'login' }) });
    assert.equal(login.status, 200); assert.deepEqual(await login.json(), { ok: true });
    const cookie = login.headers.get('set-cookie') || ''; assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=strict/i);
    global.fetch = async () => Response.json({ ok: true });
    const changed = await adminPost(new NextRequest('https://www.replayen.com/api/admin/password', { method: 'POST', headers: { Origin: 'https://www.replayen.com', Cookie: 'replay_admin=rpa.test.signature' }, body: '{}' }), { params: Promise.resolve({ action: 'password' }) });
    assert.equal(changed.status, 200); assert.match(changed.headers.get('set-cookie') || '', /replay_admin=;/);
  } finally { global.fetch = original; }
});
test('统计密钥只在请求头接受，查询参数与管理员会话不能替代只读密钥', async () => {
  const original = global.fetch;
  try {
    assert.equal((await stats(new NextRequest('https://www.replayen.com/api/stats/v1/summary?token=rps_' + 'a'.repeat(64)), { params: Promise.resolve({ resource: 'summary' }) })).status, 401);
    assert.equal((await stats(new NextRequest('https://www.replayen.com/api/stats/v1/summary', { headers: { Authorization: 'Bearer rpa.admin.signature' } }), { params: Promise.resolve({ resource: 'summary' }) })).status, 401);
    let called = '';
    global.fetch = async (url) => { called = String(url); return Response.json({ siteId: 'replay', timezone: 'Asia/Shanghai', summary: { pageviews: 3 }, capabilities: { exportsEnabled: false } }); };
    const request = new NextRequest('https://www.replayen.com/api/stats/v1/summary?start=2026-11-10&end=2026-11-10&endpoint=https://evil.example', { headers: { Authorization: 'Bearer rps_' + 'a'.repeat(64) } });
    const result = await stats(request, { params: Promise.resolve({ resource: 'summary' }) }); assert.equal(result.status, 200); assert.deepEqual((await result.json()).data, { pageviews: 3 }); assert.ok(!called.includes('evil'));
    const csv = await stats(new NextRequest('https://www.replayen.com/api/stats/v1/summary?format=csv', { headers: { Authorization: 'Bearer rps_' + 'a'.repeat(64) } }), { params: Promise.resolve({ resource: 'summary' }) }); assert.equal(csv.status, 403);
  } finally { global.fetch = original; }
});
test('停留统计分项需要只读鉴权，JSON和CSV正确映射且受导出开关限制', async () => {
  const original = global.fetch;
  const token = 'rps_' + 'a'.repeat(64);
  const request = (name: string, format = '') => new NextRequest(`https://www.replayen.com/api/stats/v1/${name}${format ? '?format=' + format : ''}`, { headers: { Authorization: 'Bearer ' + token } });
  try {
    const schema = await (await stats(new NextRequest('https://www.replayen.com/api/stats/v1/schema'), { params: Promise.resolve({ resource: 'schema' }) })).json();
    assert.ok(schema.resources.includes('engagement-hours'));
    assert.equal((await stats(new NextRequest('https://www.replayen.com/api/stats/v1/engagement'), { params: Promise.resolve({ resource: 'engagement' }) })).status, 401);
    global.fetch = async () => Response.json({ siteId: 'replay', timezone: 'Asia/Shanghai', engagement: { summary: { averageSeconds: 30 }, pages: [{ path: '/learn', averageSeconds: 30 }], hourly: [{ hour: 8, departures: 2 }], departureBuckets: [{ name: '少于 10 秒', count: 1 }], devices: [{ name: 'mobile', averageSeconds: 20 }] }, capabilities: { exportsEnabled: true } });
    const hours = await stats(request('engagement-hours'), { params: Promise.resolve({ resource: 'engagement-hours' }) });
    assert.deepEqual((await hours.json()).data, [{ hour: 8, departures: 2 }]);
    const csv = await stats(request('engagement-pages', 'csv'), { params: Promise.resolve({ resource: 'engagement-pages' }) });
    assert.match(await csv.text(), /"\/learn","30"/);
    assert.equal((await stats(request('engagement', 'csv'), { params: Promise.resolve({ resource: 'engagement' }) })).status, 400);
    const devices = await stats(request('engagement-devices'), { params: Promise.resolve({ resource: 'engagement-devices' }) });
    assert.equal((await devices.json()).data[0].name, 'mobile');
    global.fetch = async () => Response.json({ capabilities: { exportsEnabled: false } });
    assert.equal((await stats(request('engagement-pages', 'csv'), { params: Promise.resolve({ resource: 'engagement-pages' }) })).status, 403);
  } finally { global.fetch = original; }
});

test('访问质量资源映射、新口径元数据、空时长与CSV权限保持一致', async () => {
  const original = global.fetch;
  const req = (resource: string, csv = false) => new NextRequest(`https://www.replayen.com/api/stats/v1/${resource}${csv ? '?format=csv' : ''}`, { headers: { Authorization: 'Bearer rps_' + 'a'.repeat(64) } });
  const traffic = { summary: { visitors: 2, sessions: 3, pageviews: 5, bounceRate: null, averageSeconds: null }, points: [{ date: '2026-11-11', visitors: 2, sessions: 3 }], entries: [{ path: '/learn', sessions: 3 }], sources: [{ name: 'direct', sessions: 3 }], coverageStart: '2026-11-11', definitions: { visitors: '区间匿名去重' } };
  try {
    global.fetch = async () => Response.json({ siteId: 'replay', timezone: 'Asia/Shanghai', coverageStart: '2026-11-01', definitions: { visitors: '旧每日估算' }, traffic, capabilities: { exportsEnabled: true } });
    for (const [name, value] of Object.entries({ traffic, 'traffic-summary': traffic.summary, 'traffic-timeseries': traffic.points, 'traffic-entries': traffic.entries, 'traffic-sources': traffic.sources })) {
      const result = await stats(req(name), { params: Promise.resolve({ resource: name }) }); const body = await result.json();
      assert.deepEqual(body.data, value); assert.equal(body.coverageStart, traffic.coverageStart); assert.deepEqual(body.definitions, traffic.definitions);
      assert.equal((await stats(new NextRequest(`https://www.replayen.com/api/stats/v1/${name}`), { params: Promise.resolve({ resource: name }) })).status, 401);
    }
    assert.match(await (await stats(req('traffic-summary', true), { params: Promise.resolve({ resource: 'traffic-summary' }) })).text(), /"2","3","5","",""/);
    assert.equal((await stats(req('traffic', true), { params: Promise.resolve({ resource: 'traffic' }) })).status, 400);
    global.fetch = async () => Response.json({ traffic, capabilities: { exportsEnabled: false } });
    assert.equal((await stats(req('traffic-entries', true), { params: Promise.resolve({ resource: 'traffic-entries' }) })).status, 403);
  } finally { global.fetch = original; }
});
