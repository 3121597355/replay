'use client';
import { useEffect, useId, useRef, useState } from 'react';

export type ChartRow = { key: string; label: string; value: number | null; hint?: string };
export const chartCount = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
export const chartDuration = (value: number | null) => value === null ? '—' : value < 60 ? `${value} 秒` : `${Math.floor(value / 60)} 分 ${value % 60} 秒`;
export const chartRate = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;
type Unit = 'people' | 'count' | 'percent' | 'seconds';
const formatted = (value: number | null, unit: Unit) => value === null ? '无有效样本' : unit === 'percent' ? chartRate(value) : unit === 'seconds' ? chartDuration(value) : `${chartCount(value)} ${unit === 'people' ? '人' : '次'}`;
const axisValue = (value: number, unit: Unit) => unit === 'percent' ? `${value}%` : unit === 'seconds' && value >= 60 ? `${Math.round(value / 60)}分` : value >= 10000 ? `${+(value / 10000).toFixed(1)}万` : value >= 1000 ? `${+(value / 1000).toFixed(1)}千` : String(value);
function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null), [width, setWidth] = useState(700);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(230, Math.round(element.clientWidth)));
    update();
    const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function ChartChoices<T extends string>({ options, value, onChange, label }: { options: { key: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  return <div className="ra-chart-choices" role="group" aria-label={label}>{options.map(option => <button type="button" key={option.key} className={value === option.key ? 'active' : ''} aria-pressed={value === option.key} onClick={() => onChange(option.key)}>{option.label}</button>)}</div>;
}

export function Plot({ rows, label, unit = 'count', kind = 'line', color = '#65866c', emptyText = '当前范围暂无数据', empty = false }: { rows: ChartRow[]; label: string; unit?: Unit; kind?: 'line' | 'bar'; color?: string; emptyText?: string; empty?: boolean }) {
  const { ref, width } = useChartWidth(), [active, setActive] = useState<string | null>(null);
  const fillId = useId().replace(/:/g, ''), height = 244, left = 43, right = 18, top = 31, bottom = 203;
  const plotWidth = width - left - right, hasData = !empty && rows.some(row => row.value !== null);
  const peak = rows.reduce<ChartRow | undefined>((best, row) => row.value !== null && (!best || row.value > (best.value ?? -1)) ? row : best, undefined);
  const ceiling = unit === 'percent' ? 100 : Math.max(1, (peak?.value || 0) <= 4 ? Math.ceil(peak?.value || 1) : Math.ceil((peak?.value || 1) / 4) * 4);
  const ticks = Array.from(new Set(Array.from({ length: 5 }, (_, i) => Math.round(ceiling * i / 4))));
  const x = (i: number) => rows.length <= 1 ? left + plotWidth / 2 : left + i / (rows.length - 1) * plotWidth;
  const y = (value: number) => bottom - value / ceiling * (bottom - top);
  const tickStep = Math.max(1, Math.ceil((rows.length - 1) / (width < 360 ? 2 : width < 440 ? 3 : 6)));
  const barWidth = Math.max(2, Math.min(36, plotWidth / Math.max(1, rows.length) * .55));
  const segments: { line: string; first: number; last: number }[] = [];
  rows.forEach((row, i) => {
    if (row.value === null) return;
    const previous = i > 0 && rows[i - 1].value !== null ? segments.at(-1) : undefined;
    if (previous) { previous.line += ` L ${x(i)} ${y(row.value)}`; previous.last = i; }
    else segments.push({ line: `M ${x(i)} ${y(row.value)}`, first: i, last: i });
  });
  const selected = rows.find(row => row.key === active);
  return <div className="ra-chart" ref={ref}>
    <div className="ra-chart-canvas">
      <svg className="ra-chart-svg" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${label}图表`}>
        <defs><linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".2" /><stop offset="100%" stopColor={color} stopOpacity=".02" /></linearGradient></defs>
        {ticks.map(tick => <g key={tick}><line className="ra-chart-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} /><text className="ra-chart-axis" x={left - 10} y={y(tick) + 4} textAnchor="end">{axisValue(tick, unit)}</text></g>)}
        {hasData && kind === 'line' && segments.map(segment => <g key={segment.first}>
          {segment.last > segment.first && <path d={`${segment.line} L ${x(segment.last)} ${bottom} L ${x(segment.first)} ${bottom} Z`} fill={`url(#${fillId})`} />}
          <path d={segment.line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>)}
        {rows.map((row, i) => <g key={row.key}>
          {(i % tickStep === 0 || i === rows.length - 1) && <text className="ra-chart-axis" x={x(i)} y={bottom + 28} textAnchor="middle">{row.label}</text>}
          {hasData && row.value !== null && <g className="ra-chart-point" tabIndex={0} role="button" aria-label={`${row.hint || row.label}，${label} ${formatted(row.value, unit)}`} onFocus={() => setActive(row.key)} onMouseEnter={() => setActive(row.key)} onClick={() => setActive(row.key)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActive(row.key); } }}>
            {row.key === active && <line x1={x(i)} x2={x(i)} y1={top} y2={bottom} stroke={color} strokeOpacity=".25" strokeDasharray="3 4" />}
            {kind === 'bar' ? <rect x={x(i) - barWidth / 2} y={y(row.value)} width={barWidth} height={bottom - y(row.value)} rx="3" fill={color} opacity={row.key === active ? 1 : .75} /> : <circle cx={x(i)} cy={y(row.value)} r={row.key === active ? 5 : 3.5} fill={color} stroke="var(--surface)" strokeWidth="2" />}
            {(kind === 'bar' && row.value > 0 && (rows.length <= (width < 440 ? 8 : 16) || row.key === active)) && <text className="ra-chart-value" x={x(i)} y={y(row.value) - 9} textAnchor="middle">{unit === 'percent' ? chartRate(row.value) : chartCount(row.value)}</text>}
            <circle cx={x(i)} cy={y(row.value)} r="13" fill="transparent" />
            <title>{`${row.hint || row.label}：${formatted(row.value, unit)}`}</title>
          </g>}
        </g>)}
      </svg>
      {!hasData && <div className="ra-chart-empty"><strong>{emptyText}</strong><span>有数据后自动显示，空值不会画成 0。</span></div>}
    </div>
    <div className="ra-chart-readout" aria-live="polite">{selected ? <><i style={{ background: color }} /><strong>{selected.hint || selected.label}</strong><span>{label}：{formatted(selected.value, unit)}</span></> : hasData && peak ? <><i style={{ background: color }} /><span>最高：{peak.hint || peak.label}</span><strong>{formatted(peak.value, unit)}</strong><small>点击或悬停查看数值</small></> : <span>等待真实统计数据</span>}</div>
  </div>;
}

