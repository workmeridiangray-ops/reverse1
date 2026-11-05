import "server-only";
import crypto from "node:crypto";
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const token = () => crypto.randomBytes(32).toString("base64url");
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${h.toString("base64")}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, s, h] = stored.split("$");
  if (alg !== "scrypt" || !s || !h) return false;
  const calc = crypto.scryptSync(pw, Buffer.from(s, "base64"), 64, { N: 16384, r: 8, p: 1 });
  const exp = Buffer.from(h, "base64");
  return calc.length === exp.length && crypto.timingSafeEqual(calc, exp);
}
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return "Include letters and at least one number.";
  return null;
}
// --- TOTP (RFC 6238) ---
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret(): string { return Array.from(crypto.randomBytes(20)).map((b) => B32[b % 32]).join(""); }
function b32decode(s: string): Buffer { let bits = ""; for (const ch of s) bits += B32.indexOf(ch).toString(2).padStart(5, "0"); const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
export function totpAt(secret: string, t = Date.now()): string {
  const ctr = Math.floor(t / 30000); const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(ctr));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(buf).digest(); const o = h[h.length - 1]! & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}
export function totpValid(secret: string, code: string): boolean {
  const c = code.replace(/\s/g, ""); if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => totpAt(secret, Date.now() + w * 30000) === c);
}
export function hmacHex(secret: string, body: string) { return crypto.createHmac("sha256", secret).update(body).digest("hex"); }
export function safeEqualHex(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }
