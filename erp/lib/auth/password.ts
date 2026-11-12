import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384, R = 8, P = 1;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const key = await scrypt(pw, Buffer.from(salt, "base64"), 64, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  const want = Buffer.from(hash, "base64");
  return key.length === want.length && timingSafeEqual(key, want);
}
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "Include letters and at least one number.";
  if (/^(password|12345|qwerty)/i.test(pw)) return "That password is too common.";
  return null;
}
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
