'use client';
import { useState } from 'react';
type Stats = { visitors: number; sessions: number; pageviews: number; completedSessions: number; measuredSessions: number; bounces: number; bounceRate: number | null; averageSeconds: number | null };
export type TrafficReport = { summary: Stats; points: (Stats & { date: string })[]; entries: (Stats & { path: string })[]; entriesTruncated: boolean; sources: (Stats & { name: string })[]; firstSeen: string | null; coverageStart: string | null; definitions: Record<string, string> };
const fmt = (n: number) => new Intl.NumberFormat('zh-CN').format(n);
const rate = (n: number | null) => n === null ? '—' : `${n.toFixed(1)}%`;
const duration = (n: number | null) => n === null ? '—' : n < 60 ? `${n} 秒` : `${Math.floor(n / 60)} 分 ${n % 60} 秒`;
function Help({ label, children }: { label: string; children: React.ReactNode }) {
  return <details className="ra-traffic-help"><summary aria-label={`${label}统计口径`}>?</summary><div>{children}</div></details>;
}
function Quality({ title, kind, rows }: { title: string; kind: 'entry' | 'source'; rows: (Stats & { path?: string; name?: string })[] }) {
  return <section className="ra-panel"><div className="ra-panel-heading"><div><h2>{title}</h2><p>对比进入网站后的访问质量，优先关注访问多、跳出高的入口。</p></div></div>{rows.length ? <div className="ra-table-wrap"><table className="ra-data-table"><thead><tr><th>{kind === 'entry' ? '入口页面' : '来源'}</th><th className="number">访问次数</th><th className="number">跳出率</th><th className="number">平均时长</th><th className="number">有效样本</th></tr></thead><tbody>{rows.slice(0, 10).map(row => <tr key={row.path || row.name}><td>{row.path || (row.name === 'direct' ? '直接访问 / 未提供来源' : row.name)}</td><td className="number">{fmt(row.sessions)}</td><td className="number">{rate(row.bounceRate)}</td><td className="number">{duration(row.averageSeconds)}</td><td className="number">{fmt(row.measuredSessions)}</td></tr>)}</tbody></table></div> : <p className="ra-empty">还没有新版访问数据。</p>}<p className="ra-chart-note">有效样本为已结束且各页均有停留快照的访问；样本少时，先观察，避免用一个百分比判断效果。</p></section>;
}
export default function TrafficOverview({ data, start, end, historicalViews }: { data?: TrafficReport; start: string; end: string; historicalViews: number }) {
  const [metric, setMetric] = useState<'visitors' | 'sessions' | 'pageviews'>('sessions');
  const labels = { visitors: '访客', sessions: '访问次数', pageviews: '浏览量' }, s = data?.summary;
  const points = data?.points || [], max = Math.max(1, ...points.map(p => p[metric]));
  const x = (i: number) => points.length === 1 ? 500 : 45 + i / (points.length - 1) * 900;
  const line = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${210 - p[metric] / max * 160}`).join(' ');
  const step = Math.max(1, Math.ceil(points.length / 6));
  return <>
    <div className="ra-traffic-metrics">{([
      ['visitors', '访客', s ? fmt(s.visitors) : '—'], ['sessions', '访问次数', s ? fmt(s.sessions) : '—'],
      ['pageviews', '浏览量', s ? fmt(s.pageviews) : '—'], ['bounceRate', '跳出率', s ? rate(s.bounceRate) : '—'],
      ['averageSeconds', '平均访问时长', s ? duration(s.averageSeconds) : '—'],
    ] as const).map(([key, label, value]) => <section className="ra-traffic-metric" key={key}><div>{label}<Help label={label}>{data?.definitions[key] || '新版访问数据采集后可查看。'}</Help></div><strong>{value}</strong></section>)}</div>
    <div className="ra-traffic-coverage"><span>{data?.firstSeen ? `新版访问统计始于 ${new Date(data.firstSeen).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : '新版访问统计等待首次采集'}</span><span>跳出率 / 时长有效样本：{fmt(s?.measuredSessions || 0)} 次 / 已结束 {fmt(s?.completedSessions || 0)} 次 <Help label="有效样本">{data?.definitions.completion} {data?.definitions.range}</Help></span></div>
    <section className="ra-panel"><div className="ra-panel-heading"><div><h2>访问趋势</h2><p>{start} — {end} · 按访问开始日期统计</p></div><div className="ra-panel-actions">{(Object.keys(labels) as (keyof typeof labels)[]).map(key => <button key={key} className={`ra-metric-choice ${metric === key ? 'active' : ''}`} aria-pressed={metric === key} onClick={() => setMetric(key)}>{labels[key]}</button>)}</div></div>
      {points.length ? <div className="ra-traffic-chart-wrap"><svg className="ra-trend-chart ra-traffic-chart" viewBox="0 0 1000 260" role="img" aria-label={`${labels[metric]}每日趋势`}>{[0, .5, 1].map(t => <g key={t}><line className="ra-grid-line" x1="45" x2="945" y1={210 - t * 160} y2={210 - t * 160} /><text x="28" y={215 - t * 160} textAnchor="end">{Math.round(max * t)}</text></g>)}<path className="ra-trend-line" d={line} />{points.map((p, i) => <g key={p.date}><circle cx={x(i)} cy={210 - p[metric] / max * 160} r="4"><title>{`${p.date} ${labels[metric]}：${p[metric]}`}</title></circle>{(i % step === 0 || i === points.length - 1) && <text x={x(i)} y="242" textAnchor="middle">{p.date.slice(5)}</text>}</g>)}</svg></div> : <p className="ra-empty">所选日期还没有新版访问数据，实际访问采集后会在这里显示。</p>}
      <p className="ra-chart-note">访客按区间匿名去重估算，每日访客不能相加作为总访客。浏览量包含这些访问的所有页面，心跳和学习操作不会增加浏览量。</p>
    </section>
    <Quality title="入口页面质量" kind="entry" rows={data?.entries || []} />
    {data?.entriesTruncated && <p className="ra-help">入口明细达到上限，请缩短查询范围。</p>}
    <Quality title="来源质量" kind="source" rows={data?.sources || []} />
    <details className="ra-panel ra-traffic-history"><summary>历史数据与统计说明</summary><p className="ra-help">所选日期内原始历史浏览量：{fmt(historicalViews)} 次。历史记录保留在学习表现及原统计接口中，缺少访问关联的旧记录无法可靠补算新指标。</p><p className="ra-help">{data?.definitions.coverage} {data?.definitions.averageSeconds}</p></details>
  </>;
}
