'use client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import ReplayMark from '../ReplayMark';
import AdminIcon from './AdminIcon';
import { changelog } from '@/lib/changelog';
import './admin.css';

type Row = { name: string; count: number; label?: string };
export type AdminSettings = { apiEnabled: boolean; eventsEnabled: boolean; exportsEnabled: boolean; hasToken: boolean; tokenUpdatedAt: string | null; timezone: string; retentionDays: number };
export type AdminReport = { generatedAt: string; coverageStart: string | null; lastReceivedAt: string | null; summary: { pageviews: number; visitorDays: number; events: number; learningVisitorDays: number }; points: { date: string; pageviews: number; visitors: number }[]; pages: { path: string; views: number }[]; pagesTruncated: boolean; events: Row[]; devices: Row[]; browsers: Row[]; referrers: Row[]; definitions: Record<string, string> };
type Panel = 'overview' | 'projects' | 'audience' | 'integration' | 'security' | 'changelog';
const panels: Record<Panel, { title: string; description: string }> = {
  overview: { title: '数据概览', description: '看看 Replay 正在被怎样使用。' },
  projects: { title: '学习表现', description: '了解访客的试学、查词、收藏与复习操作。' },
  audience: { title: '访问来源', description: '了解访客从哪里来，以及他们使用的设备。' },
  integration: { title: '统计与接口', description: '连接你的分析平台，让数据流向自己的工作空间。' },
  security: { title: '账户安全', description: '管理管理员密码与登录安全。' },
  changelog: { title: '更新日志', description: '按版本查看网站的新功能、修复和改进。' },
};
const today = () => new Date(Date.now() + 28800000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.parse(today()) - n * 86400000).toISOString().slice(0, 10);
const fmt = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
const rowLabels: Record<string, string> = { desktop: '电脑', mobile: '手机', tablet: '平板', direct: '直接访问 / 来源未提供' };
async function api(action: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/admin/${action}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal, cache: 'no-store' });
  if (response.status === 401) { window.location.assign('/admin/login'); throw new Error('登录已过期'); }
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败'); return data;
}
function Empty({ children }: { children?: React.ReactNode }) { return <div className="ra-empty"><strong>暂无访问数据</strong>{children || '允许统计的实际访问和操作会自动记录在这里。'}</div>; }
function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return <section className="ra-metric"><div className="ra-metric-label">{label}</div><strong>{fmt(value)}</strong><small>{note}</small></section>;
}
function Distribution({ title, rows, note, onMore }: { title: string; rows: Row[]; note?: string; onMore?: () => void }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return <section className="ra-panel"><div className="ra-panel-heading"><div><h2>{title}</h2>{note && <p>{note}</p>}</div>{onMore && <button className="ra-text-button" onClick={onMore}>查看全部 ↗</button>}</div>{rows.length ? <div className="ra-ranking">{rows.slice(0, onMore ? 5 : 20).map(row => <div className="ra-rank-row" key={row.name}><span>{rowLabels[row.name] || row.label || row.name}</span><strong>{fmt(row.count)} <small>{total ? Math.round(row.count / total * 100) : 0}%</small></strong><div className="ra-rank-track"><i style={{ width: `${total ? row.count / total * 100 : 0}%` }} /></div></div>)}</div> : <Empty>这类数据从统计升级后开始采集，历史访问不补造分布。</Empty>}</section>;
}
function Trend({ points, start, end }: { points: AdminReport['points']; start: string; end: string }) {
  const [metric, setMetric] = useState<'pageviews' | 'visitors'>('pageviews');
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width:600px)');
    const update = () => setCompact(media.matches); update();
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  const values = points.map(p => p[metric]), max = Math.max(1, ...values), ceiling = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const baseline = compact ? 480 : 224, plotHeight = compact ? 400 : 184, chartHeight = compact ? 550 : 262;
  const x = (i: number) => points.length === 1 ? 510 : 45 + i / Math.max(1, points.length - 1) * 925;
  const y = (value: number) => baseline - value / ceiling * plotHeight;
  const line = values.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ');
  const ticks = Array.from(new Set([0, Math.round(ceiling / 4), Math.round(ceiling / 2), Math.round(ceiling * .75), ceiling]));
  const step = Math.max(1, Math.ceil(points.length / 7));
  return <section className="ra-panel ra-trend-panel"><div className="ra-panel-heading"><div><h2>访问趋势</h2><p>{start} — {end}</p></div><div className="ra-panel-actions">{(['pageviews', 'visitors'] as const).map(key => <button key={key} className={`ra-metric-choice ${metric === key ? 'active' : ''}`} aria-pressed={metric === key} onClick={() => setMetric(key)}>{key === 'pageviews' ? '访问量' : '访客估算'}</button>)}</div></div>{points.length ? <svg className="ra-trend-chart" viewBox={`0 0 1000 ${chartHeight}`} role="img" aria-label={`${metric === 'pageviews' ? '访问量' : '每日匿名访客估算'}每日趋势`}><defs><linearGradient id="ra-trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#819563" stopOpacity=".17" /><stop offset="100%" stopColor="#819563" stopOpacity="0" /></linearGradient></defs>{ticks.map(value => <g key={value}><line className="ra-grid-line" x1="45" x2="970" y1={y(value)} y2={y(value)} /><text x="30" y={y(value) + 3} textAnchor="end">{value}</text></g>)}{points.length > 1 && <path d={`${line} L ${x(points.length - 1)} ${baseline} L ${x(0)} ${baseline} Z`} fill="url(#ra-trend-fill)" />}<path d={line} className="ra-trend-line" />{points.map((point, i) => <g key={point.date}><circle cx={x(i)} cy={y(point[metric])} r={compact ? 7 : points.length > 45 ? 2 : 3}><title>{`${point.date}：${point[metric]}`}</title></circle>{(i % step === 0 || i === points.length - 1) && <text x={x(i)} y={baseline + 25} textAnchor="middle">{point.date.slice(5)}</text>}</g>)}</svg> : <Empty>所选日期尚无覆盖数据。</Empty>}<p className="ra-chart-note">每日访客按匿名摘要估算；区间“访客日”是每日估算之和，不等于跨日去重人数。</p></section>;
}
function Pages({ report, all = false, onMore }: { report: AdminReport; all?: boolean; onMore?: () => void }) {
  return <section className="ra-panel"><div className="ra-panel-heading"><div><h2>被关注的页面</h2><p>按实际页面浏览次数统计</p></div>{onMore && <button className="ra-text-button" onClick={onMore}>查看全部 ↗</button>}</div>{report.pages.length ? <div className="ra-table-wrap"><table className="ra-data-table"><thead><tr><th>页面</th><th className="number">浏览量</th><th className="number">占比</th></tr></thead><tbody>{report.pages.slice(0, all ? 1000 : 6).map(p => <tr key={p.path}><td>{p.path}</td><td className="number">{fmt(p.views)}</td><td className="number">{report.summary.pageviews ? (p.views / report.summary.pageviews * 100).toFixed(1) : 0}%</td></tr>)}</tbody></table></div> : <Empty />}{report.pagesTruncated && <p className="ra-help">页面明细达到 1000 条上限，请缩短查询范围。</p>}</section>;
}

