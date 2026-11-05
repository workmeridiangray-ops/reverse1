"use server";
import { z } from "zod";
import { audit, UserError } from "@/lib/server/db";
import { dateStr, mutation, str } from "@/lib/server/actions";
import { todayIso } from "@/components/ui/Format";
import { writableProject } from "@/lib/server/queries";
import { saveUpload } from "@/lib/server/storage";
import { violatesSeparation } from "@/lib/rules/permissions";

export const startReport = mutation("report.write", "startReport", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const date = dateStr.parse(str(fd, "report_date"));
  if (date > todayIso()) throw new UserError("A report cannot be dated in the future.", "report_date");
  const ex = await db.maybe<{ id: string }>("SELECT id FROM daily_reports WHERE project_id=$1 AND report_date=$2", [p.id, date]);
  if (ex) return { message: "A report for that date exists; opening it.", redirectTo: `/app/projects/${p.id}/reports/${ex.id}` };
  const r = await db.one<{ id: string }>("INSERT INTO daily_reports(tenant_id,project_id,report_date,created_by) VALUES ($1,$2,$3,$4) RETURNING id", [c.tenant.id, p.id, date, c.user.id]);
  return { message: "Draft created.", redirectTo: `/app/projects/${p.id}/reports/${r.id}` };
});

export const saveReport = mutation("report.write", "saveReport", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "report_id"));
  const labour = Number(str(fd, "labour_count") || "0"); const hours = Number(str(fd, "equipment_hours") || "0");
  if (!Number.isInteger(labour) || labour < 0 || labour > 100000) throw new UserError("Labour count must be a whole number.", "labour_count");
  if (!(hours >= 0) || hours > 100000) throw new UserError("Equipment hours must be zero or more.", "equipment_hours");
  const n = await db.exec(`UPDATE daily_reports SET weather=$2, labour_count=$3, equipment_hours=$4, summary=$5, issues=$6, version=version+1
      WHERE id=$1 AND project_id=$7 AND status IN ('draft','returned') AND version=$8`, [id, str(fd, "weather") || null, labour, hours, str(fd, "summary") || null, str(fd, "issues") || null, p.id, Number(str(fd, "version"))]);
  if (!n) throw new UserError("This report changed or is no longer editable. Reload the page.");
  return "Draft saved.";
});

export const submitReport = mutation("report.write", "submitReport", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "report_id"));
  const r = await db.one<{ summary: string | null }>("SELECT summary FROM daily_reports WHERE id=$1 AND project_id=$2 AND status IN ('draft','returned') FOR UPDATE", [id, p.id]).catch(() => { throw new UserError("Only a draft or returned report can be submitted."); });
  if (!r.summary || r.summary.length < 5) throw new UserError("Describe the day's work in the summary before submitting.");
  await db.exec("UPDATE daily_reports SET status='submitted', version=version+1 WHERE id=$1", [id]);
  return "Report submitted for review.";
});

export const reviewReport = mutation("report.verify", "reviewReport", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "report_id"));
  const verify = str(fd, "decision") === "verify";
  const reason = str(fd, "reason");
  if (!verify && reason.length < 5) throw new UserError("Explain what needs correcting (at least 5 characters).", "reason");
  const r = await db.one<{ status: string; created_by: string | null }>("SELECT status,created_by FROM daily_reports WHERE id=$1 AND project_id=$2 FOR UPDATE", [id, p.id]);
  if (r.status !== "submitted") throw new UserError(`This report is ${r.status}.`);
  if (violatesSeparation(c.user.id, r.created_by)) throw new UserError("You wrote this report; a different person must review it.");
  await db.exec("UPDATE daily_reports SET status=$2, verified_by=$3, correction_reason=$4, version=version+1 WHERE id=$1", [id, verify ? "verified" : "returned", c.user.id, verify ? null : reason]);
  await audit(db, c.user.id, c.tenant.id, verify ? "report.verified" : "report.returned", "daily_report", id, { reason });
  return verify ? "Report verified." : "Report returned to the author with your note.";
});

export const uploadPhoto = mutation("report.write", "uploadPhoto", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "report_id"));
  const r = await db.one<{ status: string }>("SELECT status FROM daily_reports WHERE id=$1 AND project_id=$2", [id, p.id]);
  if (r.status !== "draft" && r.status !== "returned") throw new UserError("Photos can only be added to a draft or returned report.");
  const file = fd.get("file");
  if (!(file instanceof File)) throw new UserError("Choose a photo.", "file");
  const lim = await db.one<{ used: number; cap: number }>("SELECT COALESCE((SELECT sum(size_bytes) FROM files),0)::bigint used, (SELECT p.storage_mb::bigint*1048576 FROM tenants t JOIN plans p ON p.id=t.plan_id WHERE t.id=$1) cap", [c.tenant.id]);
  if (lim.used + file.size > lim.cap) throw new UserError("Your plan's storage limit is reached. Upgrade in Settings or remove files.");
  const saved = await saveUpload(c.tenant.id, file, ["image"]);
  await db.exec("INSERT INTO files(tenant_id,project_id,entity,entity_id,name,mime,size_bytes,sha256,storage_key,uploaded_by) VALUES ($1,$2,'daily_report',$3,$4,$5,$6,$7,$8,$9)",
    [c.tenant.id, p.id, id, saved.name, saved.mime, saved.size, saved.sha256, saved.key, c.user.id]);
  return "Photo uploaded.";
});
