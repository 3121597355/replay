export const validSession = body => /^[\w-]{16,80}$/.test(body.sessionId || '')
  && Number.isInteger(body.pageIndex) && body.pageIndex >= 1 && body.pageIndex <= 100000
  && (body.activityIndex === undefined || (Number.isInteger(body.activityIndex) && body.activityIndex >= body.pageIndex && body.activityIndex <= 100000));

export async function saveTraffic(env, body, path, now, visitor, info, referrer) {
  if (body.id !== 'replay' || !validSession(body)) return;
  const view = body.type !== 'engagement', sequence = view ? 0 : body.sequence;
  // The first association is immutable. A heartbeat arriving before the PV is
  // allowed, but only an actual PV promotes has_view. Retries never add views.
  await env.DB.prepare(`INSERT OR IGNORE INTO traffic_pages
    (site_id,event_id,session_id,page_index,activity_index,visitor,path,started_at,updated_at,sequence,active_ms,state,flags,has_view,has_snapshot,device,referrer)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(site_id,event_id) DO UPDATE SET
    activity_index=MAX(traffic_pages.activity_index,excluded.activity_index),
    has_view=MAX(traffic_pages.has_view,excluded.has_view),
    has_snapshot=MAX(traffic_pages.has_snapshot,excluded.has_snapshot),
    active_ms=MAX(traffic_pages.active_ms,excluded.active_ms), flags=traffic_pages.flags|excluded.flags,
    updated_at=CASE WHEN excluded.sequence>traffic_pages.sequence THEN excluded.updated_at ELSE traffic_pages.updated_at END,
    state=CASE WHEN excluded.sequence>traffic_pages.sequence THEN excluded.state ELSE traffic_pages.state END,
    sequence=MAX(traffic_pages.sequence,excluded.sequence)
    WHERE traffic_pages.session_id=excluded.session_id AND traffic_pages.page_index=excluded.page_index AND traffic_pages.path=excluded.path`)
    .bind(body.id, body.eventId, body.sessionId, body.pageIndex, body.activityIndex ?? body.pageIndex, visitor, path, now, now, sequence,
      view ? 0 : body.activeMs, view ? 'active' : body.state, view ? 0 : body.flags,
      view ? 1 : 0, view ? 0 : 1, info.device, referrer).run();
}

