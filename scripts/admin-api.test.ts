import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET as stats } from '../app/api/stats/v1/[resource]/route';
import { GET as adminGet, POST as adminPost } from '../app/api/admin/[action]/route';

test('后台接口拒绝未登录、跨站修改和伪造会话；登录 cookie 不暴露会话', async () => {
  const original = global.fetch;
  try {
    assert.equal((await adminGet(new NextRequest('https://www.replayen.com/api/admin/report'), { params: { action: 'report' } })).status, 401);
    assert.equal((await adminPost(new NextRequest('https://www.replayen.com/api/admin/token', { method: 'POST', headers: { Origin: 'https://evil.example', Cookie: 'replay_admin=fake' }, body: '{}' }), { params: { action: 'token' } })).status, 403);
    assert.equal((await adminPost(new NextRequest('https://www.replayen.com/api/admin/password', { method: 'POST', headers: { Origin: 'https://evil.example', Cookie: 'replay_admin=fake' }, body: '{}' }), { params: { action: 'password' } })).status, 403);
    global.fetch = async () => Response.json({ error: '请先登录后台' }, { status: 401 });
    assert.equal((await adminGet(new NextRequest('https://www.replayen.com/api/admin/report', { headers: { Cookie: 'replay_admin=forged' } }), { params: { action: 'report' } })).status, 401);
    global.fetch = async () => Response.json({ token: 'rpa.test.signature' });
    const login = await adminPost(new NextRequest('https://www.replayen.com/api/admin/login', { method: 'POST', headers: { Origin: 'https://www.replayen.com' }, body: '{"username":"admin","password":"test"}' }), { params: { action: 'login' } });
    assert.equal(login.status, 200); assert.deepEqual(await login.json(), { ok: true });
    const cookie = login.headers.get('set-cookie') || ''; assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=strict/i);
    global.fetch = async () => Response.json({ ok: true });
    const changed = await adminPost(new NextRequest('https://www.replayen.com/api/admin/password', { method: 'POST', headers: { Origin: 'https://www.replayen.com', Cookie: 'replay_admin=rpa.test.signature' }, body: '{}' }), { params: { action: 'password' } });
    assert.equal(changed.status, 200); assert.match(changed.headers.get('set-cookie') || '', /replay_admin=;/);
  } finally { global.fetch = original; }
});
test('统计密钥只在请求头接受，查询参数与管理员会话不能替代只读密钥', async () => {
  const original = global.fetch;
  try {
    assert.equal((await stats(new NextRequest('https://www.replayen.com/api/stats/v1/summary?token=rps_' + 'a'.repeat(64)), { params: { resource: 'summary' } })).status, 401);
    assert.equal((await stats(new NextRequest('https://www.replayen.com/api/stats/v1/summary', { headers: { Authorization: 'Bearer rpa.admin.signature' } }), { params: { resource: 'summary' } })).status, 401);
    let called = '';
    global.fetch = async (url) => { called = String(url); return Response.json({ siteId: 'replay', timezone: 'Asia/Shanghai', summary: { pageviews: 3 }, capabilities: { exportsEnabled: false } }); };
    const request = new NextRequest('https://www.replayen.com/api/stats/v1/summary?start=2026-11-10&end=2026-11-10&endpoint=https://evil.example', { headers: { Authorization: 'Bearer rps_' + 'a'.repeat(64) } });
    const result = await stats(request, { params: { resource: 'summary' } }); assert.equal(result.status, 200); assert.deepEqual((await result.json()).data, { pageviews: 3 }); assert.ok(!called.includes('evil'));
    const csv = await stats(new NextRequest('https://www.replayen.com/api/stats/v1/summary?format=csv', { headers: { Authorization: 'Bearer rps_' + 'a'.repeat(64) } }), { params: { resource: 'summary' } }); assert.equal(csv.status, 403);
  } finally { global.fetch = original; }
});
