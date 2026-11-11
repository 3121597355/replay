import { engagementReport } from './engagement.mjs';
import { trafficReport } from './traffic.mjs';
export const EVENT_LABELS = {
  sample_ready: '试学素材就绪', video_import: '导入本地视频', subtitle_import: '导入字幕',
  learning_start: '开始播放学习', word_lookup: '点词查询', word_save: '收藏生词',
  cue_save: '收藏句子', export_anki: '导出 Anki', export_srt: '导出 SRT',
  export_vtt: '导出 VTT', download_import: '下载素材导入', sample_error: '试学加载失败',
  video_error: '视频播放失败', loop_enable: '开启单句循环',
};
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const same = (a, b) => { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; };
const hmac = async (secret, value) => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
};
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function smallJson(request) {
  if (Number(request.headers.get('content-length')) > 2048 || !request.body) return null;
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2048) { await reader.cancel(); return null; } chunks.push(value); }
  const bytes = new Uint8Array(size); let pos = 0; for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}
export async function settings(env, id) {
  const row = await env.DB.prepare('SELECT data FROM admin_settings WHERE site_id=?').bind(id).first();
  return { apiEnabled: false, eventsEnabled: true, exportsEnabled: true, sessionVersion: 0, ...(row ? JSON.parse(row.data) : {}) };
}
async function saveSettings(env, id, value) {
  await env.DB.prepare('INSERT INTO admin_settings(site_id,data) VALUES (?,?) ON CONFLICT(site_id) DO UPDATE SET data=json_patch(admin_settings.data,excluded.data)').bind(id, JSON.stringify(value)).run();
}
const safeSettings = value => ({ apiEnabled: value.apiEnabled, eventsEnabled: value.eventsEnabled, exportsEnabled: value.exportsEnabled, hasToken: !!value.tokenHash, tokenUpdatedAt: value.tokenUpdatedAt || null, timezone: 'Asia/Shanghai', retentionDays: 400 });
export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000 }, key, 256));
}
export async function isAdmin(request, env, id) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const [prefix, body, signature] = token.split('.');
  if (!env.REPLAY_ADMIN_SECRET || prefix !== 'rpa' || !body || !signature || token.length > 1024) return false;
  if (!same(await hmac(env.REPLAY_ADMIN_SECRET, body), signature)) return false;
  try { const payload = JSON.parse(atob(body)); const config = await settings(env, id); return payload.site === id && payload.exp > Date.now() && payload.scope === 'admin' && (payload.version ?? 0) === config.sessionVersion; } catch { return false; }
}
async function canRead(request, env, id, config) {
  if (await isAdmin(request, env, id)) return true;
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  return config.apiEnabled && !!config.tokenHash && token.length <= 200 && same(await sha256(token), config.tokenHash);
}
const offset = (date, n) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
const day = () => new Date(Date.now() + 28800000).toISOString().slice(0, 10);
function range(url) {
  const start = url.searchParams.get('start') || offset(day(), -6), end = url.searchParams.get('end') || day();
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return valid(start) && valid(end) && start <= end && end <= day() && Date.parse(end) - Date.parse(start) < 90 * 86400000 ? { start, end } : null;
}
export function sourceHost(value) {
  if (!value) return 'direct';
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.hostname.toLowerCase().slice(0, 200) : 'direct'; } catch { return 'direct'; }
}
export function deviceInfo(ua) {
  const device = /ipad|tablet/i.test(ua) ? 'tablet' : /mobile|iphone|android/i.test(ua) ? 'mobile' : 'desktop';
  const browser = /edg\//i.test(ua) ? 'Edge' : /firefox\//i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'Other';
  return { device, browser };
}
async function report(env, id, dates) {
  const { start, end } = dates;
  const query = sql => env.DB.prepare(sql).bind(id, start, end);
  const rows = await env.DB.batch([
    query('SELECT day AS date,count(*) AS pageviews,count(DISTINCT visitor) AS visitors FROM visits WHERE site_id=? AND day>=? AND day<=? GROUP BY day ORDER BY day'),
    query('SELECT path,count(*) AS views FROM visits WHERE site_id=? AND day>=? AND day<=? GROUP BY path ORDER BY views DESC LIMIT 1000'),
    query('SELECT name,count(*) AS count FROM product_events WHERE site_id=? AND day>=? AND day<=? GROUP BY name ORDER BY count DESC'),
    query('SELECT day AS date,name,count(*) AS count,count(DISTINCT visitor) AS visitors FROM product_events WHERE site_id=? AND day>=? AND day<=? GROUP BY day,name ORDER BY day,name'),
    query('SELECT device AS name,count(*) AS count FROM visit_metadata WHERE site_id=? AND day>=? AND day<=? GROUP BY device ORDER BY count DESC'),
    query('SELECT browser AS name,count(*) AS count FROM visit_metadata WHERE site_id=? AND day>=? AND day<=? GROUP BY browser ORDER BY count DESC'),
    query('SELECT referrer AS name,count(*) AS count FROM visit_metadata WHERE site_id=? AND day>=? AND day<=? GROUP BY referrer ORDER BY count DESC LIMIT 100'),
    env.DB.prepare('SELECT first_seen,last_seen FROM site_state WHERE site_id=?').bind(id),
    query('SELECT day,count(DISTINCT visitor) AS visitors FROM product_events WHERE site_id=? AND day>=? AND day<=? AND name IN (\'sample_ready\',\'video_import\',\'download_import\') GROUP BY day'),
  ]);
  const daily = new Map(rows[0].results.map(r => [r.date, r]));
  const state = rows[7].results[0];
  const coverageStart = state ? [new Date(Date.parse(state.first_seen) + 28800000).toISOString().slice(0, 10), offset(day(), -399)].sort().at(-1) : null;
  const points = [];
  if (coverageStart) for (let date = start; date <= end; date = offset(date, 1)) if (date >= coverageStart) points.push(daily.get(date) || { date, pageviews: 0, visitors: 0 });
  const pageviews = points.reduce((sum, p) => sum + p.pageviews, 0), visitorDays = points.reduce((sum, p) => sum + p.visitors, 0);
  const events = rows[2].results.map(row => ({ ...row, label: EVENT_LABELS[row.name] || row.name }));
  const learningVisitorDays = rows[8].results.reduce((sum, r) => sum + r.visitors, 0);
  return { schemaVersion: 1, siteId: id, timezone: 'Asia/Shanghai', ...dates, coverageStart, firstSeen: state?.first_seen || null, lastReceivedAt: state?.last_seen || null, generatedAt: new Date().toISOString(),
    summary: { pageviews, visitorDays, events: events.reduce((sum, e) => sum + e.count, 0), learningVisitorDays },
    points, pages: rows[1].results, pagesTruncated: rows[1].results.length === 1000, events, eventPoints: rows[3].results, devices: rows[4].results, browsers: rows[5].results, referrers: rows[6].results,
    engagement: await engagementReport(env, id, dates),
    traffic: await trafficReport(env, id, dates),
    definitions: { pageviews: '页面浏览次数；功能事件不计入 PV', visitors: '站点、日期、IP/UA 的匿名摘要，同日去重估算，不跨日识别', visitorDays: '区间内每日访客估算之和，不等于跨日去重人数', learningVisitorDays: '导入视频、下载导入或试学素材就绪的每日去重访客之和；不代表完成学习', dimensions: '来源与设备从升级后开始采集，历史访问不补造分布' } };
}
export async function adminRoute(request, env, id, action) {
  if (id !== (env.REPLAY_ADMIN_SITE || 'replay')) return json({ error: '未开放此站点管理' }, 404);
  const config = await settings(env, id);
  if (action === 'login' && request.method === 'POST') {
    if (!env.REPLAY_ADMIN_SECRET || !env.REPLAY_ADMIN_PASSWORD_HASH || !env.LOGIN_LIMITER) return json({ error: '后台管理员尚未配置' }, 503);
    if (!(await env.LOGIN_LIMITER.limit({ key: await hmac(env.REPLAY_ADMIN_SECRET, request.headers.get('CF-Connecting-IP') || 'local') })).success) return json({ error: '尝试过于频繁，请一分钟后再试' }, 429);
    if (Number(request.headers.get('content-length')) > 2048) return json({ error: '请求过大' }, 413);
    const input = await smallJson(request); if (!input) return json({ error: '请求格式无效或过大' }, 400);
    if (typeof input.password !== 'string' || input.password.length > 200) return json({ error: '账号或密码错误' }, 401);
    const [salt, expected] = (config.passwordHash || env.REPLAY_ADMIN_PASSWORD_HASH).split(':');
    if (input.username !== 'admin' || !salt || !expected || !same(await passwordHash(input.password, salt), expected)) return json({ error: '账号或密码错误' }, 401);
    const body = btoa(JSON.stringify({ site: id, scope: 'admin', version: config.sessionVersion, exp: Date.now() + 8 * 3600000 }));
    return json({ token: `rpa.${body}.${await hmac(env.REPLAY_ADMIN_SECRET, body)}`, expiresIn: 28800 });
  }
  if (action === 'report' && request.method === 'GET') {
    if (!await canRead(request, env, id, config)) return json({ error: '需要有效的管理员登录或统计只读密钥' }, 401);
    const dates = range(new URL(request.url));
    if (!dates) return json({ error: '请选择不超过 90 天且不晚于今天的有效日期范围' }, 400);
    return json({ ...await report(env, id, dates), capabilities: { exportsEnabled: config.exportsEnabled } });
  }
  if (!await isAdmin(request, env, id)) return json({ error: '请先登录后台' }, 401);
  if (action === 'password' && request.method === 'POST') {
    const input = await smallJson(request);
    if (!input || typeof input.currentPassword !== 'string' || input.currentPassword.length > 200 || typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) return json({ error: '新密码需为 12～128 个字符' }, 400);
    const [salt, expected] = (config.passwordHash || env.REPLAY_ADMIN_PASSWORD_HASH || '').split(':');
    if (!salt || !expected || !same(await passwordHash(input.currentPassword, salt), expected)) return json({ error: '当前密码不正确' }, 400);
    if (input.currentPassword === input.password) return json({ error: '请使用与当前密码不同的新密码' }, 400);
    const nextSalt = hex(crypto.getRandomValues(new Uint8Array(24)));
    await saveSettings(env, id, { passwordHash: nextSalt + ':' + await passwordHash(input.password, nextSalt), sessionVersion: config.sessionVersion + 1 });
    return json({ ok: true });
  }
  if (action === 'settings' && request.method === 'GET') return json(safeSettings(config));
  if (action === 'settings' && request.method === 'PUT') {
    const input = await smallJson(request); if (!input) return json({ error: '无效设置' }, 400);
    if (typeof input.apiEnabled !== 'boolean' || typeof input.eventsEnabled !== 'boolean' || typeof input.exportsEnabled !== 'boolean') return json({ error: '无效设置' }, 400);
    if (input.apiEnabled && !config.tokenHash) return json({ error: '请先生成统计只读密钥' }, 400);
    const next = { apiEnabled: input.apiEnabled, eventsEnabled: input.eventsEnabled, exportsEnabled: input.exportsEnabled };
    await saveSettings(env, id, next);
    return json(safeSettings({ ...config, ...next }));
  }
  if (action === 'token' && request.method === 'POST') {
    const token = `rps_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
    const next = { tokenHash: await sha256(token), tokenUpdatedAt: new Date().toISOString() };
    await saveSettings(env, id, next);
    return json({ token, ...safeSettings({ ...config, ...next }) });
  }
  return json({ error: '接口不存在' }, 404);
}
