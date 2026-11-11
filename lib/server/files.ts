import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { UserError } from "./db";
export const UPLOAD_DIR = () => path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
const MAX = Number(process.env.UPLOAD_MAX_BYTES ?? 10_000_000);
const SIGS: Record<string, { mime: string; magic: number[][] }> = {
  pdf: { mime: "application/pdf", magic: [[0x25, 0x50, 0x44, 0x46]] }, png: { mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47]] }, jpg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  csv: { mime: "text/csv", magic: [] }, txt: { mime: "text/plain", magic: [] }, xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: [[0x50, 0x4b, 0x03, 0x04]] },
};
/** Allow-list by extension AND content signature; executables/scripts are refused. Antivirus scanning is not bundled — see docs/operations.md. */
export async function saveUpload(f: File): Promise<{ key: string; mime: string; size: number; sha256: string; name: string }> {
  if (!f || !f.size) throw new UserError("Choose a file to upload.");
  if (f.size > MAX) throw new UserError(`File is larger than ${Math.round(MAX / 1e6)} MB.`);
  const ext = (f.name.split(".").pop() ?? "").toLowerCase(); const sig = SIGS[ext];
  if (!sig) throw new UserError("Allowed file types: PDF, PNG, JPG, CSV, TXT, XLSX.");
  const buf = Buffer.from(await f.arrayBuffer());
  if (sig.magic.length && !sig.magic.some((m) => m.every((b, i) => buf[i] === b))) throw new UserError("The file’s content does not match its extension.");
  if ((ext === "csv" || ext === "txt") && buf.subarray(0, 4096).includes(0)) throw new UserError("That does not look like a text file.");
  const key = crypto.randomUUID(); await fs.mkdir(UPLOAD_DIR(), { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR(), key), buf, { mode: 0o600 });
  return { key, mime: sig.mime, size: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), name: f.name.replace(/[^\w.\- ]/g, "_").slice(0, 120) };
}
export const readUpload = (key: string) => fs.readFile(path.join(UPLOAD_DIR(), path.basename(key)));
