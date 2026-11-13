import { NextRequest, NextResponse } from 'next/server';
import { accountMode, accountService, AccountError, USER_COOKIE } from '@/lib/account-server';
import { createRecoveryCode, hashPassword, recoveryDigest, validPassword, verifyPassword } from '@/lib/account-password';
import { normalizeUsername, validUsername } from '@/lib/account-types';
import { sameOrigin } from '@/lib/admin-proxy';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
async function readBody(request: NextRequest) {
  if (!request.body) return {};
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 4096) { await reader.cancel(); throw new AccountError('请求过大', 413); } chunks.push(item.value); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const value = JSON.parse(new TextDecoder().decode(bytes) || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new AccountError('请求格式无效', 400); }
}
function signedIn(request: NextRequest, data: { token: string; user: unknown }) {
  if (!/^[a-f0-9]{64}$/.test(data.token)) throw new AccountError('登录未能完成，请重试');
  const response = reply({ ok: true, user: data.user });
  response.cookies.set(USER_COOKIE, data.token, { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 30 * 86400 });
  return response;
}
async function handle(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const methods: Record<string, string> = { signup: 'POST', login: 'POST', me: 'GET', summary: 'GET', logout: 'POST', recover: 'POST', recovery: 'POST', close: 'POST', activity: 'POST' };
  if (methods[action] !== request.method) return reply({ error: '接口不存在' }, 404);
  if (request.method === 'POST' && !sameOrigin(request)) return reply({ error: '请求来源无效' }, 403);
  if (request.method === 'POST' && !request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: '请求格式无效' }, 415);
  const token = request.cookies.get(USER_COOKIE)?.value || '';
  const mode = accountMode();
  if (action === 'me' && (!token || mode !== 'accounts')) return reply({ user: null, mode });
  if (mode !== 'accounts') return reply({ error: '账号服务暂时不可用，你仍可先试学。' }, 503);
  if (['summary', 'logout', 'recovery', 'close', 'activity'].includes(action) && !/^[a-f0-9]{64}$/.test(token)) return reply({ error: '请先登录' }, 401);
  const clientKey = (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-real-ip') || 'local').split(',')[0].trim().slice(0, 80);
  try {
    if (action === 'me') {
      try { const data = await accountService('/session', 'GET', undefined, token); return reply({ user: data.user, mode }); }
      catch (error) { if (error instanceof AccountError && error.status === 401) { const response = reply({ user: null, mode }); response.cookies.delete(USER_COOKIE); return response; } throw error; }
    }
    if (action === 'summary') return reply(await accountService('/summary', 'GET', undefined, token));
    const body = await readBody(request);
    if (action === 'logout') {
      try { await accountService('/logout', 'POST', {}, token); } catch (error) { if (!(error instanceof AccountError && error.status === 401)) throw error; }
      const response = reply({ ok: true }); response.cookies.delete(USER_COOKIE); return response;
    }
    if (action === 'activity') return reply(await accountService('/activity', 'POST', { eventId: body.eventId, seconds: body.seconds, action: body.action }, token));
    if (body.website) return reply({ error: '注册信息无效' }, 400);
    if (!validPassword(body.password)) return reply({ error: '密码需为 8—128 个字符' }, 400);
    const username = normalizeUsername(body.username);
    if (action === 'signup' || action === 'recover') {
      if (!validUsername(username)) return reply({ error: '用户名需为 2—24 个字，可使用中文、字母、数字、下划线和短横线' }, 400);
      if (action === 'signup' && body.accepted !== true) return reply({ error: '请先阅读并同意使用条款和隐私说明' }, 400);
      if (action === 'recover' && (typeof body.recoveryCode !== 'string' || !/^[a-fA-F0-9\s-]{32,50}$/.test(body.recoveryCode))) return reply({ error: '请填写完整的账号恢复码' }, 400);
      await accountService('/preflight', 'POST', { kind: action }, '', clientKey);
      const recoveryCode = createRecoveryCode();
      const passwordHash = await hashPassword(body.password);
      if (action === 'signup') {
        const data = await accountService('/signup', 'POST', { username, passwordHash, recoveryHash: recoveryDigest(recoveryCode), source: body.source }, '', clientKey);
        const response = signedIn(request, data);
        return new NextResponse(JSON.stringify({ ok: true, user: data.user, recoveryCode }), { status: 201, headers: { ...headers, 'Content-Type': 'application/json', 'Set-Cookie': response.headers.get('set-cookie')! } });
      }
      await accountService('/recover', 'POST', { username, passwordHash, recoveryHash: recoveryDigest(body.recoveryCode), newRecoveryHash: recoveryDigest(recoveryCode) }, '', clientKey);
      const response = reply({ ok: true, recoveryCode }); response.cookies.delete(USER_COOKIE); return response;
    }
    if (action === 'login') {
      const result = await accountService('/login-check', 'POST', { username }, '', clientKey);
      if (!await verifyPassword(body.password, result.credential?.password_hash) || !result.credential) return reply({ error: '用户名或密码不正确' }, 401);
      return signedIn(request, await accountService('/login-complete', 'POST', { id: result.credential.id, passwordHash: result.credential.password_hash }));
    }
    if (action === 'recovery' || action === 'close') {
      const current = await accountService('/session', 'GET', undefined, token);
      const result = await accountService('/login-check', 'POST', { username: current.user.username }, '', clientKey);
      if (!await verifyPassword(body.password, result.credential?.password_hash) || result.credential?.id !== current.user.id) return reply({ error: '当前密码不正确' }, 401);
      if (action === 'close') {
        await accountService('/close', 'POST', { passwordHash: result.credential.password_hash }, token);
        const response = reply({ ok: true }); response.cookies.delete(USER_COOKIE); return response;
      }
      const recoveryCode = createRecoveryCode();
      await accountService('/recovery', 'POST', { passwordHash: result.credential.password_hash, recoveryHash: recoveryDigest(recoveryCode) }, token);
      return reply({ ok: true, recoveryCode });
    }
    return reply({ error: '接口不存在' }, 404);
  } catch (error) { return reply({ error: error instanceof AccountError ? error.message : '连接暂时不稳定，请稍后重试。' }, error instanceof AccountError ? error.status : 503); }
}
export const GET = handle;
export const POST = handle;
