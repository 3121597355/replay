export type EngagementReport = {
  firstSeen: string | null;
  summary: { trackedViews: number; completedViews: number; averageSeconds: number; quickLeaves: number; quickLeaveRate: number; departures: number; inferredDepartures: number; learningViews: number; learningWithoutPlay: number; learningWithPlay: number; learningWithInteraction: number; learningWithError: number };
  pages: { path: string; views: number; averageSeconds: number; quickLeaves: number; quickLeaveRate: number; departures: number; withPlay: number; withError: number }[];
  pagesTruncated: boolean;
  hourly: { hour: number; departures: number; observedViews: number }[];
  durationBuckets: { name: string; count: number }[];
  departureBuckets: { name: string; count: number }[];
  devices: { name: string; views: number; averageSeconds: number; quickLeaveRate: number }[];
  definitions: Record<string, string>;
};
const fmt = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
const duration = (seconds: number) => seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
const deviceNames: Record<string, string> = { mobile: '手机', desktop: '电脑', tablet: '平板' };
function Insight({ title, children }: { title: string; children: React.ReactNode }) {
  return <article><h3>{title}</h3><p>{children}</p></article>;
}
export default function EngagementPanel({ data }: { data?: EngagementReport }) {
  if (!data) return <section className="ra-panel"><h2>停留统计正在准备</h2><p className="ra-help">采集服务升级后会显示停留与离开数据，点击刷新获取。</p></section>;
  const s = data.summary, maxHour = Math.max(1, ...data.hourly.map(row => row.departures));
  const maxBucket = Math.max(1, ...data.departureBuckets.map(row => row.count));
  const peak = data.hourly.reduce((best, row) => row.departures > best.departures ? row : best, data.hourly[0]);
  const biggestQuickPage = data.pages.reduce<EngagementReport['pages'][number] | undefined>((best, row) => !best || row.quickLeaves > best.quickLeaves ? row : best, undefined);
  const noPlayRate = s.learningViews ? Math.round(s.learningWithoutPlay / s.learningViews * 100) : 0;
  return <>
    <div className="ra-metric-grid">
      {[['平均前台停留', s.completedViews ? duration(s.averageSeconds) : '—', '按已结束的页面访问计算'],
        ['少于 10 秒离页', s.completedViews ? `${s.quickLeaveRate}%` : '—', `${fmt(s.quickLeaves)} / ${fmt(s.completedViews)} 次已结束访问，含站内切页`],
        ['离开 / 中断', fmt(s.departures), `其中 ${fmt(s.inferredDepartures)} 次由心跳超时推断`],
        ['学习台未开始播放', s.learningViews ? `${noPlayRate}%` : '—', `${fmt(s.learningWithoutPlay)} / ${fmt(s.learningViews)} 次学习台已结束访问`]].map(([label, value, note]) =>
          <section className="ra-metric" key={label}><div className="ra-metric-label">{label}</div><strong className="ra-duration-value">{value}</strong><small>{note}</small></section>)}
    </div>
    <section className="ra-panel">
      <div className="ra-panel-heading"><div><h2>什么时候离开 / 中断最多</h2><p>北京时间 · 排除站内切页 · 按离开信号或最后心跳归入时段</p></div></div>
      {s.departures ? <>
        <div className="ra-hour-chart" role="img" aria-label="一天24小时的离开或中断次数">
          {data.hourly.map(row => <div className="ra-hour-column" key={row.hour} title={`${row.hour}:00–${row.hour}:59：${row.departures} 次`}><span>{row.departures || ''}</span><div><i style={{ height: `${row.departures / maxHour * 100}%` }} /></div><small>{String(row.hour).padStart(2, '0')}</small></div>)}
        </div>
        <p className="ra-help">最多在 {String(peak.hour).padStart(2, '0')}:00–{String(peak.hour).padStart(2, '0')}:59，记录 {fmt(peak.departures)} 次。这个时段访问多也可能带来更多离开，请结合停留时长和设备判断。</p>
      </> : <div className="ra-empty">暂时没有已结束的离开记录，正在访问的页面不会立刻算作流失。</div>}
    </section>
    <div className="ra-two-columns">
      <section className="ra-panel">
        <div className="ra-panel-heading"><div><h2>停留多久后离开 / 中断</h2><p>只累计前台可见时间，不含站内切页</p></div></div>
        <div className="ra-ranking">{data.departureBuckets.map(row => <div className="ra-rank-row" key={row.name}><span>{row.name}</span><strong>{fmt(row.count)} <small>{s.departures ? Math.round(row.count / s.departures * 100) : 0}%</small></strong><div className="ra-rank-track"><i style={{ width: `${row.count / maxBucket * 100}%` }} /></div></div>)}</div>
      </section>
      <section className="ra-panel">
        <div className="ra-panel-heading"><div><h2>学习台离页前做了什么</h2><p>同一次页面访问是否发生过操作，不是独立人数</p></div></div>
        <dl className="ra-account-list"><dt>已结束访问</dt><dd>{fmt(s.learningViews)}</dd><dt>开始过播放</dt><dd>{fmt(s.learningWithPlay)}</dd><dt>查词 / 复习操作</dt><dd>{fmt(s.learningWithInteraction)}</dd><dt>未开始播放</dt><dd>{fmt(s.learningWithoutPlay)}</dd><dt>遇到素材 / 播放错误</dt><dd>{fmt(s.learningWithError)}</dd></dl>
        <p className="ra-help">查词 / 复习包含查词、收藏、单句循环和导出；没有操作也可能是在认真观看。</p>
      </section>
    </div>
    <section className="ra-panel">
      <div className="ra-panel-heading"><div><h2>各页面的停留与离开</h2><p>平均值和短时比例按已结束访问计算，含站内切页；离开次数排除站内切页。</p></div></div>
      {data.pages.length ? <div className="ra-table-wrap"><table className="ra-data-table"><thead><tr><th>页面</th><th className="number">已结束访问</th><th className="number">平均停留</th><th className="number">少于 10 秒</th><th className="number">离开 / 中断</th></tr></thead><tbody>{data.pages.map(row => <tr key={row.path}><td><code>{row.path}</code></td><td className="number">{fmt(row.views)}</td><td className="number">{duration(row.averageSeconds)}</td><td className="number">{row.quickLeaveRate}%</td><td className="number">{fmt(row.departures)}</td></tr>)}</tbody></table></div> : <div className="ra-empty">暂无已结束页面访问。试学、切换页面或离开后，数据会逐步出现。</div>}
      {data.pagesTruncated && <p className="ra-help">最多显示 1000 个页面，请缩短日期范围获取更细的数据。</p>}
    </section>
    <section className="ra-panel">
      <div className="ra-panel-heading"><div><h2>手机和电脑的体验差异</h2><p>对比已结束页面访问，优先排查停留短、短时离页比例高的设备。</p></div></div>
      {data.devices.length ? <div className="ra-table-wrap"><table className="ra-data-table"><thead><tr><th>设备</th><th className="number">已结束访问</th><th className="number">平均停留</th><th className="number">少于 10 秒离页</th></tr></thead><tbody>{data.devices.map(row => <tr key={row.name}><td>{deviceNames[row.name] || row.name}</td><td className="number">{fmt(row.views)}</td><td className="number">{duration(row.averageSeconds)}</td><td className="number">{row.quickLeaveRate}%</td></tr>)}</tbody></table></div> : <p className="ra-help">新访问结束后显示设备对比。</p>}
    </section>
    <section className="ra-panel">
      <div className="ra-panel-heading"><div><h2>优先做哪些体验实验</h2><p>{s.completedViews < 20 ? `目前只有 ${fmt(s.completedViews)} 次已结束访问，先积累样本；下面是可验证的改进方向。` : '按当前数据选择实验，每次先改一个关键体验，再比较同等时间范围。'}</p></div></div>
      <div className="ra-retention-insights">
        {s.learningWithError > 0 && <Insight title="先修复试学和视频错误">有 {fmt(s.learningWithError)} 次学习台访问发生素材或播放错误。先检查手机播放、素材加载和失败后的重试入口，观察错误次数和未播放离页比例是否下降。</Insight>}
        <Insight title="让新用户尽快听到第一句">{s.learningViews ? `${noPlayRate}% 的学习台已结束访问没有开始播放。` : '先观察学习台未开始播放的比例。'}把免费试学入口放在显眼位置，给出加载进度和一句清楚的操作提示，比较进入后开始播放的比例。</Insight>
        <Insight title="用首屏说清楚练口语的收益">{biggestQuickPage?.quickLeaves ? `${biggestQuickPage.path} 有 ${fmt(biggestQuickPage.quickLeaves)} 次不到 10 秒就离页。` : '如果用户不到 10 秒就离页，先检验首屏是否说明用途。'}尝试突出“听一句 → 跟读一句 → 循环练熟”，配一段实际操作演示，观察短时离页比例。</Insight>
        <Insight title="优先检查手机的第一分钟">对比手机和电脑的平均停留、短时离页比例；测试小红书内置浏览器下的试学、音视频播放和按钮操作。先让第一次体验顺畅，再引导导入素材与下载拓展。</Insight>
        <Insight title="给练习一个完成点和回来理由">尝试“先练 3 句”的轻目标、完成提示和“继续上次练习”入口。观察开始播放、循环与收藏是否增加；本页停留统计不能证明用户次日回访，需要另设回访实验。</Insight>
      </div>
    </section>
    <section className="ra-panel">
      <div className="ra-panel-heading"><div><h2>统计口径</h2><p>{data.firstSeen ? `开始采集：${new Date(data.firstSeen).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : '从本次发布后开始采集，不补造历史停留。'}</p></div></div>
      {Object.entries(data.definitions).map(([key, value]) => <p className="ra-help" key={key}>{value}</p>)}
      <p className="ra-help">所选范围按结束 / 最后信号日期统计；目前有 {fmt(Math.max(0, s.trackedViews - s.completedViews))} 次访问尚未结束。数据每 10 秒刷新，离开上报和超时判断可能稍有延迟。浏览器不跟踪设置仍然生效。</p>
    </section>
  </>;
}
