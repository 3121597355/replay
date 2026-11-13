import 'server-only';
import { AccountError, accountService } from './account-server';
export const normalizeEmail = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const validEmail = (value: string) => value.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value) && value.split('@')[0].length <= 64;
export async function sendAccountCode(email: string, purpose: string, token: string, clientKey: string) {
  const apiKey = process.env.RESEND_API_KEY, domain = process.env.RESEND_EMAIL_DOMAIN;
  if (!apiKey || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new AccountError('邮件服务暂时不可用，请稍后重试');
  const challenge = await accountService('/email-code', 'POST', { email, purpose }, token, clientKey);
  if (!challenge.skipped) {
    const label = purpose === 'signup' ? '注册账号' : purpose === 'bind' ? '绑定邮箱' : '重设密码';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `account-code-${challenge.challengeId}` },
      body: JSON.stringify({ from: `剧说英语 <account@${domain}>`, to: [email], subject: `剧说英语 · ${label}验证码`, text: `你正在${label}。\n\n验证码：${challenge.code}\n\n10 分钟内有效，只可使用一次。请勿把验证码发给他人。\n如非本人操作，请忽略此邮件。\n\n剧说英语 https://www.replayen.com` }),
      redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new AccountError('邮件未能发送，请稍后重试');
    await accountService('/email-sent', 'POST', { challengeId: challenge.challengeId });
  }
  return { ok: true, challengeId: challenge.challengeId, retryAfter: 60, message: purpose === 'recover' ? '若邮箱已绑定账号，验证码会发送到该邮箱。请同时检查垃圾邮件。' : '验证码已发送，请检查收件箱和垃圾邮件。' };
}
