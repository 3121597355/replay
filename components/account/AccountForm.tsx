'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { safeReturnPath } from '@/lib/account-types';
import { signupSource } from './AccountProvider';
import HomeMotion from '@/components/HomeMotion';
import HomeFilmBackdrop from '@/components/HomeFilmBackdrop';
export default function AccountForm({ mode, returnTo = '/learn' }: { mode: 'signup' | 'login' | 'recover'; returnTo?: string }) {
  const destination = safeReturnPath(returnTo);
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false), [recoveryInput, setRecoveryInput] = useState(''), [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [recoveryCode, setRecoveryCode] = useState(''), [copied, setCopied] = useState(false);
  const signup = mode === 'signup', recover = mode === 'recover';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if ((signup || recover) && password !== confirm) { setError('两次输入的密码不一致'); return; }
    setBusy(true);
    try {
      const website = new FormData(event.currentTarget).get('website');
      const response = await fetch(`/api/account/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, accepted, source: signupSource(), recoveryCode: recoveryInput, website }), signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '操作未完成，请重试');
      setPassword(''); setConfirm('');
      if (data.recoveryCode) setRecoveryCode(data.recoveryCode);
      else window.location.assign(destination);
    } catch (issue) { setError(issue instanceof Error && issue.name !== 'TimeoutError' ? issue.message : '连接较慢，请稍后重试。'); }
    finally { setBusy(false); }
  }
  async function copyCode() { try { await navigator.clipboard.writeText(recoveryCode); setCopied(true); } catch { setCopied(false); } }
  function saveCode() {
    const url = URL.createObjectURL(new Blob([`剧说英语账号恢复码\n用户名：${username}\n恢复码：${recoveryCode}\n请妥善保存，不要发送给他人。使用后会更换新恢复码。\n`], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = '剧说英语-账号恢复码.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <HomeMotion page="auth" controls={false}><div className="account-auth-scene"><HomeFilmBackdrop /><div className="account-auth-layout"><section className="account-auth-intro"><span className="account-eyebrow">剧说英语 · 免费学习</span><h1>{recover ? '找回账号，接着学。' : signup ? '喜欢的剧，\n也能成为你的英语练习。' : '欢迎回来，\n接着上次那一句。'}</h1><p>视频留在本地，逐句精听、查词和收藏。每天练几分钟，把学过的表达慢慢用起来。</p><ul><li>核心功能免费，无需购买会员</li><li>用户名注册，不收手机号和邮箱</li><li>账号记录学习天数与进度，内容保存在本机</li></ul><Link href="/learn?trial=1" className="account-text-link">先试学一段，感受怎么学 →</Link></section>
    <section className="account-card account-auth-card">
      {recoveryCode ? <><span className="account-eyebrow">{recover ? '密码已重设' : '注册成功'}</span><h2>保存你的账号恢复码</h2><p>忘记密码时，用用户名和恢复码找回账号。这串码只显示一次，之后也可登录后重新生成。</p><code className="account-recovery-code">{recoveryCode}</code><div className="account-button-row"><button className="btn btn-secondary" type="button" onClick={copyCode}>{copied ? '已复制' : '复制恢复码'}</button><button className="btn btn-secondary" type="button" onClick={saveCode}>下载保存</button></div><a className="btn btn-primary account-full-button" href={recover ? `/login?returnTo=${encodeURIComponent(destination)}` : destination}>{recover ? '用新密码登录' : '进入学习台'}</a><small>请妥善保存，恢复码可用于更换账号密码。</small></> : <>
        <h2>{recover ? '重设密码' : signup ? '免费创建账号' : '登录剧说英语'}</h2><p>{recover ? '填写注册时保存的恢复码。重设后，旧登录和旧恢复码都会失效。' : signup ? '记住用户名和密码，下次直接继续学。' : '学习记录还在，今天继续练几句。'}</p>
        <form onSubmit={submit} className="account-form">
          <label>用户名<input name="username" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required minLength={2} maxLength={24} placeholder="中文、字母、数字均可" autoCapitalize="none" spellCheck={false} /></label>
          {recover && <label>账号恢复码<input value={recoveryInput} onChange={event => setRecoveryInput(event.target.value)} autoComplete="off" required maxLength={50} placeholder="注册时保存的四组恢复码" /></label>}
          <label>{recover ? '新密码' : '密码'}<input name="password" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete={signup || recover ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} placeholder="至少 8 个字符" /></label>
          {(signup || recover) && <label>确认密码<input type={showPassword ? 'text' : 'password'} value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} /></label>}
          <label className="account-checkbox"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />显示密码</label>
          <div className="account-honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
          {signup && <label className="account-checkbox"><input type="checkbox" required checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>我已阅读并同意 <Link href="/terms" target="_blank">使用条款</Link> 和 <Link href="/privacy" target="_blank">隐私说明</Link></span></label>}
          {error && <div role="alert" className="account-error">{error}</div>}
          <button className="btn btn-primary account-full-button" disabled={busy}>{busy ? '正在处理…' : recover ? '重设密码' : signup ? '免费注册并开始学习' : '登录并继续学习'}</button>
        </form>
        <div className="account-auth-links"><Link href={`${signup || recover ? '/login' : '/signup'}?returnTo=${encodeURIComponent(destination)}`}>{signup ? '已有账号？登录' : recover ? '返回登录' : '还没有账号？免费注册'}</Link>{!signup && !recover && <Link href={`/account/recover?returnTo=${encodeURIComponent(destination)}`}>忘记密码</Link>}</div>
      </>}
    </section></div></div></HomeMotion>;
}
