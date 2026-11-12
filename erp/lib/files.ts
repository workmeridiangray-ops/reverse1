import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "./db";
import type { TCtx } from "./actions";
import { UserError } from "./errors";
import { usage, subscriptionOf } from "./billing";

const MAX = 5 * 1024 * 1024;
const TYPES: Record<string, { mime: string; magic: (b: Buffer) => boolean }> = {
  pdf: { mime: "application/pdf", magic: (b) => b.subarray(0, 5).toString() === "%PDF-" },
  png: { mime: "image/png", magic: (b) => b[0] === 0x89 && b.subarray(1, 4).toString() === "PNG" },
  jpg: { mime: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  jpeg: { mime: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  csv: { mime: "text/csv", magic: (b) => !b.includes(0) },
};
/** Validates extension, size and file signature (not just the declared type), then stores in the database under the tenant. */
export async function saveFile(db: Db, ctx: TCtx, ownerType: string, ownerId: string, file: File): Promise<string> {
  if (file.size > MAX) throw new UserError("That file is larger than 5 MB.", { proof: "Too large" });
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const t = TYPES[ext];
  if (!t) throw new UserError("Only PDF, PNG, JPG or CSV files can be uploaded.", { proof: "Type not allowed" });
  const buf = Buffer.from(await file.arrayBuffer());
  if (!t.magic(buf)) throw new UserError("The file contents do not match its type, so it was rejected.", { proof: "Content mismatch" });
  const sub = await subscriptionOf(db, ctx.tenant.id);
  if (sub) { const u = await usage(db, ctx.tenant.id); if (u.storageMb + Math.ceil(buf.length / 1048576) > sub.max_storage_mb) throw new UserError("Your plan’s storage is full. Upgrade or remove files."); }
  const safeName = file.name.replace(/[^\w.\- ]/g, "_").slice(0, 120);
  const r = await db.query("insert into files(tenant_id,owner_type,owner_id,filename,mime,size_bytes,sha256,data,uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
    [ctx.tenant.id, ownerType, ownerId, safeName, t.mime, buf.length, createHash("sha256").update(buf).digest("hex"), buf, ctx.user.id]);
  return r.rows[0].id;
}
