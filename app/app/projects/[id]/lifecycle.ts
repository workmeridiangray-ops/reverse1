"use server";
import { audit, UserError } from "@/lib/server/db";
import { mutation, str } from "@/lib/server/actions";
import { closureChecks, writableProject } from "@/lib/server/queries";

export const awardProject = mutation("contract.approve", "award", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  if (p.status !== "tender") throw new UserError("Only a project at tender stage can be awarded.");
  const k = await db.maybe("SELECT 1 FROM contracts WHERE project_id=$1 AND status='approved'", [p.id]);
  if (!k) throw new UserError("Approve the contract (Contract tab) before awarding the project.");
  await db.exec("UPDATE projects SET status='active' WHERE id=$1", [p.id]);
  await audit(db, c.user.id, c.tenant.id, "project.awarded", "project", p.id);
  return "Project awarded and now active.";
});

export const startHandover = mutation("project.edit", "handover", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  if (p.status !== "active") throw new UserError("Only an active project can move to handover.");
  await db.exec("UPDATE projects SET status='handover' WHERE id=$1", [p.id]);
  await audit(db, c.user.id, c.tenant.id, "project.handover_started", "project", p.id);
  return "Project moved to handover.";
});

export const closeProject = mutation("project.edit", "close", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  if (p.status !== "handover") throw new UserError("Move the project to handover before closing it.");
  const checks = await closureChecks(db, p.id);
  const failing = checks.filter((x) => !x.ok);
  if (failing.length) throw new UserError(`Cannot close yet: ${failing.map((f) => f.label.toLowerCase()).join("; ")}.`);
  await db.exec("UPDATE projects SET status='closed', closed_at=now() WHERE id=$1", [p.id]);
  await audit(db, c.user.id, c.tenant.id, "project.closed", "project", p.id);
  return "Project closed. Records are now read-only; export packages remain available.";
});
