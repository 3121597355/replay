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
  return <div data-replay-admin className="ra-login"><a className="ra-logo" href="/">▣ Replay <span>管理后台</span></a><form className="ra-login-card" onSubmit={submit}><div className="ra-eyebrow">ADMIN ACCESS</div><h1>欢迎回来</h1><p>仅管理员可以查看网站数据和管理统计接口。</p><label>管理员账号<input value="admin" readOnly autoComplete="username" /></label><label>管理员密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required maxLength={200} /></label>{error && <div role="alert" className="ra-error">{error}</div>}<button className="ra-primary" disabled={busy}>{busy ? '正在验证…' : '登录管理后台'}</button><a href="/">返回 Replay 网站 ↗</a></form><p className="ra-login-note">管理员会话有效期 8 小时。统计密钥与登录权限独立。</p></div>;
}
