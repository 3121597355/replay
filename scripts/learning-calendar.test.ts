import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLearningCalendar, learningLevel, learningTime } from '../lib/learning-calendar';

test('natural year includes all twelve months, leap day and ignores future or other-year records', () => {
  const history = { year: 2024, years: [2024, 2023], today: '2024-02-29', start: '2024-01-01', end: '2024-12-31', timeZone: 'Asia/Shanghai' as const, days: [
    { day: '2024-01-01', seconds: 60, actions: 1 },
    { day: '2024-02-29', seconds: 1800, actions: 2 },
    { day: '2023-12-31', seconds: 9000, actions: 1 },
    { day: '2024-03-01', seconds: 9000, actions: 1 },
  ] };
  const calendar = buildLearningCalendar(history);
  assert.equal(calendar.days.length, 366);
  assert.equal(calendar.weeks.length, 53);
  assert.equal(calendar.leading, 1);
  assert.equal(calendar.weeks[0][0], null);
  assert.equal(calendar.weeks[0][1]?.day, '2024-01-01');
  assert.equal(calendar.days[1].seconds, 0);
  assert.equal(calendar.days.at(-1)?.day, '2024-12-31');
  assert.equal(calendar.days.find(day => day.day === '2024-03-01')?.seconds, 0);
  assert.deepEqual(calendar.months.map(month => month.label), Array.from({ length: 12 }, (_, i) => `${i + 1}月`));
  assert.equal(calendar.seconds, 1860);
  assert.equal(calendar.learningDays, 1);
  assert.equal(calendar.weeks.flat().filter(Boolean).length, 366);
  const empty = buildLearningCalendar({ ...history, year: 2023, start: '2023-01-01', end: '2023-12-31', days: [] });
  assert.equal(empty.days.length, 365); assert.equal(empty.seconds, 0); assert.equal(empty.learningDays, 0);
  assert.throws(() => buildLearningCalendar({ ...history, start: '2023-01-01', days: [] }));
});
test('green intensity uses duration rather than login actions or a changing relative maximum', () => {
  assert.deepEqual([0, 1, 179, 299, 300, 899, 900, 1799, 1800, 7200].map(learningLevel), [0, 1, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(learningLevel(NaN), 0);
  assert.equal(learningTime(45), '45 秒');
  assert.equal(learningTime(185), '3 分钟 5 秒');
  assert.equal(learningTime(3660), '1 小时 1 分钟');
});
