'use client';

import { useEffect, useState } from 'react';
import type { AccountUser } from '@/lib/account-types';
import { loadSavedWords } from '@/lib/saved-words';
import { useAccount } from './AccountProvider';
import EmailCodeFields from './EmailCodeFields';

export default function AccountSettings({ initialUser }: { initialUser: AccountUser }) {
  const [user, setUser] = useState(initialUser);
  const [saved, setSaved] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [action, setAction] = useState<'bind' | 'export' | 'logout' | 'close'>();
  const [password, setPassword] = useState(''), [proof, setProof] = useState({ email: '', code: '', challengeId: '' });
  const [closePassword, setClosePassword] = useState(''), [closeConfirmed, setCloseConfirmed] = useState(false);
  const { refresh } = useAccount();

  useEffect(() => { setSaved(loadSavedWords().length); }, []);

  async function bindEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setAction('bind'); setBusy(true); setError(''); setMessage('');
    try {
      if (!proof.challengeId) throw new Error('请先发送邮箱验证码');
      const response = await fetch('/api/account/bind-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, ...proof }), signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '绑定未完成，请重试');
      setUser(data.user); setPassword(''); setMessage('邮箱已绑定，原账号和学习记录已保留。');
      void refresh();
    } catch (issue) { setError(issue instanceof Error ? issue.message : '绑定未完成，请重试'); }
    finally { setBusy(false); }
  }

  async function logout() {
    if (busy) return;
    setAction('logout'); setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/account/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('退出未完成，请重试');
      window.location.assign('/');
    } catch (issue) { setError(issue instanceof Error ? issue.message : '退出未完成'); setBusy(false); }
  }

  async function closeAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !closeConfirmed) return;
    setAction('close'); setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/account/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: closePassword }), signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '注销未完成，请重试');
      window.location.assign('/');
    } catch (issue) { setError(issue instanceof Error ? issue.message : '注销未完成'); setBusy(false); }
  }

  function exportSaved() {
    setAction('export'); setError(''); setMessage('');
    let url: string | undefined;
    try {
      const words = loadSavedWords();
      if (!words.length) { setSaved(0); setMessage('这台设备上还没有收藏，可以先去学习台收藏词和原句。'); return; }
      const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), words }, null, 2)], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `剧说英语-收藏备份-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove();
      setSaved(words.length); setMessage(`已导出 ${words.length} 个收藏。备份包含词、原句、译文和片段信息，原视频与音频需另行保留。`);
    } catch { setError('收藏未能导出，请检查浏览器下载权限后重试。'); }
    finally { if (url) { const downloadUrl = url; setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000); } }
  }

  const feedback = <>{error && <div className="account-error" role="alert">{error}</div>}{message && <div className="account-inline-note" role="status">{message}</div>}</>;
  return <div className="account-settings-page">
    <a href="/account" className="review-back-link">← 学习概览</a>
    <div className="account-heading"><div><h1>账号设置</h1><p>管理账号、登录安全和本机学习数据。</p></div></div>
    <div className="account-settings-layout">
      <nav className="account-settings-nav" aria-label="账号设置分类">
        <a href="#profile">账号资料</a><a href="#security">登录与安全</a><a href="#privacy">数据与隐私</a><a href="#management">账号管理</a>
      </nav>
      <div className="account-settings-content">
        <section className="account-card settings-section" id="profile" aria-labelledby="profile-heading">
          <h2 id="profile-heading">账号资料</h2>
          <div className="settings-profile"><span className="settings-avatar" aria-hidden="true">{[...user.username.trim()][0]?.toUpperCase()}</span><div><strong>{user.username}</strong><p>你的剧说英语账号</p></div></div>
          <dl className="settings-info"><div><dt>用户名</dt><dd>{user.username}</dd></div><div><dt>注册邮箱</dt><dd>{user.email || '尚未绑定邮箱'}{user.email && <span className="settings-badge">已验证</span>}</dd></div><div><dt>注册日期</dt><dd>{new Date(user.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</dd></div></dl>
        </section>
        <section className="account-card settings-section" id="security" aria-labelledby="security-heading">
          <h2 id="security-heading">登录与安全</h2>
          {user.email ? <div className="settings-action-row"><div><h3>登录密码</h3><p>通过已验证邮箱设置新密码。重设后，所有旧登录会失效，需要重新登录。</p></div><a href="/account/recover?returnTo=%2Faccount%2Fsettings" className="btn btn-secondary">重设密码</a></div> : <>
            <p>绑定邮箱后，可以用邮箱登录，并通过验证码重设密码。原账号和学习记录继续保留。</p>
            <form onSubmit={bindEmail} className="account-form settings-bind-form"><fieldset disabled={busy} className="account-form-fields"><EmailCodeFields purpose="bind" onChange={setProof} /><label>当前密码<input name="password" type="password" autoComplete="current-password" required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label><button type="submit" className="btn btn-primary" disabled={busy}>验证并绑定邮箱</button></fieldset></form>
          </>}
          {action === 'bind' && feedback}
          <p className="settings-caption">登录有效期最长 30 天。公共设备使用后，记得退出登录。</p>
        </section>
        <section className="account-card settings-section" id="privacy" aria-labelledby="privacy-heading">
          <h2 id="privacy-heading">数据与隐私</h2>
          <dl className="settings-info"><div><dt>账号保存</dt><dd>用户名、已验证邮箱和学习时间。</dd></div><div><dt>本机保存</dt><dd>视频、音频、字幕、收藏和具体播放位置。素材在浏览器内使用，不会上传。</dd></div><div><dt>翻译设置</dt><dd>自带接口配置保存在浏览器，翻译时会向你配置的接口发送字幕文本。</dd></div></dl>
          <div className="settings-action-row"><div><h3>收藏备份</h3><p>这台设备上有 {saved} 个收藏。导出 JSON 备份，保留词、原句、译文和片段信息；原视频与音频需另行保留。</p></div><button type="button" className="btn btn-secondary" disabled={busy} onClick={exportSaved}>导出收藏备份</button></div>
          {action === 'export' && feedback}
          <p className="settings-caption">换设备需重新选择素材。退出登录会保留本机内容。<a href="/privacy">查看隐私说明</a></p>
        </section>
        <section className="account-card settings-section" id="management" aria-labelledby="management-heading">
          <h2 id="management-heading">账号管理</h2>
          <div className="settings-action-row"><div><h3>退出当前登录</h3><p>退出这台设备的登录，本机素材与学习内容继续保留。</p></div><button type="button" className="btn btn-secondary" disabled={busy} onClick={logout}>退出登录</button></div>
          {action === 'logout' && feedback}
          <details className="settings-danger"><summary>注销账号</summary><p>注销会删除云端账号、登录与学习时长记录，无法恢复。电脑上的原视频和浏览器本地内容不会被删除。</p><form className="account-form" onSubmit={closeAccount}><fieldset disabled={busy} className="account-form-fields"><label>当前密码<input name="closePassword" type="password" autoComplete="current-password" required minLength={8} maxLength={128} value={closePassword} onChange={event => setClosePassword(event.target.value)} /></label><label className="account-checkbox"><input type="checkbox" required checked={closeConfirmed} onChange={event => setCloseConfirmed(event.target.checked)} />我确认删除云端账号及学习记录</label><button className="btn settings-danger-button" type="submit" disabled={busy || !closeConfirmed}>注销云端账号</button></fieldset></form>{action === 'close' && feedback}</details>
        </section>
      </div>
    </div>
  </div>;
}