export default function AdminDashboard({ initialReport, initialSettings, initialPanel = 'overview' }: { initialReport?: AdminReport; initialSettings?: AdminSettings; initialPanel?: Panel } = {}) {
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const [dates, setDates] = useState({ start: daysAgo(29), end: today() }), [draftDates, setDraftDates] = useState(dates);
  const [report, setReport] = useState(initialReport), [config, setConfig] = useState(initialSettings);
  const [busy, setBusy] = useState(!initialReport), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [token, setToken] = useState('');
  const [origin, setOrigin] = useState(''), [settingsDirty, setSettingsDirty] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const controller = useRef<AbortController>(), pending = useRef(false);
  const dataPanel = panel === 'overview' || panel === 'projects' || panel === 'audience';
  const loadReport = useCallback(async (silent = false) => {
    if (silent && pending.current) return;
    controller.current?.abort(); const request = new AbortController(); controller.current = request; pending.current = true;
    if (!silent) { setBusy(true); setError(''); }
    try { setReport(await api(`report?start=${dates.start}&end=${dates.end}`, 'GET', undefined, request.signal)); setError(''); }
    catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : '读取失败'); }
    finally { if (!request.signal.aborted) { setBusy(false); pending.current = false; } }
  }, [dates]);
  useEffect(() => { void loadReport(); return () => controller.current?.abort(); }, [loadReport]);
  useEffect(() => {
    setOrigin(window.location.origin);
    const hash = () => { const key = location.hash.slice(1); if (Object.prototype.hasOwnProperty.call(panels, key)) setPanel(key as Panel); };
    hash(); addEventListener('hashchange', hash);
    void api('settings').then(setConfig).catch(e => setError(e instanceof Error ? e.message : '设置读取失败'));
    return () => removeEventListener('hashchange', hash);
  }, []);
  useEffect(() => {
    if (!dataPanel) return;
    const refresh = () => { if (document.visibilityState === 'visible') void loadReport(true); };
    const timer = setInterval(refresh, 10000); document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [dataPanel, loadReport]);
  function navigate(next: Panel) {
    if (settingsDirty && !window.confirm('统计设置尚未保存，确定离开吗？')) return;
    if (settingsDirty) { setSettingsDirty(false); void api('settings').then(setConfig).catch(() => {}); }
    setPanel(next); window.location.hash = next; setError(''); setMessage('');
  }
  function query(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draftDates.start) || !/^\d{4}-\d{2}-\d{2}$/.test(draftDates.end) || draftDates.start > draftDates.end || draftDates.end > today() || Date.parse(draftDates.end) - Date.parse(draftDates.start) >= 90 * 86400000) { setError('请选择不超过 90 天且不晚于今天的有效日期范围。'); return; }
    if (dates.start === draftDates.start && dates.end === draftDates.end) void loadReport(); else setDates({ ...draftDates });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!config) return; setSaving(true); setMessage(''); setError('');
    try { setConfig(await api('settings', 'PUT', { apiEnabled: config.apiEnabled, eventsEnabled: config.eventsEnabled, exportsEnabled: config.exportsEnabled })); setSettingsDirty(false); setMessage('统计设置已保存，立即生效。'); }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败'); } finally { setSaving(false); }
  }
  async function rotate() {
    if (config?.hasToken && !window.confirm('新密钥会使旧密钥立即失效，请确认已准备好更新分析平台连接。')) return;
    setSaving(true); setError('');
    try { const data = await api('token', 'POST', {}); setToken(data.token); setConfig(prev => prev ? { ...prev, hasToken: true, tokenUpdatedAt: data.tokenUpdatedAt } : data); setMessage('新密钥只展示这一次，请复制保存。'); }
    catch (e) { setError(e instanceof Error ? e.message : '生成失败'); } finally { setSaving(false); }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault(); setError('');
    if (passwords.next !== passwords.confirm) { setError('两次输入的新密码不一致。'); return; }
    setSaving(true);
    try { await api('password', 'POST', { currentPassword: passwords.current, password: passwords.next }); setPasswords({ current: '', next: '', confirm: '' }); window.location.assign('/admin/login'); }
    catch (e) { setError(e instanceof Error ? e.message : '密码更新失败'); } finally { setSaving(false); }
  }
  function download(kind: 'json' | 'csv') {
    if (!report || !config?.exportsEnabled) return;
    const cell = (value: unknown) => `"${String(value).replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
    const content = kind === 'json' ? JSON.stringify(report, null, 2) : '\ufeff' + ['日期,页面浏览量,访客估算', ...report.points.map(p => [p.date, p.pageviews, p.visitors].map(cell).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: kind === 'json' ? 'application/json' : 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `Replay-统计-${dates.start}-${dates.end}.${kind}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); setMessage('已复制。'); } catch { setMessage('请选中内容手动复制。'); } }
  const count = (name: string) => report?.events.find(row => row.name === name)?.count || 0;
  const exportCount = report?.events.filter(row => row.name.startsWith('export_')).reduce((sum, row) => sum + row.count, 0) || 0;
  const summary = report?.summary;
  return <div data-replay-admin className="ra-shell">
    <aside className="ra-sidebar"><a className="ra-brand" href="/admin"><ReplayMark className="ra-brand-mark" /><span className="ra-brand-copy">Replay<small>管理员后台</small></span></a>
      <nav aria-label="后台栏目">{(Object.keys(panels) as Panel[]).map(key => <div className="ra-nav-item" key={key}>{key === 'integration' && <div className="ra-nav-divider" />}<button className={panel === key ? 'active' : ''} aria-current={panel === key ? 'page' : undefined} onClick={() => navigate(key)}><AdminIcon name={key} />{panels[key].title}</button></div>)}<a href="https://github.com/3121597355/replay" target="_blank" rel="noopener noreferrer"><AdminIcon name="website" />网站内容<span className="ra-nav-out" aria-hidden="true">↗</span></a></nav>
      <div className="ra-sidebar-bottom"><span className="ra-identity"><i />admin</span><button onClick={async () => { try { await api('logout', 'POST', {}); window.location.assign('/admin/login'); } catch (e) { setError(e instanceof Error ? e.message : '退出失败'); } }}>退出登录</button><a className="ra-site-link" href="/"><AdminIcon name="website" />返回网站</a></div>
    </aside>
    <div className="ra-workspace"><header className="ra-topbar"><span>网站 / {panels[panel].title}</span><div><span className="ra-protected"><i />管理员访问</span><a className="ra-site-link" href="/"><AdminIcon name="website" />查看网站 <span aria-hidden="true">↗</span></a></div></header>
      <div className="ra-main"><div className="ra-page-heading"><div><p className="ra-eyebrow">{panel === 'changelog' ? '版本记录' : '网站数据'}</p><h1>{panels[panel].title}</h1><p className="ra-muted">{panels[panel].description}</p></div>{dataPanel && <div className="ra-heading-actions"><button className="ra-secondary" onClick={() => void loadReport()} disabled={busy}>{busy ? '读取中…' : '刷新'}</button><button className="ra-secondary" onClick={() => download('csv')} disabled={!report || !config?.exportsEnabled}>导出 CSV <span aria-hidden="true">↓</span></button></div>}</div>
        {dataPanel && <div className="ra-date-toolbar"><div className="ra-date-presets" role="group" aria-label="统计日期范围">{[7, 30, 90].map(n => <button key={n} className={dates.start === daysAgo(n - 1) && dates.end === today() ? 'active' : ''} onClick={() => { const next = { start: daysAgo(n - 1), end: today() }; setDraftDates(next); setDates(next); }}>近 {n} 天</button>)}</div><form onSubmit={query}><label className="ra-sr-only" htmlFor="ra-date-from">开始日期</label><input id="ra-date-from" type="date" required max={draftDates.end} value={draftDates.start} onChange={e => setDraftDates({ ...draftDates, start: e.target.value })} /><span>—</span><label className="ra-sr-only" htmlFor="ra-date-to">结束日期</label><input id="ra-date-to" type="date" required min={draftDates.start} max={today()} value={draftDates.end} onChange={e => setDraftDates({ ...draftDates, end: e.target.value })} /><button className="ra-date-query" type="submit">查询</button></form></div>}
        {error && <div className="ra-error" role="alert">{error}</div>}{message && <div className="ra-success" role="status">{message}</div>}
        {dataPanel && !report && <section className="ra-panel"><Empty>{busy ? '正在读取网站统计…' : '暂时无法读取数据，请点击刷新重试。'}</Empty></section>}
        {report && summary && panel === 'overview' && <><div className="ra-metric-grid"><Metric label="访问量 · PV" value={summary.pageviews} note="实际记录的页面打开次数" /><Metric label="访客日" value={summary.visitorDays} note="所选日期内每日访客估算之和" /><Metric label="学习素材就绪" value={summary.learningVisitorDays} note="试学 / 视频导入的访客日" /><Metric label="功能操作" value={summary.events} note="查词、收藏与复习导出等操作" /></div><Trend points={report.points} {...dates} /><div className="ra-two-columns"><Pages report={report} onMore={() => navigate('projects')} /><Distribution title="访问来源" rows={report.referrers} note="按页面访问次数统计" onMore={() => navigate('audience')} /></div></>}
        {report && summary && panel === 'projects' && <><div className="ra-metric-grid"><Metric label="素材就绪访客日" value={summary.learningVisitorDays} note="素材就绪，不代表完成学习" /><Metric label="开始播放" value={count('learning_start')} note="包含暂停后继续播放" /><Metric label="点词查询" value={count('word_lookup')} note="点击字幕单词的查询次数" /><Metric label="复习导出" value={exportCount} note="Anki / SRT / VTT 导出次数" /></div><section className="ra-panel"><div className="ra-panel-heading"><div><h2>学习功能与操作</h2><p>固定操作名称，不记录视频、字幕、生词或文件内容。</p></div></div>{report.events.length ? <div className="ra-table-wrap"><table className="ra-data-table"><thead><tr><th>功能</th><th>事件标识</th><th className="number">操作次数</th></tr></thead><tbody>{report.events.map(row => <tr key={row.name}><td>{row.label}</td><td><code>{row.name}</code></td><td className="number">{fmt(row.count)}</td></tr>)}</tbody></table></div> : <Empty>功能统计从发布后开始。不跟踪设置开启时，试学与学习操作不会被采集。</Empty>}</section><Pages report={report} all /></>}
        {report && panel === 'audience' && <><div className="ra-two-columns"><Distribution title="访问来源" rows={report.referrers} note="仅保留域名，不记录来源 URL 的查询参数。" /><Distribution title="设备分布" rows={report.devices} note="匿名设备分类，不记录原始设备信息。" /></div><Distribution title="浏览器分布" rows={report.browsers} note="来源与设备从统计升级后开始采集，历史数据不补造。" /></>}
        {panel === 'integration' && <div className="ra-settings-layout"><form className="ra-panel" onSubmit={save}><div className="ra-panel-heading"><div><h2>采集设置</h2><p>设置保存在云端数据库，部署网站不会清空。</p></div></div>{config ? <>{([['eventsEnabled', '采集学习功能事件', '记录试学、导入、查词、收藏与导出。'], ['apiEnabled', '开放统计只读 API', '分析平台需携带独立密钥，不能修改后台。'], ['exportsEnabled', '允许统计文件导出', '控制后台文件导出与接口 CSV 导出。']] as const).map(([key, label, note]) => <label className="ra-switch-row" key={key}><span><strong>{label}</strong><p>{note}</p></span><span className="ra-checkbox"><input type="checkbox" checked={config[key]} onChange={e => { setConfig({ ...config, [key]: e.target.checked }); setSettingsDirty(true); }} />开启</span></label>)}<div className="ra-settings-fields"><label>报表时区<input readOnly value="中国标准时间 · Asia/Shanghai" /></label><label>事件保留天数<input readOnly value={`${config.retentionDays} 天`} /></label><label className="wide">公开采集接口地址<input readOnly value="https://yilan-collector.yilan-public-collector.workers.dev/collect" /><small>Replay 已接入一览采集服务。统计尊重浏览器不跟踪与隐私设置。</small></label></div><div className="ra-settings-footer"><button className="ra-primary" disabled={saving}>{saving ? '正在保存…' : '保存统计设置'}</button><span className="ra-help">{settingsDirty ? '有尚未保存的修改' : '当前设置已同步'}</span></div></> : <Empty>正在读取采集设置…</Empty>}</form>
          <section className="ra-panel"><div className="ra-panel-heading"><div><h2>只读数据接口</h2><p>让分析平台主动拉取统计。密钥不能编辑网站或管理员账户。</p></div></div><div className="ra-key-status">{config?.hasToken ? '已生成统计只读密钥' : '尚未生成统计只读密钥'}{config?.tokenUpdatedAt && <small>最近轮换：{dateTime(config.tokenUpdatedAt)}</small>}</div><button className="ra-secondary" disabled={saving || !config} onClick={() => void rotate()}>{config?.hasToken ? '轮换接口密钥' : '创建接口密钥'}</button>{token && <div className="ra-key-reveal"><p>新密钥只展示这一次，请保存到分析平台的服务端配置。</p><label className="ra-sr-only" htmlFor="ra-new-token">新统计只读密钥</label><input id="ra-new-token" readOnly value={token} /><button className="ra-text-button" onClick={() => void copy(token)}>复制密钥</button></div>}<div className="ra-code-row"><code>{origin}/api/stats/v1/summary?start={dates.start}&amp;end={dates.end}</code><button onClick={() => void copy(`${origin}/api/stats/v1/summary?start=${dates.start}&end=${dates.end}`)}>复制汇总接口</button></div><div className="ra-code-row"><code>{origin}/api/stats/v1/events?start={dates.start}&amp;end={dates.end}</code><button onClick={() => void copy(`${origin}/api/stats/v1/events?start=${dates.start}&end=${dates.end}`)}>复制事件接口</button></div><pre className="ra-code-block">{`GET /api/stats/v1/summary?start=${dates.start}&end=${dates.end}\nAuthorization: Bearer <统计只读密钥>\n\n返回 schemaVersion、siteId、timezone、日期范围与 data。\n单次最多 90 天，单项资源可加 format=csv。`}</pre><div className="ra-table-wrap"><table className="ra-data-table"><thead><tr><th>接口</th><th>数据</th></tr></thead><tbody>{[['summary', 'PV、访客日、素材就绪与事件总数'], ['timeseries', '每日 PV 与匿名访客估算'], ['pages / events', '热门页面与功能事件'], ['devices / browsers / referrers', '设备、浏览器与来源'], ['report', '完整报告，仅 JSON'], ['schema', '公开协议，没有统计数据']].map(([path, note]) => <tr key={path}><td><code>/{path}</code></td><td>{note}</td></tr>)}</tbody></table></div><div className="ra-settings-footer"><button className="ra-secondary" onClick={async () => { try { await api('settings'); await api(`report?start=${dates.start}&end=${dates.end}`); setMessage('统计服务连接正常。分析平台请使用独立只读密钥。'); } catch (e) { setError(e instanceof Error ? e.message : '连接失败'); } }}>测试统计连接</button><button className="ra-secondary" onClick={() => download('json')} disabled={!report || !config?.exportsEnabled}>导出完整 JSON</button></div></section>
          <section className="ra-panel"><div className="ra-panel-heading"><div><h2>统计口径与数据隐私</h2><p>统一统计协议，保留你现有的一览连接。</p></div></div><p className="ra-help">管理页和 API 不计入访问。功能事件不增加 PV，同一个事件 ID 重试不会重复入库。访客按日匿名估算，访客日不能当作跨日去重人数。</p><p className="ra-help">浏览器开启 DNT / GPC 时，访问和学习操作会跳过采集。视频、字幕、文件名、生词内容与用户 API 配置不上传。</p><p className="ra-help">现有一览继续使用原 status / data 接口及原读取密钥；新统计 API 通过独立只读密钥连接。</p></section>
        </div>}
        {panel === 'security' && <div className="ra-settings-layout"><section className="ra-panel"><div className="ra-panel-heading"><div><h2>修改管理员密码</h2><p>修改成功后，所有已有管理员会话失效，请使用新密码重新登录。</p></div></div><p className="ra-account-info">当前账户：admin</p><form className="ra-security-form" onSubmit={changePassword}><label>当前密码<input type="password" autoComplete="current-password" required maxLength={200} value={passwords.current} onChange={e => setPasswords({ ...passwords, current: e.target.value })} /></label><label>新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={passwords.next} onChange={e => setPasswords({ ...passwords, next: e.target.value })} /><small>至少 12 个字符，建议使用密码管理器生成。</small></label><label>确认新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={passwords.confirm} onChange={e => setPasswords({ ...passwords, confirm: e.target.value })} /></label><button className="ra-primary" disabled={saving}>{saving ? '正在更新…' : '更新密码'}</button></form></section><section className="ra-panel"><div className="ra-panel-heading"><div><h2>登录与接口权限</h2><p>管理员会话和分析平台密钥独立管理。</p></div></div><dl className="ra-account-list"><dt>会话有效期</dt><dd>8 小时</dd><dt>登录保护</dt><dd>服务端验证 · 登录限流 · 安全 Cookie</dd><dt>统计接口</dt><dd>只读密钥不能进入后台或修改设置</dd><dt>网站内容</dt><dd><a href="https://github.com/3121597355/replay" target="_blank" rel="noopener noreferrer">通过 GitHub 管理网站源码与内容 ↗</a></dd></dl></section></div>}
        {panel === 'changelog' && <div className="ra-release-list">{changelog.map(release => <article className="ra-panel ra-release" key={release.version}>
          <div className="ra-release-meta"><time dateTime={release.date}>{release.date}</time><span>版本 {release.version}</span>{release === changelog[0] && <strong>最新</strong>}</div>
          <h2>{release.title}</h2><ul>{release.changes.map((change, i) => <li key={i}><span className="ra-change-type">{change.type}</span><span>{change.text}</span></li>)}</ul>
        </article>)}</div>}
        <footer className="ra-dashboard-footer"><span>{panel === 'changelog' ? '更新日志随网站版本发布' : `匿名统计 · Asia/Shanghai · 管理页不计入${dataPanel ? ' · 每 10 秒自动刷新' : ''}`}</span><span>{panel === 'changelog' ? `最新版本 ${changelog[0].version}` : report ? `更新于 ${dateTime(report.generatedAt)}` : '等待统计连接'}</span></footer>
      </div>
    </div>
  </div>;
}
