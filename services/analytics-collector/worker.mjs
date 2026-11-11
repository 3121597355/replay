import { trackerSource } from "./tracker.mjs";
import { adminRoute, deviceInfo, EVENT_LABELS, settings, sourceHost } from './admin.mjs';
import { saveEngagement, validEngagement } from './engagement.mjs';
import { saveTraffic, validSession } from './traffic.mjs';

const day = (time = Date.now()) => new Date(time + 28800000).toISOString().slice(0, 10);
const offset = (date, n) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const json = (value, status = 200) => Response.json(value, { status, headers });
const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const hmac = async (secret, value) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))), n => n.toString(16).padStart(2, "0")).join("");
};
async function authorized(request, token) {
  if (!token || token.length < 32) return false;
  const supplied = request.headers.get("Authorization") || "";
  const a = await hmac(token, supplied), b = await hmac(token, "Bearer " + token);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function sites(env) {
  const result = JSON.parse(env.YILAN_SITES || "{}");
  if (!Object.keys(result).length) throw new Error("Missing sites");
  return result;
}
async function readSmallBody(request) {
  if (Number(request.headers.get("content-length")) > 2048) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const parts = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2048) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const bytes = new Uint8Array(size); let cursor = 0;
  for (const part of parts) { bytes.set(part, cursor); cursor += part.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/tracker.js")
        return new Response(trackerSource, { headers: { ...headers, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "Cross-Origin-Resource-Policy": "cross-origin", "Access-Control-Allow-Origin": "*" } });
      if (request.method === "GET" && url.pathname === "/health")
        return json({ app: "yilan-collector", version: 1 });
      if (!env.DB || !env.VISITOR_SALT || env.VISITOR_SALT.length < 32)
        return json({ error: "采集服务尚未配置完成" }, 503);
      const registered = sites(env);
      const admin = /^\/v1\/websites\/([\w-]{1,100})\/admin\/(login|report|settings|token|password)$/.exec(url.pathname);
      if (admin) {
        if (!registered[admin[1]]) return json({ error: '网站未登记' }, 404);
        return await adminRoute(request, env, admin[1], admin[2]);
      }
      if (url.pathname === "/collect" && request.method === "POST") {
        const body = await readSmallBody(request);
        if (!body || typeof body.id !== "string" || !/^[\w-]{1,100}$/.test(body.id) || !/^[\w-]{16,80}$/.test(body.eventId || ""))
          return json({ error: "无效事件" }, 400);
        const origin = request.headers.get("Origin"), allowed = registered[body.id];
        if (!Array.isArray(allowed) || !allowed.includes(origin)) return json({ error: "来源未登记" }, 403);
        const cors = { ...headers, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
        if (request.headers.get("DNT") === "1" || /bot|crawler|spider|headless/i.test(request.headers.get("User-Agent") || "") || /prefetch|prerender/i.test(request.headers.get("Sec-Purpose") || ""))
          return new Response(null, { status: 204, headers: cors });
        if (typeof body.path !== "string" || !body.path.startsWith("/") || body.path.startsWith("//") || body.path.length > 300)
          return json({ error: "无效路径" }, 400);
        if (/^\/(admin|api)(\/|$)/.test(body.path)) return new Response(null, { status: 204, headers: cors });
        if (body.type !== undefined && !['event', 'engagement'].includes(body.type)) return json({ error: '无效事件类型' }, 400);
        if (body.type === 'event' && !Object.hasOwn(EVENT_LABELS, body.name)) return json({ error: '未知功能事件' }, 400);
        if (body.type === 'engagement' && !validEngagement(body)) return json({ error: '无效停留快照' }, 400);
        if (body.sessionId !== undefined && !validSession(body)) return json({ error: '无效访问关联' }, 400);
        const ip = request.headers.get("CF-Connecting-IP");
        if (!ip || !env.RATE_LIMITER) return json({ error: "采集环境未就绪" }, 503);
        const d = day();
        const visitor = await hmac(env.VISITOR_SALT, `${body.id}|${d}|${ip}|${(request.headers.get("User-Agent") || "").slice(0, 300)}`);
        const rateKey = await hmac(env.VISITOR_SALT, `${body.id}|${d}|${ip}`);
        if (!(await env.RATE_LIMITER.limit({ key: rateKey })).success)
          return new Response(null, { status: 429, headers: { ...cors, "Retry-After": "60" } });
        const now = new Date().toISOString(), path = body.path.split(/[?#]/)[0];
        const info = deviceInfo(request.headers.get('User-Agent') || ''), referrer = sourceHost(body.referrer);
        const trafficVisitor = body.sessionId ? await hmac(env.VISITOR_SALT, `traffic-v1|${body.id}|${ip}|${(request.headers.get('User-Agent') || '').slice(0, 300)}`) : '';
        if (body.type === 'engagement') {
          if (body.id !== 'replay' || !(await settings(env, body.id)).eventsEnabled) return new Response(null, { status: 204, headers: cors });
          await saveEngagement(env, body, path, now, deviceInfo(request.headers.get('User-Agent') || ''), sourceHost(body.referrer));
          await saveTraffic(env, body, path, now, trafficVisitor, info, referrer);
          return new Response(null, { status: 204, headers: cors });
        }
        if (body.type === 'event') {
          if (!(await settings(env, body.id)).eventsEnabled) return new Response(null, { status: 204, headers: cors });
          await env.DB.prepare('INSERT OR IGNORE INTO product_events(site_id,event_id,day,visitor,name,path,received_at) VALUES (?,?,?,?,?,?,?)').bind(body.id, body.eventId, d, visitor, body.name, path, now).run();
          return new Response(null, { status: 204, headers: cors });
        }
        await env.DB.batch([
          env.DB.prepare("INSERT OR IGNORE INTO visits(site_id,event_id,day,visitor,path,received_at) VALUES (?,?,?,?,?,?)").bind(body.id, body.eventId, d, visitor, path, now),
          env.DB.prepare("INSERT INTO site_state(site_id,first_seen,last_seen) VALUES (?,?,?) ON CONFLICT(site_id) DO UPDATE SET last_seen=excluded.last_seen").bind(body.id, now, now),
          env.DB.prepare('INSERT OR IGNORE INTO visit_metadata(site_id,event_id,day,device,browser,referrer) VALUES (?,?,?,?,?,?)').bind(body.id, body.eventId, d, info.device, info.browser, referrer),
        ]);
        await saveTraffic(env, body, path, now, trafficVisitor, info, referrer);
        return new Response(null, { status: 204, headers: cors });
      }
      const match = /^\/v1\/websites\/([\w-]{1,100})\/(status|data)$/.exec(url.pathname);
      if (!match || request.method !== "GET") return json({ error: "Not found" }, 404);
      if (!await authorized(request, env.READ_TOKEN)) return json({ error: "读取密钥无效" }, 401);
      const [, id, action] = match;
      if (!registered[id]) return json({ error: "网站未登记" }, 404);
      const state = await env.DB.prepare("SELECT first_seen,last_seen FROM site_state WHERE site_id=?").bind(id).first();
      const coverageStart = state ? [day(Date.parse(state.first_seen)), offset(day(), -399)].sort().at(-1) : null;
      const meta = { app: "yilan-collector", version: 1, siteId: id, origins: registered[id], timezone: "Asia/Shanghai", firstSeen: state?.first_seen || null, lastReceivedAt: state?.last_seen || null, coverageStart, retentionDays: 400 };
      if (action === "status") return json(meta);
      const start = url.searchParams.get("start"), end = url.searchParams.get("end");
      if (!validDay(start) || !validDay(end) || start > end || end > day() || (Date.parse(end) - Date.parse(start)) / 86400000 >= 90)
        return json({ error: "请选择不超过 90 天且不晚于今天的范围" }, 400);
      const [daily, pages] = await env.DB.batch([
        env.DB.prepare("SELECT day AS date,count(*) AS pageviews,count(DISTINCT visitor) AS visitors FROM visits WHERE site_id=? AND day>=? AND day<=? GROUP BY day ORDER BY day").bind(id, start, end),
        env.DB.prepare("SELECT day AS date,path,count(*) AS views FROM visits WHERE site_id=? AND day>=? AND day<=? GROUP BY day,path ORDER BY day,path LIMIT 10001").bind(id, start, end),
      ]);
      if (pages.results.length > 10000) return json({ error: "页面数据量较大，请缩短同步范围" }, 413);
      const byDate = new Map(daily.results.map(row => [row.date, row]));
      const points = [];
      if (coverageStart) for (let date = start; date <= end; date = offset(date, 1)) {
        if (date >= coverageStart) points.push(byDate.get(date) || { date, pageviews: 0, visitors: 0 });
      }
      return json({ ...meta, points, pages: pages.results });
    } catch {
      return json({ error: "采集服务暂时不可用，请检查数据库初始化与服务配置" }, 503);
    }
  },
  async scheduled(_event, env) {
    await env.DB.prepare("DELETE FROM visits WHERE day < ?").bind(offset(day(), -399)).run();
    await env.DB.prepare('DELETE FROM visit_metadata WHERE day < ?').bind(offset(day(), -399)).run();
    await env.DB.prepare('DELETE FROM product_events WHERE day < ?').bind(offset(day(), -399)).run();
    await env.DB.prepare('DELETE FROM page_engagement WHERE updated_at < ?').bind(offset(day(), -399)).run();
    await env.DB.prepare('DELETE FROM traffic_pages WHERE updated_at < ?').bind(offset(day(), -399)).run();
  },
};
