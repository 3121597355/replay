import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { POST, GET } from '../app/api/account/[action]/route';
import { GET as stats } from '../app/api/stats/v1/[resource]/route';
import { sameOrigin } from '../lib/admin-proxy';
const origin = 'https://www.replayen.com';
const call = (action: string, body: unknown, headers: Record<string, string> = {}) => POST(new NextRequest(`${origin}/api/account/${action}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), { params: Promise.resolve({ action }) });
test('account proxy enforces origin, body size, consent and authenticated activity', async () => {
  const original = { url: process.env.REPLAY_ACCOUNTS_URL, secret: process.env.REPLAY_ACCOUNTS_SECRET };
  process.env.REPLAY_ACCOUNTS_URL = 'https://private.test'; process.env.REPLAY_ACCOUNTS_SECRET = 'test-secret';
  try {
    assert.equal((await call('signup', {}, { Origin: 'https://evil.test' })).status, 403);
    assert.equal(sameOrigin(new NextRequest('http://localhost:4315/api/account/signup', { headers: { Host: '127.0.0.1:4315', Origin: 'http://127.0.0.1:4315' } })), true);
    assert.equal(sameOrigin(new NextRequest('http://localhost:4315/api/account/signup', { headers: { Host: '127.0.0.1:4315', Origin: 'http://evil.test' } })), false);
    assert.equal((await call('signup', {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await call('signup', { password: 'x'.repeat(5000) })).status, 413);
    assert.equal((await call('signup', { username: 'test', password: 'password-only' })).status, 400);
    assert.equal((await call('activity', { seconds: 5 })).status, 401);
    assert.equal((await GET(new NextRequest(`${origin}/api/account/me`), { params: Promise.resolve({ action: 'me' }) })).status, 200);
  } finally { if (original.url === undefined) delete process.env.REPLAY_ACCOUNTS_URL; else process.env.REPLAY_ACCOUNTS_URL = original.url; if (original.secret === undefined) delete process.env.REPLAY_ACCOUNTS_SECRET; else process.env.REPLAY_ACCOUNTS_SECRET = original.secret; }
});
test('signup sets a secure HttpOnly cookie and never exposes password hashes or session tokens', async () => {
  const originalFetch = global.fetch, originalUrl = process.env.REPLAY_ACCOUNTS_URL, originalSecret = process.env.REPLAY_ACCOUNTS_SECRET;
  process.env.REPLAY_ACCOUNTS_URL = 'https://private.test'; process.env.REPLAY_ACCOUNTS_SECRET = 'test-secret';
  try {
    global.fetch = async (input, init) => {
      if (String(input).endsWith('/preflight')) return Response.json({ ok: true });
      const sent = JSON.parse(init!.body as string); assert.match(sent.passwordHash, /^scrypt\$/); assert.match(sent.recoveryHash, /^[a-f0-9]{64}$/); assert.equal(sent.password, undefined);
      return Response.json({ user: { id: 'user-a', username: 'test', createdAt: new Date().toISOString() }, token: 'a'.repeat(64) }, { status: 201 });
    };
    const response = await call('signup', { username: 'test', password: 'password-fixture', accepted: true });
    assert.equal(response.status, 201); const data = await response.json();
    assert.equal(data.token, undefined); assert.equal(data.passwordHash, undefined); assert.ok(data.recoveryCode);
    const cookie = response.headers.get('set-cookie')!; assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=lax/i);
  } finally { global.fetch = originalFetch; if (originalUrl === undefined) delete process.env.REPLAY_ACCOUNTS_URL; else process.env.REPLAY_ACCOUNTS_URL = originalUrl; if (originalSecret === undefined) delete process.env.REPLAY_ACCOUNTS_SECRET; else process.env.REPLAY_ACCOUNTS_SECRET = originalSecret; }
});
test('annual summary requires login, validates the year and only forwards the allowed query', async () => {
  const originalFetch = global.fetch, originalUrl = process.env.REPLAY_ACCOUNTS_URL, originalSecret = process.env.REPLAY_ACCOUNTS_SECRET;
  process.env.REPLAY_ACCOUNTS_URL = 'https://private.test'; process.env.REPLAY_ACCOUNTS_SECRET = 'test-secret';
  const params = { params: Promise.resolve({ action: 'summary' }) };
  const request = (query: string, loggedIn = true) => new NextRequest(`${origin}/api/account/summary${query}`, { headers: loggedIn ? { Cookie: `replay_user=${'a'.repeat(64)}` } : {} });
  try {
    let calls = 0;
    global.fetch = async (input, init) => { calls++; assert.equal(String(input), 'https://private.test/summary?year=2025'); assert.equal(new Headers(init?.headers).get('x-user-session'), 'a'.repeat(64)); return Response.json({ history: { year: 2025, days: [] } }); };
    assert.equal((await GET(request('?year=2025', false), params)).status, 401);
    for (const value of ['1999', '9999', '2025.0', '', 'abcd']) assert.equal((await GET(request(`?year=${value}`), params)).status, 400);
    assert.equal(calls, 0);
    const result = await GET(request('?year=2025&user_id=other&secret=ignored'), params);
    assert.equal(result.status, 200); assert.equal((await result.json()).history.year, 2025); assert.equal(calls, 1);
  } finally { global.fetch = originalFetch; if (originalUrl === undefined) delete process.env.REPLAY_ACCOUNTS_URL; else process.env.REPLAY_ACCOUNTS_URL = originalUrl; if (originalSecret === undefined) delete process.env.REPLAY_ACCOUNTS_SECRET; else process.env.REPLAY_ACCOUNTS_SECRET = originalSecret; }
});
test('user stats require the existing read-only key and omit user identity lists', async () => {
  const originalFetch = global.fetch, originalUrl = process.env.REPLAY_ACCOUNTS_URL, originalSecret = process.env.REPLAY_ACCOUNTS_SECRET;
  process.env.REPLAY_ACCOUNTS_URL = 'https://private.test'; process.env.REPLAY_ACCOUNTS_SECRET = 'test-secret';
  const request = (auth?: string, format = '') => new NextRequest(`${origin}/api/stats/v1/users${format}`, { headers: auth ? { Authorization: auth } : {} });
  const params = { params: Promise.resolve({ resource: 'users' }) };
  try {
    assert.equal((await stats(request(), params)).status, 401);
    global.fetch = async input => String(input).startsWith('https://private.test') ? Response.json({ summary: { registeredUsers: 3, newUsers: 1, active7: 1, active30: 2, d1: { rate: 50, eligible: 2, returned: 1 }, d7: { rate: null, eligible: 0, returned: 0 } }, users: [{ username: 'private-name', id: 'private-id' }], points: [], sources: [], cohorts: [], definition: 'fixture' }) : Response.json({ siteId: 'replay', capabilities: { exportsEnabled: true } });
    const response = await stats(request('Bearer rps_' + 'a'.repeat(64)), params); const data = await response.json();
    assert.equal(data.data.summary.registeredUsers, 3); assert.equal(data.data.users, undefined); assert.ok(!JSON.stringify(data).includes('private-name'));
    assert.equal((await stats(request('Bearer rps_' + 'a'.repeat(64), '?format=csv'), params)).status, 400);
  } finally { global.fetch = originalFetch; if (originalUrl === undefined) delete process.env.REPLAY_ACCOUNTS_URL; else process.env.REPLAY_ACCOUNTS_URL = originalUrl; if (originalSecret === undefined) delete process.env.REPLAY_ACCOUNTS_SECRET; else process.env.REPLAY_ACCOUNTS_SECRET = originalSecret; }
});
