const json = (data, status = 200) => Response.json(data, { status });
const error = (text, status = 400) => json({ error: text }, status);
export const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const validEmail = value => value.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value) && value.split('@')[0].length <= 64;
async function codeHash(env, id, code) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.ACCOUNT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}:${code}`))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function emailAction({ path, body, env, now, clientKey, user, rate, hashPattern, issueSession }) {
  const email = normalizeEmail(body.email);
  if (path === '/email-sent') {
    await env.DB.prepare('UPDATE email_challenges SET sent=1 WHERE id=? AND used=\'\'').bind(String(body.challengeId || '')).run();
    return json({ ok: true });
  }
  if (!validEmail(email)) return error('请填写有效的邮箱地址');
  const purpose = path === '/email-code' ? body.purpose : path === '/email-signup' ? 'signup' : path === '/email-recover' ? 'recover' : 'bind';
  if (!['signup', 'recover', 'bind'].includes(purpose)) return error('请求无效');
  if (purpose === 'bind' && !user) return error('请先登录', 401);
  const owned = await env.DB.prepare('SELECT * FROM account_emails WHERE email=?').bind(email).first();
  const subject = purpose === 'bind' ? user.id : purpose === 'recover' ? owned?.user_id || '' : '';
  if (path === '/email-code') {
    // Same response for an unknown recovery mailbox; no message is sent.
    if (!await rate(env, `mail-ip:${clientKey}`, 10, 3600000, now)) return error('发送过于频繁，请稍后再试', 429);
    if (purpose === 'recover' && !owned) return json({ challengeId: crypto.randomUUID(), skipped: true });
    if (owned && purpose !== 'recover') return error('这个邮箱已绑定账号，请直接登录', 409);
    const existing = await env.DB.prepare('SELECT created_at FROM email_challenges WHERE email=? AND purpose=? AND subject=?').bind(email, purpose, subject).first();
    if (existing && now - existing.created_at < 60000) return error('请等待 60 秒后再发送', 429);
    if (!await rate(env, `mail-address:${email}`, 5, 3600000, now) || !await rate(env, `mail-day:${email}`, 10, 86400000, now) || !await rate(env, 'mail-global', 90, 86400000, now)) return error('今日邮件发送额度已到，请稍后再试', 429);
    const id = crypto.randomUUID();
    // Rejection sampling keeps all six-digit codes equally likely.
    let value; do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4294000000);
    const code = String(value % 1000000).padStart(6, '0');
    const result = await env.DB.prepare(`INSERT INTO email_challenges(id,email,purpose,subject,code_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(email,purpose,subject) DO UPDATE SET id=excluded.id,code_hash=excluded.code_hash,created_at=excluded.created_at,expires_at=excluded.expires_at,sent=0,attempts=0,used='' WHERE email_challenges.created_at<=?`).bind(id, email, purpose, subject, await codeHash(env, id, code), now, now + 600000, now - 60000).run();
    if (!result.meta.changes) return error('请等待 60 秒后再发送', 429);
    await env.DB.prepare('DELETE FROM email_challenges WHERE expires_at<?').bind(now - 86400000).run();
    // Returned only to the authenticated Next server, never to the browser.
    return json({ challengeId: id, code });
  }
  if (!/^[0-9]{6}$/.test(body.code || '') || !/^[a-f0-9-]{36}$/.test(body.challengeId || '')) return error('请填写邮件中的 6 位验证码');
  const challenge = await env.DB.prepare(`SELECT * FROM email_challenges WHERE id=? AND email=? AND purpose=? AND subject=? AND sent=1 AND used='' AND attempts<5 AND expires_at>?`).bind(body.challengeId, email, purpose, subject, now).first();
  const invalid = () => error('验证码无效或已过期，请重新获取', 401);
  if (!challenge) return invalid();
  const supplied = await codeHash(env, challenge.id, body.code);
  let difference = 0; for (let i = 0; i < supplied.length; i++) difference |= supplied.charCodeAt(i) ^ challenge.code_hash.charCodeAt(i);
  if (difference) { await env.DB.prepare(`UPDATE email_challenges SET attempts=attempts+1 WHERE id=? AND used=''`).bind(challenge.id).run(); return invalid(); }
  if (!hashPattern.test(body.passwordHash || '')) return error('密码信息无效');
  if (purpose === 'bind' && body.passwordHash !== user.password_hash) return error('当前密码不正确', 401);
  const claim = crypto.randomUUID();
  const id = purpose === 'signup' ? crypto.randomUUID() : purpose === 'bind' ? user.id : owned?.user_id;
  if (!id) return invalid();
  const username = typeof body.username === 'string' ? body.username.normalize('NFKC').trim().toLowerCase() : '';
  if (purpose === 'signup' && !/^[\p{L}\p{N}_-]{2,24}$/u.test(username)) return error('用户名格式无效');
  const stamp = new Date(now).toISOString();
  const source = typeof body.source === 'string' && /^[a-z0-9._-]{1,100}$/i.test(body.source) ? body.source.toLowerCase() : 'direct';
  const consume = env.DB.prepare(`UPDATE email_challenges SET used=? WHERE id=? AND code_hash=? AND sent=1 AND used='' AND attempts<5 AND expires_at>?${purpose === 'bind' ? ' AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)' : ''}`).bind(claim, challenge.id, supplied, now, ...(purpose === 'bind' ? [id, body.passwordHash] : []));
  const proof = `EXISTS(SELECT 1 FROM email_challenges WHERE id=? AND used=?)`;
  const statements = [consume];
  if (purpose === 'signup') statements.push(env.DB.prepare(`INSERT INTO users(id,username,password_hash,recovery_hash,source,created_at) SELECT ?,?,?,?,?,? WHERE ${proof}`).bind(id, username, body.passwordHash, 'disabled', source, stamp, challenge.id, claim));
  if (purpose !== 'recover') statements.push(env.DB.prepare(`INSERT INTO account_emails(user_id,email,verified_at) SELECT ?,?,? WHERE ${proof} ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at`).bind(id, email, stamp, challenge.id, claim));
  if (purpose === 'bind') statements.push(env.DB.prepare(`UPDATE users SET recovery_hash='disabled' WHERE id=? AND ${proof}`).bind(id, challenge.id, claim));
  if (purpose === 'recover') {
    statements.push(env.DB.prepare(`UPDATE users SET password_hash=?,recovery_hash='disabled' WHERE id=? AND ${proof}`).bind(body.passwordHash, id, challenge.id, claim));
    statements.push(env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND ${proof}`).bind(id, challenge.id, claim));
  }
  let results;
  try { results = await env.DB.batch(statements); }
  catch (issue) { if (/UNIQUE constraint failed/i.test(String(issue))) return error('用户名或邮箱已被使用，请更换或登录', 409); throw issue; }
  if (!results[0].meta.changes) return invalid();
  if (purpose === 'recover') return json({ ok: true });
  const account = await env.DB.prepare('SELECT u.*,e.email FROM users u LEFT JOIN account_emails e ON e.user_id=u.id WHERE u.id=?').bind(id).first();
  return purpose === 'signup' ? json(await issueSession(env, account, now), 201) : json({ ok: true, user: { id: account.id, username: account.username, createdAt: account.created_at, email: account.email } });
}
