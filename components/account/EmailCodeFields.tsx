'use client';
import { useEffect, useState } from 'react';
export default function EmailCodeFields({ purpose, accepted = true, onChange }: { purpose: 'signup' | 'recover' | 'bind'; accepted?: boolean; onChange: (proof: { email: string; code: string; challengeId: string }) => void }) {
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [challengeId, setChallengeId] = useState('');
  const [sending, setSending] = useState(false), [until, setUntil] = useState(0), [remaining, setRemaining] = useState(0), [message, setMessage] = useState(''), [error, setError] = useState('');
  useEffect(() => { onChange({ email, code, challengeId }); }, [email, code, challengeId, onChange]);
  useEffect(() => { const tick = () => setRemaining(Math.max(0, Math.ceil((until - Date.now()) / 1000))); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [until]);
  async function send() {
    setError(''); setMessage('');
    if (!accepted) { setError('请先同意下方的使用条款和隐私说明'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('请填写有效的邮箱地址'); return; }
    setSending(true);
    try {
      const response = await fetch('/api/account/email-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, purpose, accepted }), signal: AbortSignal.timeout(28000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '发送未完成');
      setChallengeId(data.challengeId); setCode(''); setUntil(Date.now() + data.retryAfter * 1000); setMessage(data.message);
    } catch (issue) { setError(issue instanceof Error && issue.name !== 'TimeoutError' ? issue.message : '连接较慢，请稍后重试'); }
    finally { setSending(false); }
  }
  return <><label>邮箱<input name="email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={sending} onChange={event => { setEmail(event.target.value); setChallengeId(''); setCode(''); setMessage(''); setError(''); }} placeholder="用于登录和找回密码" autoCapitalize="none" spellCheck={false} /></label><label>邮箱验证码<div className="account-code-row"><input name="code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required maxLength={6} placeholder="6 位验证码" /><button className="btn btn-secondary" type="button" disabled={sending || remaining > 0} onClick={send}>{sending ? '发送中…' : remaining > 0 ? `${remaining} 秒后重发` : '发送验证码'}</button></div></label>{message && <small role="status">{message}</small>}{error && <div className="account-error" role="alert">{error}</div>}</>;
}
