'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { AccountHistory } from '@/lib/account-types';
import { buildLearningCalendar, calendarDate, learningLevel, learningLevels, learningTime } from '@/lib/learning-calendar';

export default function LearningCalendar({ history, goalSeconds, year, years, loading, error, onYearChange }: { history?: AccountHistory; goalSeconds: number; year: number; years: number[]; loading: boolean; error: string; onYearChange: (year: number) => void }) {
  const calendar = useMemo(() => history ? buildLearningCalendar(history) : null, [history]);
  const lastDay = history ? (history.today < history.end ? history.today : history.end) : '';
  const [selectedDay, setSelectedDay] = useState(lastDay);
  const scroll = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Start near today while retaining the full January–December chart.
    const target = grid.current?.querySelector<HTMLButtonElement>(`[data-day="${lastDay}"]`);
    if (target && scroll.current) scroll.current.scrollLeft = target.getBoundingClientRect().left - scroll.current.getBoundingClientRect().left + scroll.current.scrollLeft - scroll.current.clientWidth + 32;
  }, [lastDay]);

  const selected = calendar?.days.find(day => day.day === selectedDay) || calendar?.days.find(day => day.day === lastDay);
  const columns = { '--calendar-weeks': calendar?.weeks.length || 53 } as CSSProperties;
  function navigate(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    if (!calendar) return;
    const index = calendar.days.findIndex(value => value.day === day);
    const row = (index + calendar.leading) % 7;
    let next = index;
    switch (event.key) {
      case 'ArrowLeft': next -= 7; break;
      case 'ArrowRight': next += 7; break;
      case 'ArrowUp': if (row > 0) next--; break;
      case 'ArrowDown': if (row < 6) next++; break;
      case 'Home': next = event.ctrlKey ? 0 : index - row; break;
      case 'End': next = event.ctrlKey ? calendar.days.length - 1 : index + 6 - row; break;
      default: return;
    }
    event.preventDefault();
    const last = calendar.days.findIndex(value => value.day === lastDay);
    next = Math.max(0, Math.min(last, next));
    const target = grid.current?.querySelector<HTMLButtonElement>(`[data-day="${calendar.days[next].day}"]`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return <section className="learning-calendar" aria-labelledby="learning-calendar-title" aria-busy={loading}>
    <div className="learning-calendar-heading">
      <div><h2 id="learning-calendar-title">{year} 年学习记录</h2>{calendar && <p><strong>{calendar.learningDays}</strong> 个有效学习日 · 累计 {learningTime(calendar.seconds)}</p>}</div>
    </div>
    <div className="learning-calendar-layout">
    <div className="learning-calendar-panel">
    {error && <p className="account-error" role="alert">{error}{calendar ? ' 当前显示上次成功更新的记录。' : ''}</p>}
    {!calendar || !history || !selected ? <p className="learning-calendar-placeholder" role="status">{loading ? '正在加载年度学习记录…' : error ? '年度记录加载失败，将自动重试。' : '年度记录暂时连接不上，请稍后再试。'}</p> : <>
    <div className="learning-calendar-scroll" ref={scroll} role="group" aria-label={`${year} 年的学习日历，可左右滑动；聚焦日期后用方向键查看相邻日期`} style={columns}>
      <div className="learning-calendar-board">
        <div className="learning-calendar-weekdays" aria-hidden="true"><span>一</span><span>三</span><span>五</span></div>
        <div>
          <div className="learning-calendar-months" aria-hidden="true">{calendar.months.map(month => <span key={`${month.column}-${month.label}`} style={{ gridColumn: month.column + 1 }}>{month.label}</span>)}</div>
          <div className="learning-calendar-grid" ref={grid}>
            {calendar.weeks.map((week, index) => <div className="learning-calendar-week" key={index}>
              {week.map((day, row) => day ? <button
                key={day.day} type="button" className="learning-calendar-day"
                data-day={day.day} data-level={learningLevel(day.seconds)}
                data-selected={day.day === selected.day}
                disabled={day.day > history.today}
                aria-pressed={day.day === selected.day}
                aria-label={`${calendarDate(day.day)}${day.day === history.today ? '，今天' : ''}：${day.day > history.today ? '尚未到来' : day.seconds ? `学习 ${learningTime(day.seconds)}` : '未学习'}`}
                title={`${calendarDate(day.day)}：${day.day > history.today ? '尚未到来' : day.seconds ? learningTime(day.seconds) : '未学习'}`}
                tabIndex={day.day <= history.today && day.day === selected.day ? 0 : -1}
                onFocus={() => setSelectedDay(day.day)} onClick={() => setSelectedDay(day.day)}
                onKeyDown={event => navigate(event, day.day)}
              /> : <span className="learning-calendar-blank" aria-hidden="true" key={row} />)}
            </div>)}
          </div>
        </div>
      </div>
    </div>
    <div className="learning-calendar-footer">
      <p className="learning-calendar-detail" role="status" aria-live="polite" aria-atomic="true"><strong>{calendarDate(selected.day)}{selected.day === history.today && ' · 今天'}</strong><span>{selected.seconds ? `学习 ${learningTime(selected.seconds)}` : '未记录学习'}{selected.seconds >= goalSeconds ? ' · 达到每日目标' : selected.seconds >= 180 ? ' · 有效学习日' : ''}</span></p>
      <div className="learning-calendar-legend" aria-label="颜色越深，学习时间越长：未学习、不到5分钟、5至15分钟、15至30分钟、30分钟及以上"><span>少</span>{learningLevels.map((label, level) => <i className="learning-calendar-day" data-level={level} key={level} title={label} aria-hidden="true" />)}<span>多</span></div>
    </div>
    <p className="learning-calendar-note">按北京时间记录，满 3 分钟计一个有效学习日。<span>左右滑动查看全年，点击方格查看时长。</span></p>
    </>}
    </div>
    <nav className="learning-calendar-years" aria-label="选择学习记录年份">{years.map(value => <button type="button" key={value} aria-current={year === value ? 'true' : undefined} onClick={() => onYearChange(value)}>{value}</button>)}</nav>
    </div>
  </section>;
}
