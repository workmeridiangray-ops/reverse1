import crypto from 'node:crypto';
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newSecret(): string {
  const b = crypto.randomBytes(20); let bits = ''; for (const x of b) bits += x.toString(2).padStart(8, '0');
  return (bits.match(/.{5}/g) ?? []).map(c => ALPHA[parseInt(c, 2)]).join('');
}
function decode(s: string): Buffer {
  let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += ALPHA.indexOf(c).toString(2).padStart(5, '0');
  const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out);
}
export function hotp(secret: string, counter: number): string {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000;
  return code.toString().padStart(6, '0');
}
export function totp(secret: string, t = Date.now()): string { return hotp(secret, Math.floor(t / 30000)); }
/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secret: string, code: string, t = Date.now()): boolean {
  const c = code.replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(t / 30000);
  return [-1, 0, 1].some(d => hotp(secret, step + d) === c);
}
export const otpauthUri = (email: string, secret: string) => `otpauth://totp/Buildline:${encodeURIComponent(email)}?secret=${secret}&issuer=Buildline`;
