'use client';
import { useEffect, useState } from 'react';
import type { AccountSummary } from '@/lib/account-types';
import { loadSavedWords, persistSavedWords } from '@/lib/saved-words';
import { storageKey } from '@/lib/account-storage';
import { learningStore, loadLearningSession } from '@/lib/learning-session';
import type { SavedWord } from '@/lib/types';
import LearningCalendar from './LearningCalendar';
import EmailCodeFields from './EmailCodeFields';
const minutes = (seconds: number) => seconds > 0 && seconds < 60 ? '不到 1 分钟' : `${Math.floor(seconds / 60)} 分钟`;
function oldWords(): SavedWord[] {
  const result: SavedWord[] = [];
  for (const key of ['replay.saved', 'replay.saved.trial']) {
    try { const value = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(value)) result.push(...value.filter(item => item && typeof item.word === 'string' && typeof item.sentence === 'string' && typeof item.translation === 'string' && typeof item.addedAt === 'number')); } catch {}
  }
  return result;
}
export default function LearningHome({ initial }: { initial: AccountSummary }) {
  const [summary, setSummary] = useState(initial), [saved, setSaved] = useState(0), [resume, setResume] = useState('');
  const [year, setYear] = useState(initial.history?.year || Number(initial.today.day.slice(0, 4)));
  const [calendarLoading, setCalendarLoading] = useState(false), [calendarError, setCalendarError] = useState('');
  const [legacy, setLegacy] = useState(false), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [password, setPassword] = useState(''), [emailProof, setEmailProof] = useState({ email: '', code: '', challengeId: '' });
  const [closePassword, setClosePassword] = useState(''), [closeConfirmed, setCloseConfirmed] = useState(false);
  const refreshLocal = async () => { setSaved(loadSavedWords().length); try { setResume((await loadLearningSession())?.session.videoName || ''); } catch {} };
  useEffect(() => {
    void refreshLocal();
    try { if (!localStorage.getItem(storageKey('replay.legacy-linked'))) {
      if (oldWords().length) setLegacy(true);
      void learningStore('local').loadLearningSession().then(value => { if (value) setLegacy(true); }).catch(() => {});
    } } catch {}
  }, []);
  useEffect(() => {
    let active = true, pending = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      if (pending) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12000);
      try {
        const response = await fetch(`/api/account/summary?year=${year}`, { cache: 'no-store', signal: controller.signal });
        if (!active) return;
        if (response.status === 401) { window.location.assign('/login?returnTo=%2Faccount'); return; }
        if (!response.ok) throw new Error('学习记录暂时连接不上，请稍后再试。');
        const data: AccountSummary = await response.json();
        if (!active) return;
        if (data.history?.year !== year) throw new Error('年度记录暂时不可用，请稍后再试。');
        setSummary(data); setCalendarError('');
      } catch { if (active) setCalendarError('年度记录未能更新，请稍后再试。'); }
      finally { clearTimeout(timeout); pending = false; if (active) setCalendarLoading(false); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 20000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [year]);
  function selectYear(value: number) { if (value !== year) { setCalendarLoading(true); setCalendarError(''); setYear(value); } }
  async function adopt() {
    setBusy(true); setError('');
    try {
      const merged = loadSavedWords();
      for (const item of oldWords()) if (!merged.some(word => word.word.toLowerCase() === item.word.toLowerCase())) merged.push(item);
      if (!persistSavedWords(merged)) throw new Error('浏览器无法保存关联记录，请检查可用空间。');
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => !!key && /^replay\.(progress|trans)\.[a-f0-9]{16}$/.test(key));
      for (const key of keys) { const parts = key.split('.'); const destination = `${storageKey(`replay.${parts[1]}`)}.${parts[2]}`; if (!localStorage.getItem(destination)) localStorage.setItem(destination, localStorage.getItem(key)!); }
      const [previous, current] = await Promise.all([learningStore('local').loadLearningSession(), loadLearningSession()]);
      let note = '';
      if (previous && !current) { const result = await learningStore().saveLearningSession(previous.session, previous.video); note = result.message || ''; }
      localStorage.setItem(storageKey('replay.legacy-linked'), '1'); setLegacy(false);
      await refreshLocal(); setMessage(`本机原有记录已关联，原件仍然保留。${note}`);
    } catch (issue) { setError(issue instanceof Error ? issue.message : '关联未完成，原记录仍然保留。'); }
    finally { setBusy(false); }
  }
  async function bindEmail(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (!emailProof.challengeId) throw new Error('请先发送邮箱验证码');
      const response = await fetch('/api/account/bind-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, ...emailProof }), signal: AbortSignal.timeout(20000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setSummary(value => ({ ...value, user: data.user })); setPassword(''); setMessage('邮箱已绑定，原账号和学习记录已保留。');
    } catch (issue) { setError(issue instanceof Error ? issue.message : '绑定失败'); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try { const response = await fetch('/api/account/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!response.ok) throw new Error('退出未完成，请重试'); window.location.assign('/'); }
    catch (issue) { setError(issue instanceof Error ? issue.message : '退出未完成'); setBusy(false); }
  }
  async function closeAccount(event: React.FormEvent) {
    event.preventDefault(); if (!closeConfirmed) return; setBusy(true); setError('');
    try { const response = await fetch('/api/account/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: closePassword }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); window.location.assign('/'); }
    catch (issue) { setError(issue instanceof Error ? issue.message : '注销未完成'); setBusy(false); }
  }
  const progress = Math.min(100, summary.today.seconds / summary.goalSeconds * 100);
  const peak = Math.max(300, ...summary.days.map(day => day.seconds));
  return <div className="account-home"><div className="account-heading"><div><span className="account-eyebrow">我的学习 · 全部免费</span><h1>{summary.user.username}，今天也练几句。</h1><p>不必一次学很久，先完成今天的 5 分钟。</p></div><button className="account-text-link" type="button" disabled={busy} onClick={logout}>退出登录</button></div>
    {error && <div className="account-error" role="alert">{error}</div>}{message && <div className="account-inline-note" role="status">{message}</div>}
    <div className="account-home-grid"><section className="account-card account-goal"><span className="account-eyebrow">今日目标</span><h2>{minutes(summary.today.seconds)} <small>/ 5 分钟</small></h2><div className="account-progress" role="progressbar" aria-label="今日学习目标" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }} /></div><p>{progress >= 100 ? '今天的目标完成了，明天再练几句。' : '播放和主动复习的前台时间会自动记入学习记录。'}</p><a href="/learn" className="btn btn-primary">{resume ? '继续上次学习' : '开始今天的学习'}</a>{resume && <small className="account-resume-name">本机最近学习：{resume}</small>}</section>
    <section className="account-card"><span className="account-eyebrow">最近 7 天</span><div className="account-week-bars" role="img" aria-label={summary.days.map(day => `${day.day}：${day.seconds} 秒`).join('；')}>{summary.days.map(day => <div key={day.day}><span title={`${day.day}：${day.seconds} 秒`}><i style={{ height: `${Math.max(day.seconds ? 3 : 0, day.seconds / peak * 100)}%` }} /></span><small>{day.day.slice(5)}</small></div>)}</div><div className="account-mini-metrics"><span><strong>{summary.learningDays}</strong> 学习天数</span><span><strong>{summary.streak}</strong> 连续天数</span><span><strong>{Math.floor(summary.totalSeconds / 60)}</strong> 累计分钟</span></div><small>当天练习满 3 分钟计为一个有效学习日。</small></section></div>
    <LearningCalendar key={year} history={summary.history?.year === year ? summary.history : undefined} year={year} years={summary.history?.years || [year]} goalSeconds={summary.goalSeconds} loading={calendarLoading} error={calendarError} onYearChange={selectYear} />
    <section className="account-card account-review-entry"><div><h2>把收藏的表达再练一次</h2><p>这台设备上有 {saved} 个收藏。翻看原句、听发音，再检查是否记住。</p></div><a href="/review" className="btn btn-secondary">去复习 →</a></section>
    {legacy && <section className="account-card"><h2>这台设备还有以前的学习记录</h2><p>可以把旧视频进度、译文缓存和试学收藏关联到当前账号的本地空间，原件保留，内容不会上传。已有账号视频不会被覆盖。</p><button className="btn btn-secondary" type="button" onClick={adopt} disabled={busy}>{busy ? '正在关联…' : '关联本机原有记录'}</button></section>}
    <details className="account-card account-security" open={!summary.user.email}><summary>账号安全与邮箱</summary><p>账号：{summary.user.username}。注册于 {new Date(summary.user.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}。账号登录有效期最长 30 天。</p>{summary.user.email ? <p>已验证邮箱：{summary.user.email}。可用邮箱登录，忘记密码时通过邮件验证码找回。</p> : <><p>绑定邮箱后可通过邮件找回密码，原账号和学习记录继续保留。</p><form onSubmit={bindEmail} className="account-form"><fieldset disabled={busy} className="account-form-fields"><EmailCodeFields purpose="bind" onChange={setEmailProof} /><label>当前密码<input type="password" autoComplete="current-password" required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label><button type="submit" className="btn btn-secondary" disabled={busy}>验证并绑定邮箱</button></fieldset></form></>}</details>
    <details className="account-card account-security"><summary>注销账号</summary><p>注销会删除云端账号、登录与学习时长记录，无法恢复。电脑上的原视频和浏览器本地内容不会被删除。</p><form className="account-form" onSubmit={closeAccount}><label>当前密码<input type="password" autoComplete="current-password" required minLength={8} maxLength={128} value={closePassword} onChange={event => setClosePassword(event.target.value)} /></label><label className="account-checkbox"><input type="checkbox" required checked={closeConfirmed} onChange={event => setCloseConfirmed(event.target.checked)} />我确认删除云端账号及学习记录</label><button className="btn btn-secondary" disabled={busy || !closeConfirmed}>注销云端账号</button></form></details>
    <p className="account-footnote">账号保存用户名、已验证邮箱和学习时间，视频、字幕、收藏与具体播放位置保存在本机。换设备需重新选择素材；自带翻译接口设置不会随账号上传。<a href="/privacy">隐私说明</a></p>
  </div>;
}