export function HorizontalBars({ rows, label, unit = 'count', color = '#65866c', emptyText = '当前范围暂无数据' }: { rows: ChartRow[]; label: string; unit?: Unit; color?: string; emptyText?: string }) {
  const [selected, setSelected] = useState<string | null>(null), max = unit === 'percent' ? 100 : Math.max(1, ...rows.map(row => row.value ?? 0));
  return <div className="ra-horizontal-chart" role="group" aria-label={`${label}对比图`}>
    {rows.length ? rows.map(row => <button type="button" key={row.key} className={`ra-horizontal-row ${selected === row.key ? 'selected' : ''}`} aria-pressed={selected === row.key} onClick={() => setSelected(selected === row.key ? null : row.key)} title={`${row.label}：${formatted(row.value, unit)}${row.hint ? `；${row.hint}` : ''}`}>
      <span className="ra-horizontal-label">{row.label}</span><strong>{formatted(row.value, unit)}</strong>
      <span className="ra-horizontal-track"><i style={{ width: `${(row.value ?? 0) / max * 100}%`, background: color }} /></span>
      {row.hint && <small>{row.hint}</small>}
    </button>) : <div className="ra-chart-bar-empty"><div /><div /><div /><p>{emptyText}</p></div>}
  </div>;
}

export function VisitStatusChart({ summary }: { summary?: { sessions: number; completedSessions: number; measuredSessions: number; bounces: number; bounceRate: number | null } }) {
  const total = summary?.sessions || 0, completed = summary?.completedSessions || 0, measured = summary?.measuredSessions || 0, bounces = summary?.bounces || 0;
  const parts = [{ label: '已结束 · 非跳出', value: Math.max(0, measured - bounces), color: '#65866c' }, { label: '已结束 · 跳出', value: bounces, color: '#c48760' }, { label: '尚未结束', value: Math.max(0, total - completed), color: '#c0b079' }, { label: '停留信息不足', value: Math.max(0, completed - measured), color: '#afb6ad' }];
  let cursor = 0;
  const background = total ? `conic-gradient(${parts.map(part => { const start = cursor; cursor += part.value / total * 100; return `${part.color} ${start}% ${cursor}%`; }).join(',')})` : 'conic-gradient(#e5e9e2 0% 100%)';
  const [selected, setSelected] = useState<string | null>(null);
  return <>
    <div className="ra-donut-layout"><div className="ra-donut" role="img" aria-label={`访问状态分布，共 ${total} 次访问；${parts.map(part => `${part.label} ${part.value} 次`).join('，')}`} style={{ background }}><div><strong>{chartCount(total)}</strong><span>次访问</span></div></div>
      <div className="ra-chart-legend">{parts.map(part => <button type="button" key={part.label} className={selected === part.label ? 'active' : ''} onClick={() => setSelected(part.label)}><i style={{ background: part.color }} /><span>{part.label}</span><strong>{chartCount(part.value)}</strong><small>{total ? `${Math.round(part.value / total * 100)}%` : '—'}</small></button>)}</div>
    </div>
    <p className="ra-chart-state-note">{selected ? `${selected}：${parts.find(part => part.label === selected)?.value} 次访问。` : ''}{measured ? `有效结束样本 ${chartCount(measured)} 次，跳出率 ${chartRate(summary?.bounceRate ?? null)}。` : '访问结束且收到完整停留快照后，才会计入跳出率和平均时长。'}</p>
  </>;
}
