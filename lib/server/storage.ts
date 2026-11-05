import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { UserError } from "./db";

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 15) * 1024 * 1024;
const root = () => path.resolve(process.env.STORAGE_DIR ?? "./storage-data");

const SIGS: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

/** Accepts PDF/PNG/JPEG/WebP only; the type is decided by the file's bytes, never by its name or declared type. */
export function sniff(buf: Buffer) {
  return SIGS.find((s) => s.test(buf)) ?? null;
}
export function safeName(name: string) {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
}

export async function saveUpload(tenantId: string, file: File, allowed: Array<"pdf" | "image"> = ["pdf", "image"]) {
  if (!file || file.size === 0) throw new UserError("Choose a file to upload.", "file");
  if (file.size > MAX_UPLOAD_BYTES) throw new UserError(`File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, "file");
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind || (kind.ext === "pdf" ? !allowed.includes("pdf") : !allowed.includes("image")))
    throw new UserError(`This file type is not allowed. Allowed: ${allowed.includes("pdf") ? "PDF, " : ""}${allowed.includes("image") ? "PNG, JPEG, WebP" : ""}.`, "file");
  const key = `${tenantId}/${randomUUID()}.${kind.ext}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf, { mode: 0o600 });
  return { key, mime: kind.mime, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), name: safeName(file.name) };
}
export async function readUpload(key: string): Promise<Buffer> {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("bad key");
  return readFile(full);
}
