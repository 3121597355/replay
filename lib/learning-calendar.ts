import type { AccountDay, AccountHistory } from './account-types';

const DAY = 86400000;
export const learningLevels = ['未学习', '不到 5 分钟', '5–15 分钟', '15–30 分钟', '30 分钟及以上'];

export function learningLevel(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return seconds < 300 ? 1 : seconds < 900 ? 2 : seconds < 1800 ? 3 : 4;
}

export function learningTime(seconds: number): string {
  const amount = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (!amount) return '0 分钟';
  if (amount < 60) return `${amount} 秒`;
  const hours = Math.floor(amount / 3600), minutes = Math.floor(amount % 3600 / 60), remainder = amount % 60;
  if (hours) return `${hours} 小时${minutes ? ` ${minutes} 分钟` : ''}`;
  return `${minutes} 分钟${remainder ? ` ${remainder} 秒` : ''}`;
}

export function calendarDate(day: string): string {
  const [year, month, date] = day.split('-');
  return `${year}年${Number(month)}月${Number(date)}日`;
}

export function buildLearningCalendar(history: AccountHistory) {
  // UTC is used only for date arithmetic. The API has already grouped Beijing dates.
  const start = Date.parse(`${history.start}T00:00:00Z`), end = Date.parse(`${history.end}T00:00:00Z`);
  const count = (end - start) / DAY + 1;
  if (!Number.isInteger(count) || count < 1 || count > 366) throw new Error('Invalid learning calendar range');
  const byDay = new Map(history.days.map(day => [day.day, day]));
  const days: AccountDay[] = Array.from({ length: count }, (_, index) => {
    const day = new Date(start + index * DAY).toISOString().slice(0, 10);
    const value = day <= history.today ? byDay.get(day) : undefined;
    return { day, seconds: Math.max(0, value?.seconds || 0), actions: Math.max(0, value?.actions || 0) };
  });
  const leading = new Date(start).getUTCDay();
  const weeks: (AccountDay | null)[][] = Array.from({ length: Math.ceil((leading + count) / 7) }, (_, week) =>
    Array.from({ length: 7 }, (_, row) => days[week * 7 + row - leading] || null));
  const months = [{ column: 0, label: `${Number(history.start.slice(5, 7))}月` }];
  for (const [index, day] of days.entries()) {
    if (index && day.day.endsWith('-01')) months.push({ column: Math.floor((leading + index) / 7), label: `${Number(day.day.slice(5, 7))}月` });
  }
  return {
    days, weeks, leading,
    months: months.filter((month, index) => !months[index + 1] || months[index + 1].column - month.column >= 3),
    learningDays: days.filter(day => day.seconds >= 180).length,
    seconds: days.reduce((total, day) => total + day.seconds, 0),
  };
}
