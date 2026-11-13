import 'server-only';
import { cookies } from 'next/headers';
import type { AccountState, AccountUser } from './account-types';
export const USER_COOKIE = 'replay_user';
export class AccountError extends Error { constructor(message: string, public status = 503) { super(message); } }
export function accountMode(): AccountState['mode'] {
  if (process.env.REPLAY_ACCOUNTS_URL && process.env.REPLAY_ACCOUNTS_SECRET) return 'accounts';
  return process.env.REPLAY_LOCAL_MODE === '1' ? 'local' : 'unavailable';
}
export async function accountService(path: string, method = 'GET', body?: unknown, session = '', clientKey = '') {
  const endpoint = process.env.REPLAY_ACCOUNTS_URL;
  const secret = process.env.REPLAY_ACCOUNTS_SECRET;
  if (!endpoint || !secret) throw new AccountError('账号服务暂时不可用，你仍可先试学。');
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === '127.0.0.1'))) throw new AccountError('账号服务配置无效');
  const response = await fetch(`${url.origin}${path}`, { method, headers: { Authorization: `Bearer ${secret}`, ...(session ? { 'X-User-Session': session } : {}), ...(clientKey ? { 'X-Client-Key': clientKey } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) throw new AccountError(typeof data.error === 'string' ? data.error : '账号服务连接失败', response.status);
  return data;
}
export async function readAccount(): Promise<AccountState> {
  const mode = accountMode();
  if (mode !== 'accounts') return { user: null, mode };
  const token = (await cookies()).get(USER_COOKIE)?.value || '';
  if (!/^[a-f0-9]{64}$/.test(token)) return { user: null, mode };
  try { const data = await accountService('/session', 'GET', undefined, token); return { mode, user: data.user as AccountUser }; }
  catch (error) { if (error instanceof AccountError && error.status === 401) return { user: null, mode }; throw error; }
}
