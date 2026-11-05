"use server";
import { z } from "zod";
import { audit, UserError } from "@/lib/server/db";
import { mutation, str } from "@/lib/server/actions";
import { writableProject } from "@/lib/server/queries";

export const requestInspection = mutation("inspection.manage", "requestInspection", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const title = z.string().trim().min(3, "Describe the inspection").max(200).parse(str(fd, "title"));
  const item = str(fd, "boq_item_id") || null;
  if (item) await db.one("SELECT 1 FROM boq_items WHERE id=$1 AND project_id=$2", [item, p.id]);
  const hold = str(fd, "hold_point") === "on";
  if (hold && !item) throw new UserError("A hold point must be tied to a BOQ item so downstream verification can be controlled.", "boq_item_id");
  const n = (await db.one<{ n: number }>("SELECT COALESCE(max(number),0)::int+1 n FROM inspections WHERE project_id=$1", [p.id])).n;
  await db.exec("INSERT INTO inspections(tenant_id,project_id,number,title,location,boq_item_id,drawing_ref,hold_point,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [c.tenant.id, p.id, n, title, str(fd, "location") || null, item, str(fd, "drawing_ref") || null, hold, c.user.id]);
  return `Inspection ${n} requested${hold ? " (hold point)" : ""}.`;
});

export const decideInspection = mutation("measure.verify", "decideInspection", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const pass = str(fd, "decision") === "pass";
  const note = str(fd, "note");
  if (!pass && note.length < 5) throw new UserError("Record what failed (at least 5 characters).", "note");
  const n = await db.exec("UPDATE inspections SET status=$2, result_note=$3, decided_by=$4, decided_at=now() WHERE id=$1 AND project_id=$5 AND status <> 'passed'", [z.string().uuid().parse(str(fd, "inspection_id")), pass ? "passed" : "failed", note || null, c.user.id, p.id]);
  if (!n) throw new UserError("Inspection not found or already passed.");
  await audit(db, c.user.id, c.tenant.id, pass ? "inspection.passed" : "inspection.failed", "inspection", str(fd, "inspection_id"));
  return pass ? "Inspection recorded as passed. A passed checklist records the observation; it is not a certificate." : "Inspection recorded as failed.";
});

export const raiseSnag = mutation("snag.manage", "raiseSnag", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const d = z.object({ location: z.string().trim().min(2, "Enter the location").max(160), description: z.string().trim().min(5, "Describe the defect").max(1000) }).parse({ location: str(fd, "location"), description: str(fd, "description") });
  const n = (await db.one<{ n: number }>("SELECT COALESCE(max(number),0)::int+1 n FROM snags WHERE project_id=$1", [p.id])).n;
  await db.exec("INSERT INTO snags(tenant_id,project_id,number,location,description,assigned_to,raised_by) VALUES ($1,$2,$3,$4,$5,$6,$7)", [c.tenant.id, p.id, n, d.location, d.description, str(fd, "assigned_to") || null, c.user.id]);
  return `Snag ${n} raised.`;
});

export const rectifySnag = mutation("snag.manage", "rectifySnag", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const note = z.string().trim().min(5, "Describe the rectification").max(1000).parse(str(fd, "note"));
  const n = await db.exec("UPDATE snags SET status='rectified', rectification_note=$2 WHERE id=$1 AND project_id=$3 AND status='open'", [z.string().uuid().parse(str(fd, "snag_id")), note, p.id]);
  if (!n) throw new UserError("Snag is not open.");
  return "Marked rectified; awaiting verification.";
});

export const verifySnag = mutation("measure.verify", "verifySnag", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const accept = str(fd, "decision") === "accept";
  if (!accept) {
    const n = await db.exec("UPDATE snags SET status='open', rectification_note=NULL WHERE id=$1 AND project_id=$2 AND status='rectified'", [z.string().uuid().parse(str(fd, "snag_id")), p.id]);
    if (!n) throw new UserError("Snag is not awaiting verification.");
    return "Snag reopened for further rectification.";
  }
  const n = await db.exec("UPDATE snags SET status='verified', verified_by=$2, verified_at=now() WHERE id=$1 AND project_id=$3 AND status='rectified'", [z.string().uuid().parse(str(fd, "snag_id")), c.user.id, p.id]);
  if (!n) throw new UserError("Snag is not awaiting verification.");
  return "Snag verified.";
});
