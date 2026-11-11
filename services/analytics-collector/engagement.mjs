const MAX_MS = 86400000;
export function validEngagement(body) {
  return Number.isInteger(body.sequence) && body.sequence >= 1 && body.sequence <= 100000
    && Number.isInteger(body.activeMs) && body.activeMs >= 0 && body.activeMs <= MAX_MS
    && ['active', 'hidden', 'left', 'route'].includes(body.state)
    && Number.isInteger(body.flags) && body.flags >= 0 && body.flags <= 15;
}
export async function saveEngagement(env, body, path, now, info, referrer) {
  // Cumulative snapshots tolerate retries, missing heartbeats and out-of-order delivery.
  await env.DB.prepare(`INSERT INTO page_engagement
    (site_id,visit_id,path,started_at,updated_at,sequence,active_ms,state,flags,device,referrer)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(site_id,visit_id) DO UPDATE SET
    active_ms=MAX(page_engagement.active_ms,excluded.active_ms),
    flags=page_engagement.flags|excluded.flags,
    updated_at=CASE WHEN excluded.sequence>page_engagement.sequence THEN excluded.updated_at ELSE page_engagement.updated_at END,
    state=CASE WHEN excluded.sequence>page_engagement.sequence THEN excluded.state ELSE page_engagement.state END,
    sequence=MAX(page_engagement.sequence,excluded.sequence)
    WHERE page_engagement.path=excluded.path`).bind(body.id, body.eventId, path, now, now,
      body.sequence, body.activeMs, body.state, body.flags, info.device, referrer).run();
}
const buckets = [
  { name: '少于 10 秒', limit: 10000 }, { name: '10–30 秒', limit: 30000 },
  { name: '30–60 秒', limit: 60000 }, { name: '1–3 分钟', limit: 180000 },
  { name: '3–10 分钟', limit: 600000 }, { name: '10 分钟以上', limit: Infinity },
];
export async function engagementReport(env, id, { start, end }) {
  const now = Date.now(), staleActive = new Date(now - 120000).toISOString(), staleHidden = new Date(now - 1800000).toISOString();
  // Completion date is the final received foreground/leave signal in Shanghai time.
  // Internal route changes complete a page view but do not count as a site departure.
  const sql = `WITH measured AS (SELECT *,substr(datetime(updated_at,'+8 hours'),1,10) AS day,
    (state IN ('left','route') OR (state='active' AND updated_at<?) OR (state='hidden' AND updated_at<?)) AS complete
    FROM page_engagement WHERE site_id=?)`;
  const query = tail => env.DB.prepare(sql + tail).bind(staleActive, staleHidden, id, start, end);
  const results = await env.DB.batch([
    query(` SELECT count(*) AS trackedViews,COALESCE(sum(complete),0) AS completedViews,
      COALESCE(sum(CASE WHEN complete THEN active_ms ELSE 0 END),0) AS totalActiveMs,
      COALESCE(sum(complete AND active_ms<10000),0) AS quickLeaves,
      COALESCE(sum(complete AND state!='route'),0) AS departures,
      COALESCE(sum(complete AND state IN ('active','hidden')),0) AS inferredDepartures,
      COALESCE(sum(complete AND path='/learn'),0) AS learningViews,
      COALESCE(sum(complete AND path='/learn' AND (flags&2)=0),0) AS learningWithoutPlay,
      COALESCE(sum(complete AND path='/learn' AND (flags&2)>0),0) AS learningWithPlay,
      COALESCE(sum(complete AND path='/learn' AND (flags&4)>0),0) AS learningWithInteraction,
      COALESCE(sum(complete AND path='/learn' AND (flags&8)>0),0) AS learningWithError
      FROM measured WHERE day>=? AND day<=?`),
    query(` SELECT path,count(*) AS views,sum(active_ms) AS totalActiveMs,
      sum(active_ms<10000) AS quickLeaves,sum(state!='route') AS departures,
      sum((flags&2)>0) AS withPlay,sum((flags&8)>0) AS withError
      FROM measured WHERE complete AND day>=? AND day<=? GROUP BY path ORDER BY views DESC LIMIT 1000`),
    query(` SELECT CAST(strftime('%H',updated_at,'+8 hours') AS INTEGER) AS hour,
      sum(complete AND state!='route') AS departures,count(*) AS observedViews
      FROM measured WHERE day>=? AND day<=? GROUP BY hour ORDER BY hour`),
    query(` SELECT CASE WHEN active_ms<10000 THEN 0 WHEN active_ms<30000 THEN 1 WHEN active_ms<60000 THEN 2
      WHEN active_ms<180000 THEN 3 WHEN active_ms<600000 THEN 4 ELSE 5 END AS bucket,count(*) AS count,sum(state!='route') AS departures
      FROM measured WHERE complete AND day>=? AND day<=? GROUP BY bucket`),
    env.DB.prepare('SELECT MIN(started_at) AS firstSeen FROM page_engagement WHERE site_id=?').bind(id),
    query(` SELECT device AS name,count(*) AS views,sum(active_ms) AS totalActiveMs,sum(active_ms<10000) AS quickLeaves
      FROM measured WHERE complete AND day>=? AND day<=? GROUP BY device ORDER BY views DESC`),
  ]);
  const raw = results[0].results[0];
  const summary = { ...raw, averageSeconds: raw.completedViews ? Math.round(raw.totalActiveMs / raw.completedViews / 1000) : 0,
    quickLeaveRate: raw.completedViews ? Math.round(raw.quickLeaves / raw.completedViews * 1000) / 10 : 0 };
  const pages = results[1].results.map(row => ({ ...row,
    averageSeconds: Math.round(row.totalActiveMs / row.views / 1000), quickLeaveRate: Math.round(row.quickLeaves / row.views * 1000) / 10 }));
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, departures: 0, observedViews: 0, ...results[2].results.find(row => row.hour === hour) }));
  return { summary, pages, pagesTruncated: pages.length === 1000, hourly,
    durationBuckets: buckets.map((bucket, i) => ({ name: bucket.name, count: results[3].results.find(row => row.bucket === i)?.count || 0 })),
    departureBuckets: buckets.map((bucket, i) => ({ name: bucket.name, count: results[3].results.find(row => row.bucket === i)?.departures || 0 })),
    devices: results[5].results.map(row => ({ ...row, averageSeconds: Math.round(row.totalActiveMs / row.views / 1000), quickLeaveRate: Math.round(row.quickLeaves / row.views * 1000) / 10 })),
    firstSeen: results[4].results[0]?.firstSeen || null,
    definitions: { duration: '页面在前台可见时累计的时长，不代表实际学习或操作时长；休眠造成的大段间隔不计入。',
      completion: '站内切页完成一条页面停留；关闭或刷新记为离开/中断。前台超过 2 分钟未收到心跳、后台超过 30 分钟未回来时推断中断，恢复后自动修正。',
      hourly: '按最后收到信号的北京时间统计离开/中断次数；站内切页不算离开。按页面访问计数，不能当作独立人数。',
      coverage: '上线后采集，不补造历史停留；未结束访问暂不参与平均值和短时离开比例。' } };
}
