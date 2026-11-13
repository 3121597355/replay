import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handle, digest, beijingDay } from '../services/accounts/worker.mjs';
const NOW = Date.parse('2026-11-13T04:00:00Z'), DAY = 86400000;
const HASH = `scrypt$32768$8$3$${'a'.repeat(32)}$${'b'.repeat(64)}`;
const NEW_HASH = HASH.replace(/b/g, 'c'), RECOVERY = 'd'.repeat(64);
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../services/accounts/schema.sql', import.meta.url), 'utf8'));
  const prepare = sql => {
    const statement = db.prepare(sql); let values = [];
    const api = { bind(...args) { values = args; return api; }, async first() { return statement.get(...values) || null; }, async all() { return { results: statement.all(...values) }; }, async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; } };
    return api;
  };
  let transaction = Promise.resolve();
  const env = { ACCOUNT_SECRET: 'fixture-private-secret', DB: { prepare, batch(statements) { const result=transaction.then(async()=>{ db.exec('BEGIN'); try { const values=[]; for(const statement of statements) values.push(await statement.run()); db.exec('COMMIT'); return values; } catch(error) { db.exec('ROLLBACK'); throw error; } }); transaction=result.catch(()=>{}); return result; } } };
  const call = async (path, body, token = '', now = NOW, authorized = true) => {
    const response = await handle(new Request(`https://accounts.test${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(authorized ? { authorization: `Bearer ${env.ACCOUNT_SECRET}` } : {}), 'x-user-session': token, 'x-client-key': 'fixture-ip' }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
    return { status: response.status, data: await response.json() };
  };
  const signup = async (username = '测试账号', now = NOW) => { const result = await call('/signup', { username, passwordHash: HASH, recoveryHash: RECOVERY, source: 'xiaohongshu' }, '', now); assert.equal(result.status, 201); return result.data; };
  return { db, call, signup };
}
test('private endpoints reject callers without the service secret', async () => {
  const { call } = fixture();
  assert.equal((await call('/health', undefined, '', NOW, false)).status, 200);
  for (const path of ['/session', '/summary', '/admin/report']) assert.equal((await call(path, undefined, '', NOW, false)).status, 401);
  assert.equal((await call('/signup', {}, '', NOW, false)).status, 401);
});
test('signup normalizes names, hides credentials and stores only session digest', async () => {
  const { call, signup, db } = fixture(); const account = await signup(' Ａbc测试 ');
  assert.equal(account.user.username, 'abc测试'); assert.deepEqual(Object.keys(account.user).sort(), ['createdAt', 'id', 'username']);
  assert.equal(db.prepare('SELECT token_hash FROM sessions').get().token_hash, await digest(account.token));
  assert.equal((await call('/signup', { username: 'abc测试', passwordHash: HASH, recoveryHash: RECOVERY })).status, 409);
  assert.equal((await call('/signup', { username: '<bad>', passwordHash: HASH, recoveryHash: RECOVERY })).status, 400);
});
test('sessions expire after 30 days and logout revokes only that session', async () => {
  const { call, signup } = fixture(); const account = await signup();
  const second = (await call('/login-complete', { id: account.user.id, passwordHash: HASH })).data;
  assert.equal((await call('/session', undefined, account.token, NOW + 30 * DAY)).status, 401);
  await call('/logout', {}, account.token);
  assert.equal((await call('/session', undefined, account.token)).status, 401);
  assert.equal((await call('/session', undefined, second.token)).status, 200);
  assert.equal((await call('/login-complete', { id: account.user.id, passwordHash: NEW_HASH })).status, 401);
});
test('recovery rotates the code, revokes sessions and prevents old credential login', async () => {
  const { call, signup } = fixture(); const account = await signup();
  const body = { username: account.user.username, passwordHash: NEW_HASH, recoveryHash: RECOVERY, newRecoveryHash: 'e'.repeat(64) };
  assert.equal((await call('/recover', { ...body, recoveryHash: 'f'.repeat(64) })).status, 401);
  assert.equal((await call('/recover', body)).status, 200);
  assert.equal((await call('/session', undefined, account.token)).status, 401);
  assert.equal((await call('/recover', body)).status, 401);
  assert.equal((await call('/login-complete', { id: account.user.id, passwordHash: HASH })).status, 401);
  assert.equal((await call('/login-complete', { id: account.user.id, passwordHash: NEW_HASH })).status, 200);
});
test('learning seconds are bounded by elapsed time, retries deduplicate, accounts stay separate', async () => {
  const { call, signup } = fixture(); const first = await signup(), second = await signup('另一个用户');
  const body = { eventId: crypto.randomUUID(), seconds: 60, action: 'play' };
  await call('/activity', body, first.token, NOW + 25000);
  assert.equal((await call('/activity', body, first.token, NOW + 45000)).data.duplicate, true);
  assert.equal((await call('/summary', undefined, first.token, NOW + 50000)).data.today.seconds, 25);
  assert.equal((await call('/summary', undefined, second.token, NOW + 50000)).data.today.seconds, 0);
  assert.equal((await call('/activity', { ...body, eventId: crypto.randomUUID(), seconds: 61 }, first.token)).status, 400);
  assert.equal((await call('/activity', { ...body, action: 'arbitrary' }, first.token)).status, 400);
});
test('rate limits restrict signup and login guesses independently', async () => {
  const { call } = fixture();
  for (let i = 0; i < 5; i++) assert.equal((await call('/preflight', { kind: 'signup' })).status, 200);
  assert.equal((await call('/preflight', { kind: 'signup' })).status, 429);
  assert.equal((await call('/preflight', { kind: 'recover' })).status, 200);
  for (let i = 0; i < 8; i++) assert.equal((await call('/login-check', { username: '不存在' })).status, 200);
  assert.equal((await call('/login-check', { username: '不存在' })).status, 429);
  assert.equal((await call('/login-check', { username: '不存在' }, '', NOW + 900000)).status, 200);
});
test('Beijing calendar cohorts wait until observation days end and exclude synthetic users', async () => {
  const { call, signup, db } = fixture();
  const old = await signup('老用户', NOW - 8 * DAY), immature = await signup('昨天用户', NOW - DAY), synthetic = await signup('自动验收', NOW - 8 * DAY);
  await call('/admin/mark-test', { id: synthetic.user.id });
  for (const user of [old, synthetic]) for (const offset of [7, 1]) db.prepare('INSERT INTO activity VALUES(?,?,?,?,?,?)').run(user.user.id, crypto.randomUUID(), beijingDay(NOW - offset * DAY), 180, 'play', new Date(NOW - offset * DAY).toISOString());
  const report = (await call('/admin/report')).data;
  assert.equal(report.summary.registeredUsers, 2); assert.equal(report.users.length, 2);
  assert.deepEqual(report.summary.d1, { eligible: 1, returned: 1, rate: 100 });
  assert.deepEqual(report.summary.d7, { eligible: 1, returned: 1, rate: 100 });
  assert.equal(report.cohorts.find(row => row.day === beijingDay(NOW - DAY)).d1Rate, null);
  assert.equal(report.sources[0].count, 2);
  assert.equal(report.summary.active7, 1);
  assert.equal(beijingDay(Date.parse('2026-11-12T16:01:00Z')), '2026-11-13');
  assert.equal(immature.user.username, '昨天用户');
});
test('reports reject normalized invalid dates and too-wide ranges', async () => {
  const { call } = fixture();
  for (const query of ['start=2026-02-31&end=2026-03-01', 'start=2026-01-01&end=2026-11-13', 'end=2026-11-14']) assert.equal((await call(`/admin/report?${query}`)).status, 400);
});
test('personal calendar returns private natural years without changing weekly or lifetime totals', async () => {
  const { call, signup, db } = fixture();
  const first = await signup('日历用户'), other = await signup('另一位用户');
  const insert = (user, offset, seconds) => db.prepare('INSERT INTO activity VALUES(?,?,?,?,?,?)').run(user.user.id, crypto.randomUUID(), beijingDay(NOW - offset * DAY), seconds, 'play', new Date(NOW - offset * DAY).toISOString());
  insert(first, 365, 90); insert(first, 364, 300); insert(first, 0, 60); insert(first, 0, 120); insert(first, -1, 8000);
  insert(other, 0, 7200);
  const response = await call('/summary', undefined, first.token);
  assert.equal(response.status, 200);
  assert.equal(response.data.days.length, 7);
  assert.equal(response.data.today.seconds, 180);
  assert.equal(response.data.totalSeconds, 570);
  assert.deepEqual(response.data.history, { year: 2026, years: [2026, 2025, 2024, 2023, 2022], today: beijingDay(NOW), start: '2026-01-01', end: '2026-12-31', timeZone: 'Asia/Shanghai', days: [
    { day: beijingDay(NOW), seconds: 180, actions: 2 },
  ] });
  const previous = (await call('/summary?year=2025', undefined, first.token)).data;
  assert.deepEqual(previous.history.days, [
    { day: beijingDay(NOW - 365 * DAY), seconds: 90, actions: 1 },
    { day: beijingDay(NOW - 364 * DAY), seconds: 300, actions: 1 },
  ]);
  assert.equal(previous.today.seconds, 180); assert.equal(previous.totalSeconds, 570);
  assert.deepEqual((await call('/summary?year=2024', undefined, first.token)).data.history.days, []);
  for (const value of ['2027', '1999', '2025.0', '', 'abcd']) assert.equal((await call(`/summary?year=${value}`, undefined, first.token)).status, 400);
  assert.equal((await call('/summary')).status, 401);
  assert.equal((await call('/summary', undefined, 'f'.repeat(64))).status, 401);
  assert.equal((await call('/summary', undefined, other.token)).data.history.days[0].seconds, 7200);
});
test('account closure requires current credential and removes only that users data', async () => {
  const { call, signup, db } = fixture(); const first = await signup(), second = await signup('保留用户');
  await call('/activity', { eventId: crypto.randomUUID(), seconds: 20, action: 'play' }, first.token, NOW + 20000);
  assert.equal((await call('/close', { passwordHash: NEW_HASH }, first.token)).status, 401);
  assert.equal((await call('/close', { passwordHash: HASH }, first.token)).status, 200);
  assert.equal((await call('/session', undefined, first.token)).status, 401);
  assert.equal((await call('/session', undefined, second.token)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity').get().n, 0);
});
const emailChallenge = async (call, email, purpose = 'signup', token = '', now = NOW) => {
  const response = await call('/email-code', { email, purpose }, token, now);
  assert.equal(response.status, 200);
  await call('/email-sent', { challengeId: response.data.challengeId }, '', now);
  return { email, code: response.data.code, challengeId: response.data.challengeId };
};
test('email signup proves ownership, stores a digest and rejects cross-purpose, replay and duplicate mailbox', async () => {
  const { call, db } = fixture();
  const proof = await emailChallenge(call, 'Test@Example.com');
  assert.notEqual(db.prepare('SELECT code_hash FROM email_challenges').get().code_hash, proof.code);
  assert.equal((await call('/email-recover', { ...proof, passwordHash: HASH })).status, 401);
  const result = await call('/email-signup', { ...proof, username: '邮箱新用户', passwordHash: HASH });
  assert.equal(result.status, 201); assert.equal(result.data.user.email, 'test@example.com');
  assert.equal((await call('/email-signup', { ...proof, username: '重放用户', passwordHash: HASH })).status, 401);
  assert.equal((await call('/email-code', { email: 'test@example.com', purpose: 'signup' })).status, 409);
  assert.equal((await call('/login-check', { username: 'TEST@example.com' })).data.credential.id, result.data.user.id);
  assert.equal((await call('/session', undefined, result.data.token)).data.user.email, 'test@example.com');
  assert.equal((await call('/close', { passwordHash: HASH }, result.data.token)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account_emails').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_challenges').get().n, 0);
});
test('email codes stay inactive before send, expire, lock after five wrong attempts and observe cooldown', async () => {
  const { call } = fixture();
  const pending = (await call('/email-code', { email: 'one@example.com', purpose: 'signup' })).data;
  const proof = { email: 'one@example.com', code: pending.code, challengeId: pending.challengeId, username: '错误测试', passwordHash: HASH };
  assert.equal((await call('/email-signup', proof)).status, 401);
  assert.equal((await call('/email-code', { email: proof.email, purpose: 'signup' })).status, 429);
  await call('/email-sent', { challengeId: pending.challengeId });
  const wrong = String((Number(proof.code) + 1) % 1000000).padStart(6, '0');
  for (let i=0;i<5;i++) assert.equal((await call('/email-signup', { ...proof, code: wrong })).status, 401);
  assert.equal((await call('/email-signup', proof)).status, 401);
  const fresh = await emailChallenge(call, proof.email, 'signup', '', NOW + 60000);
  assert.equal((await call('/email-signup', { ...proof, ...fresh }, '', NOW + 660000)).status, 401);
  assert.equal((await call('/email-code', { email: 'bad', purpose: 'signup' })).status, 400);
});
test('old account email binding preserves ID and activity, verifies password and account, disables recovery codes', async () => {
  const { call, signup, db } = fixture();
  const a=await signup('老账号'), b=await signup('另一个账号');
  await call('/activity', { eventId: crypto.randomUUID(), seconds: 20, action: 'play' }, a.token, NOW + 20000);
  const proof = await emailChallenge(call, 'old@example.com', 'bind', a.token);
  assert.equal((await call('/email-bind', { ...proof, passwordHash: HASH }, b.token)).status, 401);
  assert.equal((await call('/email-bind', { ...proof, passwordHash: NEW_HASH }, a.token)).status, 401);
  const bound=await call('/email-bind', { ...proof, passwordHash: HASH }, a.token);
  assert.equal(bound.status,200); assert.equal(bound.data.user.id,a.user.id);
  assert.equal((await call('/summary',undefined,a.token)).data.today.seconds,20);
  assert.equal(db.prepare('SELECT recovery_hash FROM users WHERE id=?').get(a.user.id).recovery_hash,'disabled');
  assert.equal((await call('/email-bind', { ...proof, passwordHash: HASH }, a.token)).status,401);
  assert.equal((await call('/email-code',{ email:'not@example.com',purpose:'bind' })).status,401);
});
test('email reset revokes all old sessions, checks ownership and prevents code replay',async()=>{
  const { call,signup }=fixture();const user=await signup();
  const bind=await emailChallenge(call,'reset@example.com','bind',user.token);
  await call('/email-bind',{...bind,passwordHash:HASH},user.token);
  const other=(await call('/login-complete',{id:user.user.id,passwordHash:HASH})).data;
  const unknown=await call('/email-code',{email:'unknown@example.com',purpose:'recover'});
  assert.equal(unknown.data.skipped,true);assert.equal(unknown.data.code,undefined);
  const proof=await emailChallenge(call,'reset@example.com','recover');
  assert.equal((await call('/email-recover',{...proof,email:'unknown@example.com',passwordHash:NEW_HASH})).status,401);
  assert.equal((await call('/email-recover',{...proof,passwordHash:NEW_HASH})).status,200);
  for(const token of [user.token,other.token]) assert.equal((await call('/session',undefined,token)).status,401);
  assert.equal((await call('/login-complete',{id:user.user.id,passwordHash:HASH})).status,401);
  assert.equal((await call('/login-complete',{id:user.user.id,passwordHash:NEW_HASH})).status,200);
  assert.equal((await call('/email-recover',{...proof,passwordHash:NEW_HASH})).status,401);
});
test('email uniqueness rolls back the consumed code so the user can fix the username',async()=>{
  const {call,signup,db}=fixture();await signup('占用名字');
  const proof=await emailChallenge(call,'unique@example.com');
  assert.equal((await call('/email-signup',{...proof,username:'占用名字',passwordHash:HASH})).status,409);
  assert.equal(db.prepare('SELECT used FROM email_challenges WHERE id=?').get(proof.challengeId).used,'');
  assert.equal((await call('/email-signup',{...proof,username:'可用名字',passwordHash:HASH})).status,201);
});

test('concurrent use of a correct email code creates exactly one account and one binding',async()=>{
 const {call,db}=fixture();const proof=await emailChallenge(call,'race@example.com');
 const results=await Promise.all([call('/email-signup',{...proof,username:'并发一',passwordHash:HASH}),call('/email-signup',{...proof,username:'并发二',passwordHash:HASH})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,401]);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account_emails').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
});
