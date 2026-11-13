import { NextRequest, NextResponse } from 'next/server';
import { copyResponse, noStore, upstream } from '@/lib/admin-proxy';
import { accountService } from '@/lib/account-server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const resources = ['traffic', 'traffic-summary', 'traffic-timeseries', 'traffic-entries', 'traffic-sources', 'summary', 'timeseries', 'pages', 'events', 'devices', 'browsers', 'referrers', 'report', 'engagement', 'engagement-pages', 'engagement-hours', 'engagement-durations', 'engagement-devices', 'users', 'users-summary', 'users-timeseries', 'users-cohorts', 'users-sources'];
const trafficKeys: Record<string, string> = { 'traffic-summary': 'summary', 'traffic-timeseries': 'points', 'traffic-entries': 'entries', 'traffic-sources': 'sources' };
const engagementKeys: Record<string, string> = { 'engagement-pages': 'pages', 'engagement-hours': 'hourly', 'engagement-durations': 'departureBuckets', 'engagement-devices': 'devices' };
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
export async function GET(request: NextRequest, props: { params: Promise<{ resource: string }> }) {
  const params = await props.params;
  if (params.resource === 'schema') return NextResponse.json({ schemaVersion: 1, timezone: 'Asia/Shanghai', auth: 'Authorization: Bearer <统计只读密钥>', resources, parameters: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', format: 'json | csv' }, maxRangeDays: 90, definitions: { users: '实际注册账号；有效学习日累计至少180秒前台播放或主动复习；D1/D7对应观察日结束后才进入分母；测试账号排除；接口只含聚合数据', traffic: '新版会话范围：跨日匿名访客、连续访问次数、实际浏览量、有效已结束访问跳出率和前台平均时长；区间按访问开始日，缺失时长为 null', visitors: '按日匿名估算', visitorDays: '每日访客估算之和，不跨日去重', events: '功能事件次数，不增加页面浏览量' } }, { headers: noStore });
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
    let value = trafficKeys[key] ? data.traffic?.[trafficKeys[key]] : engagementKeys[key] ? data.engagement?.[engagementKeys[key]] : key === 'report' ? data : data[key];
    let userDefinition: string | undefined;
    if (key === 'users' || key.startsWith('users-')) {
      const accountReport = await accountService(`/admin/report?${query}`);
      const summary = accountReport.summary;
      const aggregated = { registeredUsers: summary.registeredUsers, newUsers: summary.newUsers, active7: summary.active7, active30: summary.active30, d1Rate: summary.d1.rate, d1Eligible: summary.d1.eligible, d1Returned: summary.d1.returned, d7Rate: summary.d7.rate, d7Eligible: summary.d7.eligible, d7Returned: summary.d7.returned };
      const publicReport = { summary: aggregated, points: accountReport.points, cohorts: accountReport.cohorts, sources: accountReport.sources };
      const keys: Record<string, keyof typeof publicReport> = { 'users-summary': 'summary', 'users-timeseries': 'points', 'users-cohorts': 'cohorts', 'users-sources': 'sources' };
      value = keys[key] ? publicReport[keys[key]] : publicReport;
      userDefinition = accountReport.definition;
      data.generatedAt = accountReport.generatedAt;
    }
    if (request.nextUrl.searchParams.get('format') === 'csv') {
      if (!data.capabilities?.exportsEnabled) return NextResponse.json({ error: '管理员已停用统计文件导出' }, { status: 403, headers: noStore });
      if (key === 'report' || key === 'engagement' || key === 'traffic' || key === 'users') return NextResponse.json({ error: '请按单项资源导出 CSV，完整报告使用 JSON' }, { status: 400, headers: noStore });
      const rows: Record<string, unknown>[] = Array.isArray(value) ? value : [value];
      const columns = rows.length ? Object.keys(rows[0]) : [];
      return new NextResponse('\ufeff' + [columns.map(csvCell).join(','), ...rows.map(row => columns.map(c => csvCell(row[c])).join(','))].join('\r\n'), { headers: { ...noStore, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="replay-${params.resource}.csv"` } });
    }
    return NextResponse.json({ schemaVersion: 1, siteId: data.siteId, timezone: data.timezone, start: data.start, end: data.end, coverageStart: key.startsWith('traffic') ? data.traffic?.coverageStart : data.coverageStart, generatedAt: data.generatedAt, definitions: userDefinition ? { users: userDefinition } : key.startsWith('traffic') ? data.traffic?.definitions : data.definitions, data: value }, { headers: noStore });
  } catch { return NextResponse.json({ error: '统计服务暂时不可用' }, { status: 502, headers: noStore }); }
}
