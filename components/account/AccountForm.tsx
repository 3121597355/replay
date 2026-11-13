'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { safeReturnPath } from '@/lib/account-types';
import { signupSource } from './AccountProvider';
import HomeMotion from '@/components/HomeMotion';
import HomeFilmBackdrop from '@/components/HomeFilmBackdrop';
import EmailCodeFields from './EmailCodeFields';
export default function AccountForm({ mode, returnTo = '/learn' }: { mode: 'signup' | 'login' | 'recover'; returnTo?: string }) {
  const destination = safeReturnPath(returnTo);
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false), [showPassword, setShowPassword] = useState(false);
  const [proof, setProof] = useState({ email: '', code: '', challengeId: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [complete, setComplete] = useState(false);
  const signup = mode === 'signup', recover = mode === 'recover';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if ((signup || recover) && password !== confirm) { setError('两次输入的密码不一致'); return; }
    if ((signup || recover) && !proof.challengeId) { setError('请先发送邮箱验证码'); return; }
    setBusy(true);
    try {
      const website = new FormData(event.currentTarget).get('website');
      const response = await fetch(`/api/account/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, accepted, source: signupSource(), ...proof, website }), signal: AbortSignal.timeout(28000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '操作未完成，请重试');
      setPassword(''); setConfirm('');
      if (recover) setComplete(true); else window.location.assign(destination);
    } catch (issue) { setError(issue instanceof Error && issue.name !== 'TimeoutError' ? issue.message : '连接较慢，请稍后重试。'); }
    finally { setBusy(false); }
  }
  return <HomeMotion page="auth" controls={false}><div className="account-auth-scene"><HomeFilmBackdrop /><div className="account-auth-layout"><section className="account-auth-intro"><span className="account-eyebrow">剧说英语 · 免费学习</span><h1>{recover ? '找回账号，接着学。' : signup ? '喜欢的剧，\n也能成为你的英语练习。' : '欢迎回来，\n接着上次那一句。'}</h1><p>视频留在本地，逐句精听、查词和收藏。每天练几分钟，把学过的表达慢慢用起来。</p><ul><li>核心功能免费，无需购买会员</li><li>邮箱验证注册，忘记密码也能找回</li><li>账号记录学习天数与进度，内容保存在本机</li></ul><Link href="/learn?trial=1" className="account-text-link">先试学一段，感受怎么学 →</Link></section>
    <section className="account-card account-auth-card">
      {complete ? <><h2>密码已重设</h2><p>旧登录已失效，请用新密码重新登录。</p><Link className="btn btn-primary account-full-button" href={`/login?returnTo=${encodeURIComponent(destination)}`}>用新密码登录</Link></> : <>
        <h2>{recover ? '重设密码' : signup ? '免费创建账号' : '登录剧说英语'}</h2><p>{recover ? '验证账号绑定的邮箱，然后设置新密码。' : signup ? '验证邮箱，免费开始练听力和口语。' : '学习记录还在，今天继续练几句。'}</p>
        <form onSubmit={submit} className="account-form"><fieldset disabled={busy} className="account-form-fields">
          {!recover && <label>{signup ? '用户名' : '邮箱或用户名'}<input name="username" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required minLength={2} maxLength={signup ? 24 : 254} placeholder={signup ? '中文、字母、数字均可' : '旧账号也可用原用户名登录'} autoCapitalize="none" spellCheck={false} /></label>}
          {(signup || recover) && <EmailCodeFields purpose={signup ? 'signup' : 'recover'} accepted={signup ? accepted : true} onChange={setProof} />}
          <label>{recover ? '新密码' : '密码'}<input name="password" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete={signup || recover ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} placeholder="至少 8 个字符" /></label>
          {(signup || recover) && <label>确认密码<input type={showPassword ? 'text' : 'password'} value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} /></label>}
          <label className="account-checkbox"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />显示密码</label>
          <div className="account-honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
          {signup && <label className="account-checkbox"><input type="checkbox" required checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>我已阅读并同意 <Link href="/terms" target="_blank">使用条款</Link> 和 <Link href="/privacy" target="_blank">隐私说明</Link></span></label>}
          {error && <div role="alert" className="account-error">{error}</div>}
          <button className="btn btn-primary account-full-button" disabled={busy}>{busy ? '正在处理…' : recover ? '重设密码' : signup ? '免费注册并开始学习' : '登录并继续学习'}</button>
        </fieldset></form>
        {recover && <small>旧账号尚未绑定邮箱？先用原用户名和密码登录，在「我的学习 → 账号安全」绑定邮箱。</small>}
        <div className="account-auth-links"><Link href={`${signup || recover ? '/login' : '/signup'}?returnTo=${encodeURIComponent(destination)}`}>{signup ? '已有账号？登录' : recover ? '返回登录' : '还没有账号？免费注册'}</Link>{!signup && !recover && <Link href={`/account/recover?returnTo=${encodeURIComponent(destination)}`}>忘记密码</Link>}</div>
      </>}
    </section></div></div></HomeMotion>;
}
