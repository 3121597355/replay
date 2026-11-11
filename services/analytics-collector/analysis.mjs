import { EVENT_LABELS } from './admin.mjs';

export function operatingSystem(ua) {
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/windows/i.test(ua)) return 'Windows';
  if (/macintosh|mac os/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}
export function campaign(value) {
  const out = {};
  for (const key of ['source', 'medium', 'campaign']) {
    const raw = value?.[key];
    if (typeof raw === 'string' && /^[\p{L}\p{N} ._\-]{1,100}$/u.test(raw)) out[key] = raw;
  }
  return out;
}

// Only aggregate sequences leave the collector. No visitor digest, IP or UA is exported.
function sessionsFrom(rows) {
  const visitors = new Map();
  for (const row of rows) {
    const key = row.day + '|' + row.visitor;
    if (!visitors.has(key)) visitors.set(key, []);
    visitors.get(key).push(row);
  }
  const sessions=[];
  for (const visits of visitors.values()) {
    visits.sort((a,b) => a.at.localeCompare(b.at) || (a.kind==='page'?-1:1));
    let current=[];
    const save=()=>{
      if (!current.some(r=>r.kind==='page')) return;
      sessions.push(current);
    };
    for(const row of visits) {
      if(current.length && Date.parse(row.at)-Date.parse(current.at(-1).at)>1800000) {save();current=[];}
      current.push(row);
    }
    save();
  }
  return sessions;
}
export function journeysFrom(rows) {
  const groups = new Map();
  for(const current of sessionsFrom(rows)){
      const first=current.find(r=>r.kind==='page'), steps=current.map(r=>({kind:r.kind,name:r.name}));
      const context={country:first.country||'ZZ',device:first.device||'unknown',browser:first.browser||'unknown',os:first.os||'unknown'};
      const key=JSON.stringify([first.day,steps,context]);
      if(!groups.has(key)) groups.set(key,{date:first.day,steps,...context,count:0});
      groups.get(key).count++;
  }
  return [...groups.values()];
}
export function sessionEngagement(rows){
  const days=new Map();
  for(const session of sessionsFrom(rows)){
    const pages=session.filter(r=>r.kind==='page');
    if(pages.at(-1).state!=='left')continue;
    const date=pages[0].day,prev=days.get(date)||{date,completed:0,activeMs:0};
    prev.completed++;
    prev.activeMs+=pages.reduce((n,p)=>n+(Number(p.activeMs)||0),0);
    days.set(date,prev);
  }
  return [...days.values()];
}
export async function analysisData(env,id,start,end) {
  const q=sql=>env.DB.prepare(sql).bind(id,start,end);
  const [dimensions,events,activity,utm]=await env.DB.batch([
    q(`SELECT v.day AS date,'browser' AS type,m.browser AS name,count(*) AS views,count(DISTINCT v.visitor) AS visitors FROM visits v JOIN visit_metadata m USING(site_id,event_id) WHERE v.site_id=? AND v.day>=? AND v.day<=? GROUP BY v.day,m.browser
      UNION ALL SELECT v.day,'device',m.device,count(*),count(DISTINCT v.visitor) FROM visits v JOIN visit_metadata m USING(site_id,event_id) WHERE v.site_id=? AND v.day>=? AND v.day<=? GROUP BY v.day,m.device UNION ALL SELECT v.day,'source',m.referrer,count(*),count(DISTINCT v.visitor) FROM visits v JOIN visit_metadata m USING(site_id,event_id) WHERE v.site_id=? AND v.day>=? AND v.day<=? GROUP BY v.day,m.referrer`).bind(id,start,end,id,start,end,id,start,end),
    q('SELECT day AS date,name,count(*) AS count,count(DISTINCT visitor) AS visitors FROM product_events WHERE site_id=? AND day>=? AND day<=? GROUP BY day,name ORDER BY day,name'),
    q(`SELECT v.day,v.visitor,'page' AS kind,v.path AS name,v.received_at AS at,g.country,m.device,m.browser,e.os,p.state,p.active_ms AS activeMs FROM visits v LEFT JOIN visit_geo g USING(site_id,event_id) LEFT JOIN visit_metadata m USING(site_id,event_id) LEFT JOIN visit_environment e USING(site_id,event_id) LEFT JOIN page_engagement p ON p.site_id=v.site_id AND p.visit_id=v.event_id WHERE v.site_id=? AND v.day>=? AND v.day<=?
      UNION ALL SELECT day,visitor,'event',name,received_at,NULL,NULL,NULL,NULL,NULL,NULL FROM product_events WHERE site_id=? AND day>=? AND day<=? ORDER BY at LIMIT 20001`).bind(id,start,end,id,start,end),
    q(`SELECT v.day AS date,e.source,e.medium,e.campaign,count(*) AS views,count(DISTINCT v.visitor) AS visitors FROM visits v JOIN visit_environment e USING(site_id,event_id) WHERE v.site_id=? AND v.day>=? AND v.day<=? AND (e.source<>'' OR e.medium<>'' OR e.campaign<>'') GROUP BY v.day,e.source,e.medium,e.campaign`),
  ]);
  if(activity.results.length>20000) throw new Error('Analysis range too large');
  const os=await q(`SELECT v.day AS date,'os' AS type,e.os AS name,count(*) AS views,count(DISTINCT v.visitor) AS visitors FROM visits v JOIN visit_environment e USING(site_id,event_id) WHERE v.site_id=? AND v.day>=? AND v.day<=? GROUP BY v.day,e.os`).all();
  const cutoff=new Date(Date.now()-300000).toISOString();
  const recent=await env.DB.prepare('SELECT count(*) AS pageviews,count(DISTINCT visitor) AS visitors FROM visits WHERE site_id=? AND received_at>=?').bind(id,cutoff).first();
  return {analysisVersion:1,engagement:sessionEngagement(activity.results),dimensions:[...dimensions.results,...os.results],events:events.results.map(row=>({...row,label:EVENT_LABELS[row.name]||row.name})),journeys:journeysFrom(activity.results),campaigns:utm.results,recent:{...recent,generatedAt:new Date().toISOString(),windowMinutes:5}};
}
