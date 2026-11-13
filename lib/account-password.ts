import { randomBytes, scrypt, createHash, timingSafeEqual } from 'node:crypto';
export const validPassword = (value: unknown): value is string => typeof value === 'string' && value.length >= 8 && value.length <= 128 && value.trim().length > 0;
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, new Uint8Array(Buffer.from(salt, 'hex')), 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  const matched = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(hash || '');
  const key = await derive(password, matched?.[1] || '0'.repeat(32));
  const expected = Buffer.from(matched?.[2] || '0'.repeat(64), 'hex');
  return timingSafeEqual(new Uint8Array(key), new Uint8Array(expected)) && !!matched;
}
export function createRecoveryCode() { return randomBytes(16).toString('hex').toUpperCase().match(/.{8}/g)!.join('-'); }
export function recoveryDigest(code: string) { return createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex'); }
