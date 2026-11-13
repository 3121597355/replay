import { emailAction, normalizeEmail, validEmail } from './email.mjs';
const DAY = 86400000;
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const problem = (message, status = 400) => json({ error: message }, status);
export const beijingDay = time => new Date(time + 28800000).toISOString().slice(0, 10);
export const normalizeUsername = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
export const validUsername = value => /^[\p{L}\p{N}_-]{2,24}$/u.test(value);
const hashPattern = /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{64}$/;
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function equalSecret(first, second) {
  if (!first || !second) return false;
  const [left, right] = await Promise.all([digest(first), digest(second)]);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
const publicUser = user => ({ id: user.id, username: user.username, createdAt: user.created_at, ...(user.email ? { email: user.email } : {}) });
async function rate(env, key, limit, period, now) {
  const bucket = Math.floor(now / period);
  const id = await digest(`${env.ACCOUNT_SECRET}:${key}:${bucket}`);
  const result = await env.DB.prepare('INSERT INTO rate_windows(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(id, now + period).first();
  return result.count <= limit;
}
async function session(request, env, now) {
  const token = request.headers.get('x-user-session') || '';
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await digest(token);
  const record = await env.DB.prepare('SELECT u.*,e.email,s.token_hash,s.activity_at,s.created_at AS session_created FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN account_emails e ON e.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').bind(tokenHash, new Date(now).toISOString()).first();
  return record;
}
async function issueSession(env, user, now) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  const expiresAt = new Date(now + 30 * DAY).toISOString();
  const inserted = await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) SELECT ?,id,?,? FROM users WHERE id=? AND password_hash=?').bind(await digest(token), new Date(now).toISOString(), expiresAt, user.id, user.password_hash).run();
  if (!inserted.meta.changes) throw new Error('Credential changed');
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(new Date(now).toISOString()).run();
  await env.DB.prepare('DELETE FROM rate_windows WHERE expires_at<?').bind(now).run();
  return { user: publicUser(user), token, expiresAt };
}
async function userSummary(env, user, now, year) {
  const result = await env.DB.prepare('SELECT day,SUM(seconds) AS seconds,COUNT(CASE WHEN action<>\'\' THEN 1 END) AS actions FROM activity WHERE user_id=? GROUP BY day ORDER BY day DESC').bind(user.id).all();
  const today = beijingDay(now);
  const rows = result.results.filter(row => row.day <= today);
  const currentYear = Number(today.slice(0, 4));
  const start = `${year}-01-01`, end = `${year}-12-31`;
  const years = [...new Set([...Array.from({ length: 5 }, (_, index) => currentYear - index), year, ...rows.map(row => Number(row.day.slice(0, 4)))])].filter(value => value >= 2000 && value <= currentYear).sort((a, b) => b - a);
  const byDay = new Map(rows.map(row => [row.day, row]));
  const validDays = rows.filter(row => row.seconds >= 180);
  let streak = 0;
  const offset = (byDay.get(today)?.seconds || 0) >= 180 ? 0 : 1;
  while ((byDay.get(beijingDay(now - (offset + streak) * DAY))?.seconds || 0) >= 180) streak++;
  return { user: publicUser(user), goalSeconds: 300, today: byDay.get(today) || { day: today, seconds: 0, actions: 0 }, totalSeconds: rows.reduce((sum, row) => sum + row.seconds, 0), learningDays: validDays.length, streak,
    days: Array.from({ length: 7 }, (_, index) => { const day = beijingDay(now - (6 - index) * DAY); return byDay.get(day) || { day, seconds: 0, actions: 0 }; }),
    history: { year, years, today, start, end, timeZone: 'Asia/Shanghai', days: rows.filter(row => row.day >= start && row.day <= end).reverse() } };
}
async function adminReport(env, start, end, now) {
  const daily = 'SELECT a.user_id,a.day,SUM(a.seconds) AS seconds FROM activity a JOIN users u ON u.id=a.user_id WHERE u.is_test=0 GROUP BY a.user_id,a.day';
  const cohortSql = `WITH daily AS (${daily}) SELECT date(u.created_at,'+8 hours') AS day,COUNT(*) AS users,SUM(EXISTS(SELECT 1 FROM daily d WHERE d.user_id=u.id AND d.seconds>=180 AND d.day=date(u.created_at,'+8 hours','+1 day'))) AS d1,SUM(EXISTS(SELECT 1 FROM daily d WHERE d.user_id=u.id AND d.seconds>=180 AND d.day=date(u.created_at,'+8 hours','+7 days'))) AS d7 FROM users u WHERE u.is_test=0 AND date(u.created_at,'+8 hours') BETWEEN ? AND ? GROUP BY day ORDER BY day DESC`;
  const [totals, registered, active7, active30, trend, cohorts, recent, sources] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS users FROM users WHERE is_test=0').first(),
    env.DB.prepare("SELECT COUNT(*) AS users FROM users WHERE is_test=0 AND date(created_at,'+8 hours') BETWEEN ? AND ?").bind(start, end).first(),
    env.DB.prepare(`WITH daily AS (${daily}) SELECT COUNT(DISTINCT user_id) AS users FROM daily WHERE day BETWEEN ? AND ? AND seconds>=180`).bind(beijingDay(now - 6 * DAY), beijingDay(now)).first(),
    env.DB.prepare(`WITH daily AS (${daily}) SELECT COUNT(DISTINCT user_id) AS users FROM daily WHERE day BETWEEN ? AND ? AND seconds>=180`).bind(beijingDay(now - 29 * DAY), beijingDay(now)).first(),
    env.DB.prepare("SELECT date(created_at,'+8 hours') AS date,COUNT(*) AS users FROM users WHERE is_test=0 AND date(created_at,'+8 hours') BETWEEN ? AND ? GROUP BY date ORDER BY date").bind(start, end).all(),
    env.DB.prepare(cohortSql).bind(start, end).all(),
    env.DB.prepare('SELECT u.id,u.username,u.source,u.created_at,COALESCE(SUM(a.seconds),0) AS seconds,MAX(CASE WHEN a.seconds>0 THEN a.created_at END) AS last_learning FROM users u LEFT JOIN activity a ON a.user_id=u.id WHERE u.is_test=0 GROUP BY u.id ORDER BY u.created_at DESC LIMIT 25').all(),
    env.DB.prepare("SELECT source AS name,COUNT(*) AS count FROM users WHERE is_test=0 AND date(created_at,'+8 hours') BETWEEN ? AND ? GROUP BY source ORDER BY count DESC").bind(start, end).all(),
  ]);
  const today = beijingDay(now);
  const cohortRows = cohorts.results.map(row => ({ ...row, d1Rate: row.day < beijingDay(now - DAY) ? row.d1 / row.users * 100 : null, d7Rate: row.day < beijingDay(now - 7 * DAY) ? row.d7 / row.users * 100 : null }));
  const retention = days => {
    const eligible = cohortRows.filter(row => row.day < beijingDay(now - days * DAY));
    const users = eligible.reduce((sum, row) => sum + row.users, 0);
    const returned = eligible.reduce((sum, row) => sum + (days === 1 ? row.d1 : row.d7), 0);
    return { eligible: users, returned, rate: users ? returned / users * 100 : null };
  };
  return { generatedAt: new Date(now).toISOString(), summary: { registeredUsers: totals.users, newUsers: registered.users, active7: active7.users, active30: active30.users, d1: retention(1), d7: retention(7) }, points: trend.results, cohorts: cohortRows, users: recent.results, sources: sources.results, definition: '注册用户来自实际账号；有效学习日为累计至少 3 分钟前台播放或主动复习。D1/D7 按注册后第 1/7 个北京时间自然日计算，观察日结束后才进入分母；测试账号排除。' };
}
export async function handle(request, env, now = Date.now()) {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'jushuo-accounts', version: 1 });
  if (!env.ACCOUNT_SECRET || !env.DB) return problem('账号服务尚未配置', 503);
  if (!await equalSecret(request.headers.get('authorization'), `Bearer ${env.ACCOUNT_SECRET}`)) return problem('无权访问', 401);
  const path = url.pathname;
  if (path.startsWith('/email-') && request.method !== 'POST') return problem('接口不存在', 404);
  const expected = { '/preflight': 'POST', '/signup': 'POST', '/login-check': 'POST', '/login-complete': 'POST', '/session': 'GET', '/logout': 'POST', '/recover': 'POST', '/recovery': 'POST', '/close': 'POST', '/summary': 'GET', '/activity': 'POST', '/admin/report': 'GET', '/admin/mark-test': 'POST' };
  if (expected[path] !== request.method && !['/email-code', '/email-sent', '/email-signup', '/email-recover', '/email-bind'].includes(path)) return problem('接口不存在', 404);
  let body = {};
  if (request.method === 'POST') {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 4096) return problem('请求过大', 413);
    try { body = JSON.parse(text || '{}'); } catch { return problem('请求格式无效'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return problem('请求格式无效');
  }
  const username = normalizeUsername(body.username);
  const clientKey = request.headers.get('x-client-key') || 'unknown';
  if (path.startsWith('/email-')) return emailAction({ path, body, env, now, clientKey, user: path === '/email-bind' || body.purpose === 'bind' ? await session(request, env, now) : null, rate, hashPattern, issueSession });
  if (path === '/preflight') {
    if (!['signup', 'recover'].includes(body.kind)) return problem('请求无效');
    const limit = body.kind === 'signup' ? 5 : 8;
    if (!await rate(env, `${body.kind}:${clientKey}`, limit, 3600000, now)) return problem('操作过于频繁，请稍后再试', 429);
    return json({ ok: true });
  }
  if (path === '/signup') {
    if (!validUsername(username) || !hashPattern.test(body.passwordHash || '') || !/^[a-f0-9]{64}$/.test(body.recoveryHash || '')) return problem('注册信息无效');
    const source = typeof body.source === 'string' && /^[a-z0-9._-]{1,100}$/i.test(body.source) ? body.source.toLowerCase() : 'direct';
    const user = { id: crypto.randomUUID(), username, created_at: new Date(now).toISOString(), password_hash: body.passwordHash };
    const result = await env.DB.prepare('INSERT OR IGNORE INTO users(id,username,password_hash,recovery_hash,source,created_at) VALUES(?,?,?,?,?,?)').bind(user.id, username, body.passwordHash, body.recoveryHash, source, user.created_at).run();
    if (!result.meta.changes) return problem('这个用户名已被使用，请换一个', 409);
    return json(await issueSession(env, user, now), 201);
  }
  if (path === '/login-check') {
    if (!await rate(env, `login:${clientKey}`, 30, 900000, now) || !await rate(env, `user:${username}:${clientKey}`, 8, 900000, now)) return problem('尝试过于频繁，请 15 分钟后再试', 429);
    const email = normalizeEmail(body.username);
    const user = validEmail(email) ? await env.DB.prepare('SELECT u.id,u.username,u.password_hash FROM users u JOIN account_emails e ON e.user_id=u.id WHERE e.email=?').bind(email).first() : validUsername(username) ? await env.DB.prepare('SELECT id,username,password_hash FROM users WHERE username=?').bind(username).first() : null;
    return json({ credential: user });
  }
  if (path === '/login-complete') {
    const user = await env.DB.prepare('SELECT u.*,e.email FROM users u LEFT JOIN account_emails e ON e.user_id=u.id WHERE u.id=? AND u.password_hash=?').bind(String(body.id || ''), String(body.passwordHash || '')).first();
    if (!user) return problem('用户名或密码不正确', 401);
    return json(await issueSession(env, user, now));
  }
  if (path === '/recover') {
    if (!validUsername(username) || !hashPattern.test(body.passwordHash || '') || !/^[a-f0-9]{64}$/.test(body.recoveryHash || '') || !/^[a-f0-9]{64}$/.test(body.newRecoveryHash || '')) return problem('恢复信息无效');
    const user = await env.DB.prepare('SELECT * FROM users WHERE username=? AND recovery_hash=?').bind(username, body.recoveryHash).first();
    if (!user) return problem('用户名或恢复码不正确', 401);
    const changed = await env.DB.prepare('UPDATE users SET password_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=? RETURNING id').bind(body.passwordHash, body.newRecoveryHash, user.id, body.recoveryHash).first();
    if (!changed) return problem('恢复码已经失效', 401);
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id).run();
    return json({ ok: true });
  }
  if (path === '/admin/report') {
    const start = url.searchParams.get('start') || beijingDay(now - 29 * DAY), end = url.searchParams.get('end') || beijingDay(now);
    const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!validDay(start) || !validDay(end) || start > end || end > beijingDay(now) || Date.parse(end) - Date.parse(start) > 89 * DAY) return problem('日期范围无效');
    return json(await adminReport(env, start, end, now));
  }
  if (path === '/admin/mark-test') {
    await env.DB.prepare('UPDATE users SET is_test=1 WHERE id=?').bind(String(body.id || '')).run();
    return json({ ok: true });
  }
  const user = await session(request, env, now);
  if (!user) return problem('登录已过期，请重新登录', 401);
  if (path === '/session') return json({ user: publicUser(user) });
  if (path === '/logout') { await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.token_hash).run(); return json({ ok: true }); }
  if (path === '/summary') {
    const currentYear = Number(beijingDay(now).slice(0, 4));
    const value = url.searchParams.get('year');
    const year = value === null ? currentYear : Number(value);
    if (value !== null && (!/^\d{4}$/.test(value) || year < 2000 || year > currentYear)) return problem('年份无效');
    return json(await userSummary(env, user, now, year));
  }
  if (path === '/close') {
    if (body.passwordHash !== user.password_hash) return problem('当前密码不正确', 401);
    const result = await env.DB.batch([
      env.DB.prepare('DELETE FROM email_challenges WHERE (subject=? OR email IN (SELECT email FROM account_emails WHERE user_id=?)) AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)').bind(user.id, user.id, user.id, body.passwordHash),
      env.DB.prepare('DELETE FROM account_emails WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)').bind(user.id, user.id, body.passwordHash),
      env.DB.prepare('DELETE FROM activity WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)').bind(user.id, user.id, body.passwordHash),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)').bind(user.id, user.id, body.passwordHash),
      env.DB.prepare('DELETE FROM users WHERE id=? AND password_hash=?').bind(user.id, body.passwordHash),
    ]);
    if (!result[4].meta.changes) return problem('密码已变更，请重新登录', 401);
    return json({ ok: true });
  }
  if (path === '/recovery') {
    if (body.passwordHash !== user.password_hash || !/^[a-f0-9]{64}$/.test(body.recoveryHash || '')) return problem('当前密码不正确', 401);
    const result = await env.DB.prepare('UPDATE users SET recovery_hash=? WHERE id=? AND password_hash=?').bind(body.recoveryHash, user.id, body.passwordHash).run();
    if (!result.meta.changes) return problem('密码已变更，请重新登录', 401);
    return json({ ok: true });
  }
  if (path === '/activity') {
    if (!/^[a-z0-9-]{16,80}$/i.test(body.eventId || '') || !Number.isInteger(body.seconds) || body.seconds < 0 || body.seconds > 60 || !['', 'play', 'save', 'loop', 'review'].includes(body.action)) return problem('学习记录无效');
    if (!await rate(env, `activity:${user.id}`, 30, 60000, now)) return problem('记录过于频繁', 429);
    const elapsed = Math.max(0, Math.floor((now - Date.parse(user.activity_at || user.session_created)) / 1000));
    const seconds = Math.min(body.seconds, elapsed, 60);
    const result = await env.DB.prepare('INSERT OR IGNORE INTO activity(user_id,event_id,day,seconds,action,created_at) VALUES(?,?,?,?,?,?)').bind(user.id, body.eventId, beijingDay(now), seconds, body.action, new Date(now).toISOString()).run();
    if (result.meta.changes && seconds > 0) await env.DB.prepare('UPDATE sessions SET activity_at=? WHERE token_hash=?').bind(new Date(now).toISOString(), user.token_hash).run();
    return json({ ok: true, duplicate: !result.meta.changes });
  }
  return problem('接口不存在', 404);
}
export default { async fetch(request, env) { try { return await handle(request, env); } catch { return problem('账号服务暂时不可用，请稍后重试', 503); } } };
