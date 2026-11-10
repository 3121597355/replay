import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, copyResponse, noStore, sameOrigin, smallText, upstream } from '@/lib/admin-proxy';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: noStore });
async function handle(request: NextRequest, { params }: { params: { action: string } }) {
  const { action } = params;
  const allowed: Record<string, string[]> = { login: ['POST'], logout: ['POST'], report: ['GET'], settings: ['GET', 'PUT'], token: ['POST'] };
  if (!allowed[action]?.includes(request.method)) return error('接口不存在', 404);
  if (request.method !== 'GET' && !sameOrigin(request)) return error('请求来源无效', 403);
  if (Number(request.headers.get('content-length')) > 2048) return error('请求过大', 413);
  if (action === 'logout') { const response = NextResponse.json({ ok: true }, { headers: noStore }); response.cookies.delete(ADMIN_COOKIE); return response; }
  const token = request.cookies.get(ADMIN_COOKIE)?.value || '';
  if (action !== 'login' && (!token || token.length > 1024)) return error('请先登录后台', 401);
  try {
    const body = request.method === 'GET' ? undefined : await smallText(request);
    if (body === null) return error('请求过大', 413);
    const response = await upstream(action, token, request.method, body, action === 'report' ? request.nextUrl.search : '');
    if (action === 'login' && response.ok) {
      const data = await response.json();
      if (typeof data.token !== 'string' || !data.token.startsWith('rpa.')) throw new Error('Invalid session');
      const result = NextResponse.json({ ok: true }, { headers: noStore });
      result.cookies.set(ADMIN_COOKIE, data.token, { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict', path: '/', maxAge: 28800 });
      return result;
    }
    return copyResponse(response);
  } catch { return error('统计服务连接失败，请稍后重试', 502); }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
