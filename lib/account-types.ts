export type AccountUser = { id: string; username: string; createdAt: string };
export type AccountDay = { day: string; seconds: number; actions: number };
export type AccountSummary = { user: AccountUser; goalSeconds: number; today: AccountDay; totalSeconds: number; learningDays: number; streak: number; days: AccountDay[] };
export type AccountState = { user: AccountUser | null; mode: 'accounts' | 'local' | 'unavailable' };
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1200 || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/learn';
  try {
    const url = new URL(value, 'https://return.invalid');
    if (url.origin !== 'https://return.invalid' || !/^\/(learn|account|review)(\/|$)/.test(url.pathname) || /^\/account\/(recover|login)/.test(url.pathname)) return '/learn';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/learn'; }
}
export const normalizeUsername = (value: unknown) => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
export const validUsername = (value: string) => new RegExp('^[\\p{L}\\p{N}_-]{2,24}$', 'u').test(value);
