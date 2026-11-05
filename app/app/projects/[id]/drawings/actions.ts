"use server";
import { z } from "zod";
import { audit, UserError } from "@/lib/server/db";
import { dateStr, mutation, str } from "@/lib/server/actions";
import { writableProject } from "@/lib/server/queries";
import { saveUpload } from "@/lib/server/storage";
import { violatesSeparation } from "@/lib/rules/permissions";

async function storeFile(c: { tenant: { id: string }; user: { id: string } }, db: import("@/lib/server/db").Db, projectId: string, fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File)) throw new UserError("Choose a PDF or image file.", "file");
  const lim = await db.one<{ used: number; cap: number }>("SELECT COALESCE((SELECT sum(size_bytes) FROM files),0)::bigint used, (SELECT p.storage_mb::bigint*1048576 FROM tenants t JOIN plans p ON p.id=t.plan_id WHERE t.id=$1) cap", [c.tenant.id]);
  if (lim.used + file.size > lim.cap) throw new UserError("Your plan's storage limit is reached. Upgrade in Settings.");
  const s = await saveUpload(c.tenant.id, file, ["pdf", "image"]);
  return (await db.one<{ id: string }>("INSERT INTO files(tenant_id,project_id,entity,name,mime,size_bytes,sha256,storage_key,uploaded_by) VALUES ($1,$2,'drawing_revision',$3,$4,$5,$6,$7,$8) RETURNING id",
    [c.tenant.id, projectId, s.name, s.mime, s.size, s.sha256, s.key, c.user.id])).id;
}

export const addDrawing = mutation("drawing.manage", "addDrawing", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const d = z.object({ number: z.string().trim().min(2, "Enter the drawing number").max(60), title: z.string().trim().min(2, "Enter a title").max(200), discipline: z.string().max(40), rev: z.string().trim().min(1, "Enter the revision").max(10) })
    .parse({ number: str(fd, "number"), title: str(fd, "title"), discipline: str(fd, "discipline") || "general", rev: str(fd, "rev") });
  const fileId = await storeFile(c, db, p.id, fd);
  const dr = await db.one<{ id: string }>("INSERT INTO drawings(tenant_id,project_id,number,title,discipline) VALUES ($1,$2,$3,$4,$5) RETURNING id", [c.tenant.id, p.id, d.number, d.title, d.discipline]);
  await db.exec("INSERT INTO drawing_revisions(tenant_id,project_id,drawing_id,rev,file_id,uploaded_by,note) VALUES ($1,$2,$3,$4,$5,$6,$7)", [c.tenant.id, p.id, dr.id, d.rev, fileId, c.user.id, str(fd, "note") || null]);
  return `Drawing ${d.number} rev ${d.rev} uploaded as a draft. It becomes current once approved.`;
});

export const addRevision = mutation("drawing.manage", "addRevision", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const drawingId = z.string().uuid().parse(str(fd, "drawing_id"));
  const rev = z.string().trim().min(1, "Enter the revision").max(10).parse(str(fd, "rev"));
  await db.one("SELECT 1 FROM drawings WHERE id=$1 AND project_id=$2", [drawingId, p.id]);
  const fileId = await storeFile(c, db, p.id, fd);
  await db.exec("INSERT INTO drawing_revisions(tenant_id,project_id,drawing_id,rev,file_id,uploaded_by,note) VALUES ($1,$2,$3,$4,$5,$6,$7)", [c.tenant.id, p.id, drawingId, rev, fileId, c.user.id, str(fd, "note") || null]);
  return `Revision ${rev} uploaded as a draft.`;
});

export const approveRevision = mutation("drawing.approve", "approveRevision", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "revision_id"));
  const r = await db.one<{ drawing_id: string; status: string; uploaded_by: string | null; rev: string }>("SELECT drawing_id,status,uploaded_by,rev FROM drawing_revisions WHERE id=$1 AND project_id=$2 FOR UPDATE", [id, p.id]);
  if (r.status !== "draft") throw new UserError(`Revision is already ${r.status}.`);
  if (violatesSeparation(c.user.id, r.uploaded_by)) throw new UserError("You uploaded this revision; a different person must approve it.");
  const sup = await db.exec("UPDATE drawing_revisions SET status='superseded' WHERE drawing_id=$1 AND status='approved'", [r.drawing_id]);
  await db.exec("UPDATE drawing_revisions SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1", [id, c.user.id]);
  await audit(db, c.user.id, c.tenant.id, "drawing.approved", "drawing_revision", id, { rev: r.rev, superseded: sup });
  return sup ? `Revision ${r.rev} is now current; the previous revision is superseded.` : `Revision ${r.rev} is now current.`;
});

export const raiseRfi = mutation("rfi.raise", "raiseRfi", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const d = z.object({ question: z.string().trim().min(5, "Describe the question").max(2000), decision: z.string().trim().min(3, "State the decision required").max(500), due: dateStr, drawing: z.string().uuid().optional(), location: z.string().max(160).optional() })
    .parse({ question: str(fd, "question"), decision: str(fd, "decision_needed"), due: str(fd, "due_date"), drawing: str(fd, "drawing_id") || undefined, location: str(fd, "location") || undefined });
  const n = (await db.one<{ n: number }>("SELECT COALESCE(max(number),0)::int+1 n FROM rfis WHERE project_id=$1", [p.id])).n;
  await db.exec("INSERT INTO rfis(tenant_id,project_id,number,drawing_id,location,question,decision_needed,due_date,owner_id,raised_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)", [c.tenant.id, p.id, n, d.drawing ?? null, d.location ?? null, d.question, d.decision, d.due, c.user.id]);
  return `RFI-${n} raised.`;
});

export const respondRfi = mutation("rfi.respond", "respondRfi", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const resp = z.string().trim().min(3, "Write a response").max(3000).parse(str(fd, "response"));
  const n = await db.exec("UPDATE rfis SET status='answered', response=$2, responded_by=$3, responded_at=now() WHERE id=$1 AND project_id=$4 AND status='open'", [z.string().uuid().parse(str(fd, "rfi_id")), resp, c.user.id, p.id]);
  if (!n) throw new UserError("This RFI was already answered.");
  return "Response recorded.";
});

export const closeRfi = mutation("rfi.raise", "closeRfi", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const n = await db.exec("UPDATE rfis SET status='closed' WHERE id=$1 AND project_id=$2 AND status='answered'", [z.string().uuid().parse(str(fd, "rfi_id")), p.id]);
  if (!n) throw new UserError("Only an answered RFI can be closed.");
  return "RFI closed.";
});
