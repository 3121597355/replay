'use client';
import { FormEvent, useState } from 'react';
import './admin.css';
export default function AdminLogin() {
  const [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '登录失败');
      window.location.assign('/admin');
    } catch (e) { setError(e instanceof Error ? e.message : '连接失败'); }
    finally { setBusy(false); }
  }
  return <div data-replay-admin className="ra-login"><section className="ra-login-card"><a className="ra-login-brand" href="/"><span className="ra-monogram">R</span><span>Replay</span></a><p className="ra-eyebrow">管理员工作空间</p><h1>欢迎回来。</h1><p className="ra-muted">登录后查看网站访问与学习表现，管理统计接口。</p><form onSubmit={submit}><label>管理员账户<input value="admin" readOnly autoComplete="username" /></label><label>密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required maxLength={200} /></label>{error && <div role="alert" className="ra-error">{error}</div>}<button className="ra-primary" disabled={busy}>{busy ? '正在验证…' : '登录后台'}<span aria-hidden="true">→</span></button></form><a className="ra-back-site" href="/">← 返回网站</a><p className="ra-login-note">仅管理员可进入 · 会话有效期 8 小时</p></section></div>;
}
