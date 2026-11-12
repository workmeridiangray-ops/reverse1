import { createHmac, randomBytes } from "node:crypto";
const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newSecret(): string {
  const b = randomBytes(20); let bits = ""; for (const x of b) bits += x.toString(2).padStart(8, "0");
  let out = ""; for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
function decode(s: string): Buffer {
  let bits = ""; for (const c of s.replace(/=+$/, "").toUpperCase()) { const v = A.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, "0"); }
  const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totpAt(secret: string, t: number): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac("sha1", decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, "0");
}
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => totpAt(secret, now + w * 30000) === c);
}
export const otpauthUri = (email: string, secret: string) =>
  `otpauth://totp/Ledgerline:${encodeURIComponent(email)}?secret=${secret}&issuer=Ledgerline`;