export async function trafficReport(env, id, { start, end }) {
  const stale = new Date(Date.now() - 1800000).toISOString();
  const left = new Date(Date.now() - 15000).toISOString();
  // Rank by the tab's page ordinal, not request arrival: a delayed old beacon
  // must not turn a newer active page into a completed session.
  const cte = `WITH ranked AS (SELECT *,row_number() OVER (PARTITION BY session_id ORDER BY activity_index DESC,event_id DESC) AS latest,
      row_number() OVER (PARTITION BY session_id ORDER BY page_index,event_id) AS earliest
      FROM traffic_pages WHERE site_id=? AND has_view=1),
    grouped AS (SELECT session_id,MIN(started_at) AS started_at,MAX(updated_at) AS updated_at,
      MAX(CASE WHEN earliest=1 THEN visitor END) AS visitor,
      MAX(CASE WHEN earliest=1 THEN path END) AS entry,
      MAX(CASE WHEN earliest=1 THEN referrer END) AS referrer,
      count(*) AS pageviews,sum(active_ms) AS active_ms,MIN(has_snapshot) AS measured,
      MAX((flags&6)>0) AS interacted,MAX(CASE WHEN latest=1 THEN state END) AS last_state,
      MAX(CASE WHEN latest=1 THEN updated_at END) AS last_signal FROM ranked GROUP BY session_id),
    sessions AS (SELECT *,substr(datetime(started_at,'+8 hours'),1,10) AS day,
      (updated_at<=? OR (last_state='left' AND last_signal<=?)) AS complete FROM grouped),
    scoped AS (SELECT *,complete AND measured AS eligible,
      complete AND measured AND pageviews=1 AND active_ms<10000 AND interacted=0 AS bounced
      FROM sessions WHERE day>=? AND day<=?)`;
  const query = tail => env.DB.prepare(cte + tail).bind(id, stale, left, start, end);
  const stats = `count(DISTINCT visitor) AS visitors,count(*) AS sessions,COALESCE(sum(pageviews),0) AS pageviews,
    COALESCE(sum(complete),0) AS completedSessions,COALESCE(sum(eligible),0) AS measuredSessions,
    COALESCE(sum(bounced),0) AS bounces,COALESCE(sum(CASE WHEN eligible THEN active_ms ELSE 0 END),0) AS totalActiveMs`;
  const rows = await env.DB.batch([
    query(` SELECT ${stats} FROM scoped`),
    query(` SELECT day AS date,${stats} FROM scoped GROUP BY day ORDER BY day`),
    query(` SELECT entry AS path,${stats} FROM scoped GROUP BY entry ORDER BY sessions DESC LIMIT 1000`),
    query(` SELECT referrer AS name,${stats} FROM scoped GROUP BY referrer ORDER BY sessions DESC LIMIT 100`),
    env.DB.prepare('SELECT MIN(started_at) AS firstSeen FROM traffic_pages WHERE site_id=? AND has_view=1').bind(id),
  ]);
  const normalize = row => ({ ...row, bounceRate: row.measuredSessions ? Math.round(row.bounces / row.measuredSessions * 1000) / 10 : null,
    averageSeconds: row.measuredSessions ? Math.round(row.totalActiveMs / row.measuredSessions / 1000) : null });
  const firstSeen = rows[4].results[0]?.firstSeen || null;
  const retained = new Date(Date.now() - 399 * 86400000 + 28800000).toISOString().slice(0, 10);
  const coverageStart = firstSeen ? [new Date(Date.parse(firstSeen) + 28800000).toISOString().slice(0, 10), retained].sort().at(-1) : null;
  const byDay = new Map(rows[1].results.map(row => [row.date, normalize(row)])), points = [];
  if (coverageStart) for (let date = start; date <= end; date = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10)) {
    if (date >= coverageStart) points.push(byDay.get(date) || { date, visitors: 0, sessions: 0, pageviews: 0, completedSessions: 0, measuredSessions: 0, bounces: 0, totalActiveMs: 0, bounceRate: null, averageSeconds: null });
  }
  return { summary: normalize(rows[0].results[0]), points, entries: rows[2].results.map(normalize),
    entriesTruncated: rows[2].results.length === 1000, sources: rows[3].results.map(normalize), firstSeen, coverageStart,
    definitions: {
      visitors: '所选范围内开始的访问，按站点专属 IP / 浏览器摘要跨日去重估算；不存原始 IP 或浏览器信息，同网络同浏览器可能合并，换设备或网络可能重复。',
      sessions: '同标签页连续浏览、刷新算一次访问；30 分钟没有前台活动后开始新访问。仅记录短期随机访问 ID，不使用长期浏览器标识。',
      pageviews: '这些访问中实际打开的页面次数，同一个页面事件重试去重；心跳和功能操作不增加浏览量。',
      bounceRate: '已结束且各页均有停留快照的访问中，只看一页、前台少于 10 秒且没有播放、查词、收藏、循环或导出互动的比例。单页长时间学习不算跳出。',
      averageSeconds: '已结束且各页均有停留快照的访问，其所有页面前台可见时间之和的平均值；后台、休眠和未结束访问不计入。无有效样本显示 —。',
      completion: '关闭后留 15 秒等待刷新或返回，后续返回会修正；没有离页信号时，30 分钟无活动算结束。仅这些已结束且有完整快照的访问参与跳出率和时长。',
      range: '五项和趋势均按访问开始日期归入北京时间，同一访问跨日仍归入开始日；每日访客不能相加作为区间访客。',
      coverage: '仅使用新版关联采集的访问；历史浏览量与功能记录保留，但无法可靠补算历史会话、跳出率和时长。',
    } };
}
