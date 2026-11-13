import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, noStore, upstream } from '@/lib/admin-proxy';
import { accountService } from '@/lib/account-server';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: '请先登录后台' }, { status: 401, headers: noStore });
  try {
    const verified = await upstream('settings', token);
    if (!verified.ok) return NextResponse.json({ error: '管理员登录已过期' }, { status: 401, headers: noStore });
    return NextResponse.json(await accountService(`/admin/report${request.nextUrl.search}`), { headers: noStore });
  } catch { return NextResponse.json({ error: '用户统计暂时连接不上，请稍后重试' }, { status: 503, headers: noStore }); }
}
