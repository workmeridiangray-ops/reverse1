import crypto from 'node:crypto';

export function randomToken(bytes = 32): string { return crypto.randomBytes(bytes).toString('base64url'); }
export function sha256(s: string): string { return crypto.createHash('sha256').update(s).digest('hex'); }
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const N = 16384, R = 8, P = 1, KEYLEN = 64;
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await new Promise<Buffer>((res, rej) => crypto.scrypt(pw, salt, KEYLEN, { N, r: R, p: P }, (e, k) => e ? rej(e) : res(k)));
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const k = await new Promise<Buffer>((res, rej) => crypto.scrypt(pw, Buffer.from(salt, 'base64'), KEYLEN, { N: +n, r: +r, p: +p }, (e, d) => e ? rej(e) : res(d)));
  return crypto.timingSafeEqual(k, Buffer.from(key, 'base64'));
}
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Include letters and at least one number.';
  return null;
}
