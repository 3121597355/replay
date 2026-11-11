'use client';
import { useState } from 'react';
import { ChartChoices, HorizontalBars, Plot, VisitStatusChart, chartCount as fmt, chartDuration as duration, chartRate as rate } from './AdminCharts';
import type { EngagementReport } from './EngagementPanel';
type Stats = { visitors: number; sessions: number; pageviews: number; completedSessions: number; measuredSessions: number; bounces: number; bounceRate: number | null; averageSeconds: number | null };
export type TrafficReport = { summary: Stats; points: (Stats & { date: string })[]; entries: (Stats & { path: string })[]; entriesTruncated: boolean; sources: (Stats & { name: string })[]; firstSeen: string | null; coverageStart: string | null; definitions: Record<string, string> };
type HistoricalPoint = { date: string; pageviews: number; visitors: number };
const pageNames: Record<string, string> = { '/': '首页', '/learn': '学习台', '/download': '下载页' };
const sourceName = (name: string) => name === 'direct' ? '直接访问 / 未提供来源' : /xiaohongshu\.com$/.test(name) ? '小红书' : name;
function Help({ label, children }: { label: string; children: React.ReactNode }) {
  return <details className="ra-traffic-help"><summary aria-label={`${label}统计口径`}>?</summary><div>{children}</div></details>;
}
function Quality({ title, kind, rows }: { title: string; kind: 'entry' | 'source'; rows: (Stats & { path?: string; name?: string })[] }) {
  const [metric, setMetric] = useState<'sessions' | 'bounceRate' | 'averageSeconds'>('sessions');
  const choices = [{ key: 'sessions', label: '访问次数' }, { key: 'bounceRate', label: '跳出率' }, { key: 'averageSeconds', label: '平均时长' }] as const;
  const unit = metric === 'bounceRate' ? 'percent' : metric === 'averageSeconds' ? 'seconds' : 'count';
  const color = metric === 'bounceRate' ? '#c48760' : metric === 'averageSeconds' ? '#668b96' : '#65866c';
  const named = rows.slice(0, 6).map(row => ({ key: row.path || row.name || '', label: row.path ? `${pageNames[row.path] || row.path}${pageNames[row.path] ? ` · ${row.path}` : ''}` : sourceName(row.name || ''), value: row[metric], hint: metric === 'sessions' ? `${fmt(row.pageviews)} 次浏览 · ${fmt(row.measuredSessions)} 次有效结束样本` : `${fmt(row.measuredSessions)} 次有效结束样本 / ${fmt(row.sessions)} 次访问` }));
  return <section className="ra-panel ra-chart-panel">
    <div className="ra-panel-heading"><div><h2>{title}</h2><p>{kind === 'entry' ? '哪些入口带来访问，哪些入口留不住人' : '比较不同来源带来的访问数量和停留质量'}</p></div></div>
    <ChartChoices options={[...choices]} value={metric} onChange={setMetric} label={`${title}指标`} />
    <HorizontalBars rows={named} label={choices.find(choice => choice.key === metric)!.label} unit={unit} color={color} emptyText="还没有新版访问数据" />
    {rows.length > 0 && <details className="ra-chart-details"><summary>查看全部明细（{fmt(rows.length)} 项）</summary><div className="ra-table-wrap"><table className="ra-data-table"><thead><tr><th>{kind === 'entry' ? '入口页面' : '来源'}</th><th className="number">访问次数</th><th className="number">跳出率</th><th className="number">平均时长</th><th className="number">有效样本</th></tr></thead><tbody>{rows.map(row => <tr key={row.path || row.name}><td>{row.path || sourceName(row.name || '')}</td><td className="number">{fmt(row.sessions)}</td><td className="number">{rate(row.bounceRate)}</td><td className="number">{duration(row.averageSeconds)}</td><td className="number">{fmt(row.measuredSessions)}</td></tr>)}</tbody></table></div></details>}
    <p className="ra-chart-note">柱状图展示前 6 项。跳出率和时长只计算有效结束样本，样本少时先观察。</p>
  </section>;
}
function VisitTrend({ data, historicalPoints, start, end }: { data?: TrafficReport; historicalPoints: HistoricalPoint[]; start: string; end: string }) {
  type Metric = 'historical' | 'sessions' | 'visitors' | 'pageviews';
  const [metric, setMetric] = useState<Metric>(historicalPoints.length ? 'historical' : 'sessions'), [shape, setShape] = useState<'line' | 'bar'>('line');
  const options: { key: Metric; label: string }[] = [{ key: 'historical', label: '历史浏览量' }, { key: 'sessions', label: '访问次数' }, { key: 'visitors', label: '访客' }, { key: 'pageviews', label: '新版浏览量' }];
  const history = metric === 'historical';
  const rows = history ? historicalPoints.map(point => ({ key: point.date, label: point.date.slice(5), hint: point.date, value: point.pageviews })) : (data?.points || []).map(point => ({ key: point.date, label: point.date.slice(5), hint: point.date, value: point[metric as Exclude<Metric, 'historical'>] }));
  const label = options.find(option => option.key === metric)!.label;
  function choose(next: Metric) { setMetric(next); setShape((next === 'historical' ? historicalPoints : data?.points || []).length <= 1 ? 'bar' : 'line'); }
  return <section className="ra-panel ra-chart-panel ra-overview-trend">
    <div className="ra-panel-heading"><div><h2>访问趋势</h2><p>{start} — {end} · 北京时间</p></div><ChartChoices options={[{ key: 'line', label: '折线图' }, { key: 'bar', label: '柱状图' }]} value={shape} onChange={setShape} label="趋势图形" /></div>
    <div className="ra-trend-toolbar"><ChartChoices options={options} value={metric} onChange={choose} label="访问趋势指标" />
    <div className="ra-chart-summary"><i /><span>{label}</span><strong>{fmt(rows.reduce((sum, row) => sum + row.value, 0))}{metric === 'visitors' ? ' 访客日' : ' 次'}</strong><small>{metric === 'visitors' ? '每日估算之和；区间去重访客见顶部指标' : history ? '含上线前已保存的页面浏览记录' : '新版连续访问统计'}</small></div>
    </div>
    <Plot rows={rows} label={label} kind={shape} unit={metric === 'visitors' ? 'people' : 'count'} emptyText="所选日期尚无采集记录" />
    <p className="ra-chart-note">{history ? '历史浏览量按页面打开日期统计，保留原有 PV；顶部五项和其他访问质量图表使用新版会话数据，两者范围不同。' : '按访问开始日期统计，只展示新版覆盖的日期；每日访客不能相加当作区间去重人数。'}{rows.length === 1 ? ' 目前只有一天数据，可切换柱状图查看当天数量。' : ''}</p>
  </section>;
}
export default function TrafficOverview({ data, start, end, historicalViews, historicalPoints = [], engagement, events = [] }: { data?: TrafficReport; start: string; end: string; historicalViews: number; historicalPoints?: HistoricalPoint[]; engagement?: EngagementReport; events?: { name: string; label?: string; count: number }[] }) {
  const s = data?.summary;
  const hours = (engagement?.hourly || Array.from({ length: 24 }, (_, hour) => ({ hour, departures: 0 }))).map(row => ({ key: String(row.hour), label: `${String(row.hour).padStart(2, '0')}时`, hint: `${String(row.hour).padStart(2, '0')}:00–${String(row.hour).padStart(2, '0')}:59`, value: row.departures }));
  const bins = (engagement?.durationBuckets || []).map(row => ({ key: row.name, label: row.name.replace('少于 ', '<').replace(' 秒', '秒').replace(' 分钟以上', '分+').replace(' 分钟', '分'), hint: row.name, value: row.count }));
  return <>
    <div className="ra-traffic-metrics">{([
      ['visitors', '访客', s ? fmt(s.visitors) : '—'], ['sessions', '访问次数', s ? fmt(s.sessions) : '—'], ['pageviews', '浏览量', s ? fmt(s.pageviews) : '—'], ['bounceRate', '跳出率', s ? rate(s.bounceRate) : '—'], ['averageSeconds', '平均访问时长', s ? duration(s.averageSeconds) : '—'],
    ] as const).map(([key, label, value]) => <section className="ra-traffic-metric" key={key}><div>{label}<Help label={label}>{data?.definitions[key] || '新版访问数据采集后可查看。'}</Help></div><strong>{value}</strong></section>)}</div>
    <div className="ra-traffic-coverage"><span>{data?.firstSeen ? `新版访问统计始于 ${new Date(data.firstSeen).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : '新版访问统计等待首次采集'}</span><span>跳出率 / 时长有效样本：{fmt(s?.measuredSessions || 0)} 次 / 已结束 {fmt(s?.completedSessions || 0)} 次 <Help label="有效样本">{data?.definitions.completion} {data?.definitions.range}</Help></span></div>
    <VisitTrend data={data} historicalPoints={historicalPoints} start={start} end={end} />
    <div className="ra-chart-grid-layout">
      <section className="ra-panel ra-chart-panel"><div className="ra-panel-heading"><div><h2>离开 / 中断时段</h2><p>一天中什么时候离开最多 · 北京时间</p></div><span className="ra-chart-scope">页面访问</span></div><Plot rows={hours} label="离开 / 中断" kind="bar" color="#8a9b70" empty={!engagement?.summary.departures} emptyText="等待已结束的离开记录" /><p className="ra-chart-note">按页面离开信号或最后心跳统计，排除站内切页；次数不是独立人数。</p></section>
      <section className="ra-panel ra-chart-panel"><div className="ra-panel-heading"><div><h2>访问状态分布</h2><p>已结束、跳出、仍在访问分别占多少</p></div><span className="ra-chart-scope">新版访问</span></div><VisitStatusChart summary={s} /><p className="ra-chart-note">图中比例以全部新版访问为分母；顶部跳出率以有效结束样本为分母。</p></section>
      <Quality title="入口页面质量" kind="entry" rows={data?.entries || []} />
      <Quality title="来源质量" kind="source" rows={data?.sources || []} />
      <section className="ra-panel ra-chart-panel"><div className="ra-panel-heading"><div><h2>停留时长分布</h2><p>访客更常停留几秒，还是几分钟</p></div><span className="ra-chart-scope">页面访问</span></div><Plot rows={bins} label="已结束页面访问" kind="bar" color="#668b96" empty={!engagement?.summary.completedViews} emptyText="等待已结束的页面访问" /><p className="ra-chart-note">按已结束页面的前台可见时间分段，含站内切页。此图按页面统计，顶部平均时长按完整访问统计。</p></section>
      <section className="ra-panel ra-chart-panel"><div className="ra-panel-heading"><div><h2>学习功能使用次数</h2><p>播放、查词、收藏和导出，哪些操作用得多</p></div><span className="ra-chart-scope">功能事件</span></div><HorizontalBars rows={events.slice(0, 6).map(row => ({ key: row.name, label: row.label || row.name, value: row.count }))} label="学习操作" color="#8a9b70" emptyText="允许统计的学习操作会显示在这里" /><p className="ra-chart-note">展示使用最多的前 6 项，按实际事件次数计数；重复操作会累计，不能当作人数或转化率。</p></section>
    </div>
    {data?.entriesTruncated && <p className="ra-help">入口明细达到上限，请缩短查询范围。</p>}
    <details className="ra-panel ra-traffic-history"><summary>历史数据与统计说明</summary><p className="ra-help">所选日期内原始历史浏览量：{fmt(historicalViews)} 次。历史记录保留在学习表现及原统计接口中，缺少访问关联的旧记录无法可靠补算新指标。</p><p className="ra-help">{data?.definitions.coverage} {data?.definitions.averageSeconds}</p></details>
  </>;
}
