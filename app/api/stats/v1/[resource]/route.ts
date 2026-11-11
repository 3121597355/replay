import { NextRequest, NextResponse } from 'next/server';
import { copyResponse, noStore, upstream } from '@/lib/admin-proxy';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const resources = ['summary', 'timeseries', 'pages', 'events', 'devices', 'browsers', 'referrers', 'report', 'engagement', 'engagement-pages', 'engagement-hours', 'engagement-durations', 'engagement-devices'];
const engagementKeys: Record<string, string> = { 'engagement-pages': 'pages', 'engagement-hours': 'hourly', 'engagement-durations': 'departureBuckets', 'engagement-devices': 'devices' };
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
export async function GET(request: NextRequest, { params }: { params: { resource: string } }) {
  if (params.resource === 'schema') return NextResponse.json({ schemaVersion: 1, timezone: 'Asia/Shanghai', auth: 'Authorization: Bearer <统计只读密钥>', resources, parameters: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', format: 'json | csv' }, maxRangeDays: 90, definitions: { visitors: '按日匿名估算', visitorDays: '每日访客估算之和，不跨日去重', events: '功能事件次数，不增加页面浏览量' } }, { headers: noStore });
  if (!resources.includes(params.resource)) return NextResponse.json({ error: '接口不存在' }, { status: 404, headers: noStore });
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer rps_[a-f0-9]{64}$/.test(auth)) return NextResponse.json({ error: '需要统计只读密钥' }, { status: 401, headers: noStore });
  try {
    const query = new URLSearchParams();
    for (const key of ['start', 'end']) { const value = request.nextUrl.searchParams.get(key); if (value) query.set(key, value); }
    const response = await upstream('report', auth.slice(7), 'GET', undefined, `?${query}`);
    if (!response.ok) return copyResponse(response);
    const data = await response.json();
    const key = params.resource === 'timeseries' ? 'points' : params.resource;
    const value = engagementKeys[key] ? data.engagement?.[engagementKeys[key]] : key === 'report' ? data : data[key];
    if (request.nextUrl.searchParams.get('format') === 'csv') {
      if (!data.capabilities?.exportsEnabled) return NextResponse.json({ error: '管理员已停用统计文件导出' }, { status: 403, headers: noStore });
      if (key === 'report' || key === 'engagement') return NextResponse.json({ error: '请按单项资源导出 CSV，完整报告使用 JSON' }, { status: 400, headers: noStore });
      const rows: Record<string, unknown>[] = Array.isArray(value) ? value : [value];
      const columns = rows.length ? Object.keys(rows[0]) : [];
      return new NextResponse('\ufeff' + [columns.map(csvCell).join(','), ...rows.map(row => columns.map(c => csvCell(row[c])).join(','))].join('\r\n'), { headers: { ...noStore, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="replay-${params.resource}.csv"` } });
    }
    return NextResponse.json({ schemaVersion: 1, siteId: data.siteId, timezone: data.timezone, start: data.start, end: data.end, coverageStart: data.coverageStart, generatedAt: data.generatedAt, definitions: data.definitions, data: value }, { headers: noStore });
  } catch { return NextResponse.json({ error: '统计服务暂时不可用' }, { status: 502, headers: noStore }); }
}
